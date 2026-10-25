import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

/** The Claude Code MCP servers Neo borrows (read tools only are allowed by the read-only flag set). */
export const DEFAULT_MCP_SERVERS = ['MCP_DOCKER', 'ccs-websearch'] as const

export interface McpConfigOptions {
  file: string
  /** Claude Code's config dir (setting `claudeConfigDir`); unset → Claude Code's own default `~/.claude.json`. */
  configDir?: string
  servers?: readonly string[]
  /** How a child starts the agents MCP server: `[<neo binary>, 'mcp']`. */
  neoCommand: readonly [string, ...string[]]
}

/** The chosen servers from Claude Code's own config, plus the `neo-agents` server. */
export async function pickMcpServers({ configDir, servers = DEFAULT_MCP_SERVERS, neoCommand }: Omit<McpConfigOptions, 'file'>) {
  const picked: Record<string, any> = {}
  try {
    const source = configDir ? join(configDir, '.claude.json') : join(homedir(), '.claude.json')
    const all = JSON.parse(await readFile(source, 'utf8')).mcpServers ?? {}
    for (const name of servers) if (all[name]) picked[name] = all[name]
  } catch {
    // no Claude Code config: only neo-agents
  }
  const [command, ...args] = neoCommand
  picked['neo-agents'] = { command, args }
  return picked
}

/** Copy the chosen servers (they hold tokens, so mode 0600) and add the `neo-agents` server. */
export async function writeMcpConfig({ file, ...options }: McpConfigOptions) {
  const picked = await pickMcpServers(options)
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, JSON.stringify({ mcpServers: picked }), { mode: 0o600 })
}
