// An agent that speaks the Agent Client Protocol over stdio JSON-RPC (claude-code-acp, opencode acp, qwen --experimental-acp …).
// Ported from app/providers.js (AcpProvider). Neo is the client: it offers no fs/terminal, answers permission requests
// (read-only tools silently, everything else by asking the user within 30 s) and keeps one session per Conversation session.
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import type { ProviderConfig } from '../../protocol'
import type { AskRequest, ModelInfo, PermissionRequest, Provider, Reply, SkillRequest } from './brain'
import { childEnv } from './child-env'
import { parseLoose } from './parse'
import { askPrompt, followUpPrompt, systemPrompt } from './prompts'

const MINUTE = 60_000
export const ACP_TIMEOUT_MS = 15 * MINUTE
const STDERR_TAIL = 500
const TOOL_TITLE_MAX = 80

/** ACP tool kinds that only read: allowed without asking. Anything else (edit, delete, move, execute, other) asks the user. */
export const READ_KINDS = new Set(['read', 'search', 'fetch', 'think'])

/** Neo's own read-only MCP tools, by (part of) the tool title. */
const READ_TOOLS = ['tavily_search', 'tavily_extract', 'tavily_research', 'jira_search', 'jira_get', 'confluence_search', 'confluence_get', 'orca_agents', 'orca_agent_output', 'orca_runs', 'orca_run_tasks', 'browser_search', 'browser_read']
export const isReadTool = (title: string) => READ_TOOLS.some(name => title.includes(name))

// Bypass picks the most permissive mode the agent itself lists; no per-agent mode names are written down here.
const PERMISSIVE = [/bypass/i, /yolo/i, /dont.?ask|never.?ask/i, /full|danger/i, /build|code|act/i, /accept/i, /auto/i]
export function pickMode(ids: readonly string[]): string | null {
  for (const re of PERMISSIVE) {
    const hit = ids.find(id => re.test(id) && !/plan|read/i.test(id))
    if (hit) return hit
  }
  return null
}

/** Agents that take `_meta.systemPrompt` on `session/new` (claude-agent-acp, by the `agentInfo.name` it announces). Others get the persona in the first prompt. */
export const takesSystemPrompt = (agentName: unknown) => typeof agentName === 'string' && /claude/i.test(agentName)

export interface AcpMcpServer {
  name: string
  command: string
  args: string[]
  env: Array<{ name: string; value: string }>
}

/** The `mcpServers` of an MCP config (`{name: {command, args, env}}`) in ACP's stdio shape. Servers without a command are skipped. */
export const toAcpMcp = (servers: Record<string, any>): AcpMcpServer[] =>
  Object.entries(servers)
    .filter(([, v]) => v?.command)
    .map(([name, v]) => ({ name, command: v.command, args: v.args ?? [], env: Object.entries(v.env ?? {}).map(([k, val]) => ({ name: k, value: String(val) })) }))

export interface AcpOptions {
  name: string
  cfg: ProviderConfig
  /** `NEO_HOME/tasks` */
  cwd: string
  /** The environment to start from (`process.env`). */
  env: Record<string, string | undefined>
  claudeConfigDir?: () => string | undefined
  mcpServers?: () => Promise<AcpMcpServer[]> | AcpMcpServer[]
  /** Chosen model id (already mapped from an alias); null → the agent's own default. */
  model?: () => string | null
  log?: (message: string) => void
  timeoutMs?: number
}

class Failure extends Error {}

interface Rpc {
  proc: ChildProcess
  request(method: string, params: unknown): Promise<any>
  notify(method: string, params: unknown): void
  respond(id: number, result: unknown): void
  alive: boolean
}

export function createAcpBrain(options: AcpOptions): Provider {
  const { name, cfg, cwd, timeoutMs = ACP_TIMEOUT_MS } = options
  const label = cfg.label || name
  const log = options.log ?? (() => {})

  let rpc: Rpc | null = null
  let ready: Promise<Rpc> | null = null
  /** What the agent called itself in `initialize`. */
  let agentName: string | null = null
  /** The session Conversation is continuing, if any. */
  let session: { id: string; bypass: boolean; applied: string | null } | null = null
  let modelVia: 'models' | 'config' | null = null
  let modelList: ModelInfo[] | null = null
  /** What each open session is being asked right now (by session id): the conversation's and a side drawing's never mix. */
  const turns = new Map<string, { text: string; run: { onTool: AskRequest['onTool']; confirm: AskRequest['confirm']; bypass: boolean } }>()

  function spawnRpc(): Rpc {
    const proc = spawn(cfg.command ?? '', cfg.args ?? [], { cwd, env: childEnv(options.env, options.claudeConfigDir?.()), stdio: ['pipe', 'pipe', 'pipe'] })
    const pending = new Map<number, { resolve(v: any): void; reject(e: Error): void }>()
    const handle: Rpc = {
      proc, alive: true,
      request(method, params) {
        return new Promise((resolve, reject) => {
          if (!handle.alive) return reject(new Failure(`${label}: ปิดตัวแล้ว`))
          const id = nextId++
          pending.set(id, { resolve, reject })
          write({ jsonrpc: '2.0', id, method, params })
        })
      },
      notify: (method, params) => write({ jsonrpc: '2.0', method, params }),
      respond: (id, result) => write({ jsonrpc: '2.0', id, result }),
    }
    let nextId = 1
    let buffer = ''
    let stderr = ''
    const write = (message: unknown) => {
      if (handle.alive) proc.stdin!.write(JSON.stringify(message) + '\n')
    }
    const dead = (why: string) => {
      if (!handle.alive) return
      handle.alive = false
      if (rpc === handle) {
        rpc = null
        ready = null
        session = null
        turns.clear()
        modelVia = null
        agentName = null
      }
      for (const waiter of pending.values()) waiter.reject(new Failure(`${label}: ${why}`))
      pending.clear()
    }
    proc.stdin!.on('error', () => {})
    proc.stdout!.on('data', (data: Buffer) => {
      buffer += data.toString('utf8')
      for (let nl = buffer.indexOf('\n'); nl >= 0; nl = buffer.indexOf('\n')) {
        const line = buffer.slice(0, nl)
        buffer = buffer.slice(nl + 1)
        let message: any
        try { message = JSON.parse(line) } catch { continue }
        if (message.id !== undefined && !message.method) {
          const waiter = pending.get(message.id)
          if (!waiter) continue
          pending.delete(message.id)
          if (message.error) waiter.reject(new Failure(message.error.message || 'ACP error'))
          else waiter.resolve(message.result)
        } else if (message.method === 'session/update') {
          onUpdate(message.params ?? {})
        } else if (message.method === 'session/request_permission') {
          void onPermission(handle, message)
        } else if (message.id !== undefined) {
          // fs / terminal: not offered
          write({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: `Neo ไม่รองรับ ${message.method}` } })
        }
      }
    })
    proc.stderr!.on('data', (data: Buffer) => void (stderr = (stderr + data.toString('utf8')).slice(-STDERR_TAIL)))
    proc.on('error', (e: NodeJS.ErrnoException) => dead(e.code === 'ENOENT' ? `ไม่พบคำสั่ง ${cfg.command}` : e.message))
    proc.on('close', code => dead(`ปิดตัว (${code}) ${stderr.split('\n').filter(Boolean).pop() ?? ''}`.trim()))
    return handle
  }

  function onUpdate({ sessionId, update }: { sessionId?: string; update?: any }) {
    const turn = sessionId ? turns.get(sessionId) : undefined
    if (!update || !turn) return
    if (update.sessionUpdate === 'agent_message_chunk' && update.content?.type === 'text') turn.text += update.content.text
    else if (update.sessionUpdate === 'tool_call') turn.run.onTool(update.title || update.kind || 'tool', update.kind || '')
  }

  async function onPermission(from: Rpc, message: any) {
    const toolCall = message.params?.toolCall ?? {}
    const options_: Array<{ kind: string; optionId: string }> = message.params?.options ?? []
    const pick = (kinds: string[]) => options_.find(o => kinds.includes(o.kind))?.optionId
    const title = String(toolCall.title || toolCall.kind || 'ทำงาน').slice(0, TOOL_TITLE_MAX)
    const current = (message.params?.sessionId ? turns.get(message.params.sessionId) : undefined)?.run
    let allowed = Boolean(current && (current.bypass || READ_KINDS.has(toolCall.kind) || isReadTool(title)))
    if (!allowed && current?.confirm) {
      const request: PermissionRequest = { title, kind: toolCall.kind, agent: label }
      allowed = await current.confirm(request).catch(() => false)
    }
    log(`permission ${allowed ? 'allow' : 'deny'}: ${title}`)
    const optionId = allowed ? pick(['allow_once', 'allow_always']) : pick(['reject_once', 'reject_always'])
    from.respond(message.id, { outcome: optionId ? { outcome: 'selected', optionId } : { outcome: 'cancelled' } })
  }

  async function ensure(): Promise<Rpc> {
    if (rpc?.alive && ready) return ready
    await mkdir(cwd, { recursive: true }) // a missing cwd would look like a missing command
    if (rpc?.alive && ready) return ready // another caller got there first
    const mine = spawnRpc()
    rpc = mine
    ready = mine
      .request('initialize', { protocolVersion: 1, clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false } })
      .then(init => {
        agentName = init?.agentInfo?.name ?? null
        return mine
      })
    ready.catch(() => {}) // the caller sees it
    return ready
  }

  /** `session/new`, and learn the models the agent offers (opencode: configOptions, claude-code-acp: models). */
  async function newSession(from: Rpc, system?: string) {
    const result = await from.request('session/new', {
      cwd,
      mcpServers: (await options.mcpServers?.()) ?? [],
      ...(system ? { _meta: { systemPrompt: { append: system } } } : {}),
    })
    const modelOption = (result.configOptions ?? []).find((o: any) => o.id === 'model')
    if (modelOption) {
      modelVia = 'config'
      modelList = (modelOption.options ?? []).map((o: any) => ({ id: o.value, name: o.name || o.value }))
    } else if (result.models) {
      modelVia = 'models'
      modelList = (result.models.availableModels ?? []).map((m: any) => ({ id: m.modelId, name: m.name + (m.description ? ` — ${m.description}` : '') }))
    }
    return result
  }

  type Open = { id: string; bypass: boolean; applied: string | null }
  async function openSession(from: Rpc, bypass: boolean, system?: string, side = false): Promise<Open> {
    const result = await newSession(from, system)
    const id: string = result.sessionId
    const setOption = (configId: string, value: string) =>
      from.request('session/set_config_option', { sessionId: id, configId, value })
        .catch(e => log(`${label} ตั้ง ${configId}=${value} ไม่ได้: ${e.message}`))
    for (const [key, value] of Object.entries(cfg.config ?? {})) {
      if (bypass && key === 'mode') continue // bypass picks the mode below
      await setOption(key, value)
    }
    if (bypass) {
      const modeOption = (result.configOptions ?? []).find((o: any) => o.id === 'mode')
      const ids: string[] = modeOption ? (modeOption.options ?? []).map((o: any) => o.value) : (result.modes?.availableModes ?? []).map((m: any) => m.id)
      const mode = pickMode(ids)
      if (mode) {
        await (modeOption ? from.request('session/set_config_option', { sessionId: id, configId: 'mode', value: mode }) : from.request('session/set_mode', { sessionId: id, modeId: mode }))
          .then(() => log(`${label} โหมด ${mode}`), e => log(`${label} ตั้งโหมด ${mode} ไม่ได้: ${e.message}`))
      }
    }
    const opened: Open = { id, bypass, applied: null }
    if (!side) session = opened
    return opened
  }

  /** Switch the agent's model when the choice changed (also mid-conversation). */
  async function applyModel(from: Rpc, target: Open | null) {
    const want = options.model?.() ?? null
    if (!target || !want || want === target.applied) return
    const { id } = target
    const done = modelVia === 'models'
      ? from.request('session/set_model', { sessionId: id, modelId: want })
      : from.request('session/set_config_option', { sessionId: id, configId: 'model', value: want })
    await done.then(() => void (target.applied = want), e => log(`${label} เปลี่ยนโมเดลเป็น ${want} ไม่ได้: ${e.message}`))
  }

  async function prompt(request: AskRequest): Promise<Reply> {
    const { signal } = request
    if (signal.aborted) throw new Failure('interrupted')
    const from = await ensure()
    const side = request.side === true
    const fresh = side || !(request.resume && session && request.resume === session.id && session.bypass === request.bypass)
    // the persona travels as the system prompt when the agent takes one: the user's turn is then only what they said
    const system = fresh && takesSystemPrompt(agentName) ? systemPrompt(request.context, 'agent', request.bypass) : undefined
    const mine = fresh ? await openSession(from, request.bypass, system, side) : session!
    await applyModel(from, mine)
    const body = system ? request.text : fresh ? askPrompt(request.text, request.context, 'agent', request.bypass) : followUpPrompt(request.text, request.context.notes)
    const turn = { text: '', run: { onTool: request.onTool, confirm: request.confirm, bypass: request.bypass } }
    turns.set(mine.id, turn)
    let stop = () => {}
    try {
      const stopped = new Promise<never>((_, reject) => {
        const give = (why: string) => {
          // the agent is told to stop, but we do not wait for it: the next ask opens a clean session
          if (from.alive) from.notify('session/cancel', { sessionId: mine.id })
          if (session === mine) session = null
          reject(new Failure(why))
        }
        const onAbort = () => give('interrupted')
        const timer = setTimeout(() => give('timeout'), timeoutMs)
        signal.addEventListener('abort', onAbort)
        stop = () => {
          clearTimeout(timer)
          signal.removeEventListener('abort', onAbort)
        }
      })
      stopped.catch(() => {})
      const result = await Promise.race([from.request('session/prompt', { sessionId: mine.id, prompt: [{ type: 'text', text: body }] }), stopped])
      if (result?.stopReason === 'cancelled') throw new Failure('interrupted')
      return { answer: parseLoose(turn.text, request.context.petName), session: mine.id }
    } finally {
      stop()
      turns.delete(mine.id)
    }
  }

  async function guard(work: () => Promise<Reply>): Promise<Reply> {
    try {
      return await work()
    } catch (e) {
      const message = e instanceof Failure ? e.message : `${label}: ${(e as Error)?.message ?? e}`
      return { answer: { type: 'error', error: message }, session: null }
    }
  }

  return {
    label,
    ask: request => guard(() => prompt(request)),
    // an agent has its own tools: no separate skill step
    runSkill: (_: SkillRequest) => Promise.resolve({ answer: { type: 'error', error: `${label} ไม่รองรับขั้น skill` }, session: null }),
    async listModels() {
      if (!modelList) {
        const from = await ensure()
        await newSession(from) // an empty session: no prompt, no quota
      }
      return modelList ?? []
    },
    stop() {
      rpc?.proc.kill()
    },
  }
}
