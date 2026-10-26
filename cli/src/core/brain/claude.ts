import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import type { Answer, AskRequest, Brain, DreamRequest, DreamResult, Reply, SkillRequest } from './brain'
import { writeMcpConfig } from './mcp-config'
import { parseAnswer, parseDreamResult } from './parse'
import { askPrompt, dreamPrompt, followUpPrompt, skillPrompt } from './prompts'
import { chunk, textCard } from '../cards/cards'

const MINUTE = 60_000
export const CLAUDE_TIMEOUTS = { full: 15 * MINUTE, readOnly: 2 * MINUTE, skill: 15 * MINUTE } as const
/** After SIGTERM, how long a stubborn child gets before SIGKILL. */
const KILL_GRACE_MS = 3000
const TOOL_INPUT_MAX = 300

const DOCKER_READ = [
  'tavily_search', 'tavily_extract', 'tavily_research',
  'jira_search', 'jira_get_issue', 'jira_get_project_issues', 'jira_get_board_issues', 'jira_get_sprint_issues', 'jira_get_agile_boards',
  'jira_get_sprints_from_board', 'jira_get_all_projects', 'jira_get_user_profile', 'jira_get_worklog', 'jira_get_issue_dates',
  'jira_get_issue_sla', 'jira_get_queue_issues', 'jira_get_service_desk_queues', 'jira_get_project_versions',
  'confluence_search', 'confluence_get_page', 'confluence_get_page_children', 'confluence_get_space_page_tree', 'confluence_get_comments', 'confluence_get_labels',
]
const ALLOWED_TOOLS = ['WebSearch', 'WebFetch', 'mcp__ccs-websearch', 'mcp__neo-agents', ...DOCKER_READ.map(t => 'mcp__MCP_DOCKER__' + t), 'Skill'].join(',')

export interface ClaudeBrainOptions {
  /** Where agent runs happen (`NEO_HOME/tasks`). */
  cwd: string
  /** Written before each ask; the file holds tokens, so it lives under NEO_HOME. */
  mcpFile: string
  /** `[<neo binary>, 'mcp']`. */
  neoCommand: readonly [string, ...string[]]
  /** Setting `claudeConfigDir`. Passed to `claude` only when it returns something. */
  claudeConfigDir?: () => string | undefined
  mcpServers?: () => readonly string[] | undefined
  /** null → Claude Code's default model. */
  model?: () => string | null
  /** The environment to start from (`process.env`); `CLAUDECODE*` is always removed from it. */
  env?: Record<string, string | undefined>
  command?: string
  homeDir?: string
  timeouts?: Partial<typeof CLAUDE_TIMEOUTS>
}

class Failure extends Error {}

/** `claude -p --output-format stream-json`, in its bypass and read-only flag sets. */
export function createClaudeBrain(options: ClaudeBrainOptions): Brain {
  const { cwd, mcpFile, neoCommand, command = 'claude', homeDir = homedir() } = options
  const timeouts = { ...CLAUDE_TIMEOUTS, ...options.timeouts }

  function childEnv() {
    const env: Record<string, string> = {}
    for (const [key, value] of Object.entries(options.env ?? process.env)) {
      if (value !== undefined && !key.startsWith('CLAUDECODE') && key !== 'CLAUDE_CODE_ENTRYPOINT') env[key] = value
    }
    const configDir = options.claudeConfigDir?.()
    if (configDir) env.CLAUDE_CONFIG_DIR = configDir
    return env
  }

  async function run(args: string[], prompt: string, { timeoutMs, signal, onTool }: { timeoutMs: number; signal: AbortSignal; onTool(name: string, input: string): void }) {
    if (signal.aborted) throw new Failure('interrupted')
    await mkdir(cwd, { recursive: true })
    return new Promise<{ text: string; session: string | null }>((resolve, reject) => {
      // detached: the child leads its own process group, so cancel can take its helpers down with it
      const child = spawn(command, ['-p', '--output-format', 'stream-json', '--verbose', ...args], {
        cwd, env: childEnv(), detached: true, stdio: ['pipe', 'pipe', 'ignore'],
      })
      let buffer = ''
      let result: { text: string; isError: boolean } | null = null
      let session: string | null = null
      let settled = false

      const killGroup = () => {
        const pid = child.pid
        if (pid === undefined) return
        try { process.kill(-pid, 'SIGTERM') } catch { /* already gone */ }
        setTimeout(() => { try { process.kill(-pid, 'SIGKILL') } catch { /* already gone */ } }, KILL_GRACE_MS).unref()
      }
      const finish = (settle: () => void) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        signal.removeEventListener('abort', onAbort)
        settle()
      }
      const stop = (reason: string) => finish(() => { killGroup(); reject(new Failure(reason)) })
      const onAbort = () => stop('interrupted')
      const timer = setTimeout(() => stop('timeout'), timeoutMs)
      signal.addEventListener('abort', onAbort)

      child.stdin.on('error', () => {}) // the child may exit before reading the prompt
      child.stdin.end(prompt) // on stdin: --tools/--allowedTools take many values and would swallow an argv prompt
      child.stdout.on('data', (data: Buffer) => {
        buffer += data.toString('utf8')
        for (let nl = buffer.indexOf('\n'); nl >= 0; nl = buffer.indexOf('\n')) {
          const line = buffer.slice(0, nl)
          buffer = buffer.slice(nl + 1)
          let message: any
          try { message = JSON.parse(line) } catch { continue }
          if (message.session_id) session = message.session_id
          if (message.type === 'assistant') {
            for (const part of message.message?.content ?? []) {
              if (part.type === 'tool_use') onTool(part.name, JSON.stringify(part.input ?? {}).slice(0, TOOL_INPUT_MAX))
            }
          }
          if (message.type === 'result') result = { text: String(message.result ?? ''), isError: message.is_error === true }
        }
      })
      child.on('error', (e: NodeJS.ErrnoException) =>
        finish(() => reject(new Failure(e.code === 'ENOENT' ? `ไม่พบคำสั่ง ${command}` : e.message))))
      child.on('close', () =>
        finish(() => {
          if (result === null) return reject(new Failure('no result'))
          if (result.isError) return reject(new Failure(result.text.trim().slice(0, 200) || 'claude error'))
          resolve({ text: result.text, session })
        }))
    })
  }

  const guard = async (work: () => Promise<Reply>): Promise<Reply> => {
    try {
      return await work()
    } catch (e) {
      return { answer: { type: 'error', error: e instanceof Failure ? e.message : String((e as Error)?.message ?? e) }, session: null }
    }
  }

  return {
    label: 'Claude Code',

    ask: request =>
      guard(async () => {
        const { bypass, context, text, resume, signal, onTool } = request
        await writeMcpConfig({ file: mcpFile, configDir: options.claudeConfigDir?.(), servers: options.mcpServers?.(), neoCommand })
        const model = options.model?.()
        const args = [
          ...(model ? ['--model', model] : []),
          ...(bypass
            ? ['--permission-mode', 'bypassPermissions', '--add-dir', homeDir, '--mcp-config', mcpFile]
            : ['--strict-mcp-config', '--mcp-config', mcpFile, '--tools', 'WebSearch,WebFetch,Skill', '--allowedTools', ...ALLOWED_TOOLS.split(',')]),
          ...(resume ? ['--resume', resume] : []),
        ]
        const prompt = resume ? followUpPrompt(text, context.notes) : askPrompt(text, context, bypass ? 'agent' : 'claude', bypass)
        const out = await run(args, prompt, { timeoutMs: bypass ? timeouts.full : timeouts.readOnly, signal, onTool })
        return { answer: parseAnswer(out.text), session: out.session }
      }),

    /** Read-only tools, however long it takes: nobody is waiting. */
    async dream(request: DreamRequest): Promise<DreamResult> {
      try {
        await writeMcpConfig({ file: mcpFile, configDir: options.claudeConfigDir?.(), servers: options.mcpServers?.(), neoCommand })
        const model = options.model?.()
        const args = [
          ...(model ? ['--model', model] : []),
          '--strict-mcp-config', '--mcp-config', mcpFile, '--tools', 'WebSearch,WebFetch,Skill',
          '--allowedTools', ...ALLOWED_TOOLS.split(','), // one value each: a single 1 KB argument is killed under the contract suite's node fake
        ]
        const out = await run(args, dreamPrompt(request), { timeoutMs: timeouts.full, signal: request.signal, onTool: request.onTool })
        return parseDreamResult(out.text)
      } catch (e) {
        return { type: 'error', error: e instanceof Failure ? e.message : String((e as Error)?.message ?? e) }
      }
    },

    runSkill: (request: SkillRequest) =>
      guard(async () => {
        const out = await run(['--model', 'sonnet', '--permission-mode', 'bypassPermissions'], skillPrompt(request), { timeoutMs: timeouts.skill, signal: request.signal, onTool: request.onTool })
        const parsed = parseAnswer(out.text)
        const answer: Answer = parsed.type === 'card' ? parsed
          : textFallback(out.text)
        return { answer, session: null }
      }),
  }
}

/** A finished skill run that did not reply in JSON still shows what it said. */
const textFallback = (text: string): Answer => ({
  type: 'card',
  card: textCard({ icon: 'task', title: 'ทำเสร็จแล้ว', lines: chunk(text.replace(/\s+/g, ' '), 30, 8), seconds: 45 }),
})
