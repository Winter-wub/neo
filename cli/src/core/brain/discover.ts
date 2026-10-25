// Finds the brains this Mac offers without a hard-coded list: Claude Code if `claude` is on the PATH, and every agent in the
// acpx registry that can really run here. `npx` commands are never run (no downloads): they are replaced by the package
// when it is installed globally or its binary is on the PATH. A candidate is verified by speaking ACP `initialize` to it
// (no prompt, no quota). Ported from app/discover.js.
import { execFile, spawn } from 'node:child_process'
import { accessSync, constants, existsSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DiscoveredAgent } from '../../protocol'
import { childEnv } from './child-env'

export type Env = Record<string, string | undefined>

/** A discovered agent plus how to start it. */
export interface Found extends DiscoveredAgent {
  command?: string
  args?: string[]
  agentInfo?: { name?: string; title?: string }
}
export interface Discovery {
  agents: Found[]
  /** An acpx registry was found. */
  acpx: boolean
}

const NPM_TIMEOUT_MS = 8000
export const PROBE_TIMEOUT_MS = 10_000

/** Where binaries are looked for: the daemon's PATH plus the usual user install places. */
const usualBinDirs = (home: string) => [join(home, '.local/bin'), '/opt/homebrew/bin', '/usr/local/bin']
function searchPath(env: Env, extra: readonly string[], globalRoot: string | null) {
  return [...new Set([...(env.PATH ?? '').split(':'), ...extra, globalRoot && join(globalRoot, '..', '..', 'bin')].filter((d): d is string => Boolean(d)))]
}

export function which(bin: string, dirs: readonly string[]): string | null {
  for (const dir of dirs) {
    const file = join(dir, bin)
    try {
      accessSync(file, constants.X_OK)
      if (statSync(file).isFile()) return realpathSync(file) // real path: not a temporary shim (fnm)
    } catch {
      // not here
    }
  }
  return null
}

const npmRootGlobal = () =>
  new Promise<string | null>(resolve => {
    execFile('npm', ['root', '-g'], { encoding: 'utf8', timeout: NPM_TIMEOUT_MS }, (error, out) => resolve(error ? null : out.trim()))
  })

/** acpx's AGENT_REGISTRY, read from its installed files → `{name: "command args"}`. */
export function acpxRegistry(globalRoot: string | null): Record<string, string> {
  const dist = globalRoot && join(globalRoot, 'acpx', 'dist')
  if (!dist || !existsSync(dist)) return {}
  for (const file of readdirSync(dist).filter(f => f.endsWith('.js'))) {
    const source = readFileSync(join(dist, file), 'utf8')
    const block = source.match(/const AGENT_REGISTRY = \{([\s\S]*?)\n\};/)
    if (!block) continue
    const ranges: Record<string, string> = {}
    const rangeBlock = source.match(/const ACP_ADAPTER_PACKAGE_RANGES = \{([\s\S]*?)\};/)
    if (rangeBlock) for (const [, key, value] of rangeBlock[1]!.matchAll(/(\w+):\s*"([^"]*)"/g)) ranges[key!] = value!
    const out: Record<string, string> = {}
    for (const [, key, value] of block[1]!.matchAll(/([\w-]+):\s*[`"]([^`"]+)[`"]/g)) {
      out[key!] = value!.replace(/\$\{ACP_ADAPTER_PACKAGE_RANGES\.(\w+)\}/g, (_, name) => ranges[name] ?? '')
    }
    return out
  }
  return {}
}

/** `npx some-pkg@1 --flag` → the installed binary (global npm package, or a binary on the PATH). Never downloads. */
export function resolveNpx(words: readonly string[], globalRoot: string | null, dirs: readonly string[]) {
  const i = words.findIndex(w => !w.startsWith('-') && w !== 'npx')
  const spec = words[i]
  if (!spec) return null
  const rest = words.slice(i + 1)
  const pkg = spec.replace(/@[^@/]*$/, '') || spec // drop a trailing version
  if (globalRoot) {
    try {
      const manifest = JSON.parse(readFileSync(join(globalRoot, pkg, 'package.json'), 'utf8'))
      const bins: Record<string, string> = typeof manifest.bin === 'string' ? { [pkg.split('/').pop()!]: manifest.bin } : (manifest.bin ?? {})
      for (const bin of Object.keys(bins)) {
        const file = which(bin, dirs)
        if (file) return { command: file, args: rest, via: `global ${pkg}` }
      }
    } catch {
      // not installed globally
    }
  }
  const base = pkg.split('/').pop()!
  for (const bin of new Set([base, base.replace(/-ai$/, '')])) { // opencode-ai → opencode (not -acp: the adapter differs from the CLI)
    const file = which(bin, dirs)
    if (file) return { command: file, args: rest, via: `PATH ${bin}` }
  }
  return null
}

/** Speak ACP `initialize` (nothing else) to a command: is it really an ACP agent? */
export function probe(command: string, args: readonly string[], env: Env, ms = PROBE_TIMEOUT_MS): Promise<{ name?: string; title?: string } | null> {
  return new Promise(resolve => {
    let child
    try {
      child = spawn(command, [...args], { env: childEnv(env), cwd: tmpdir(), stdio: ['pipe', 'pipe', 'ignore'] })
    } catch {
      return resolve(null)
    }
    let buffer = ''
    const done = (value: { name?: string; title?: string } | null) => {
      clearTimeout(timer)
      try { child.kill() } catch { /* gone */ }
      resolve(value)
    }
    const timer = setTimeout(() => done(null), ms)
    child.on('error', () => done(null))
    child.on('close', () => done(null))
    child.stdin.on('error', () => {})
    child.stdout.on('data', (data: Buffer) => {
      buffer += data.toString('utf8')
      for (const line of buffer.split('\n')) {
        try {
          const message = JSON.parse(line)
          if (message.id === 1) return done(message.result ? (message.result.agentInfo ?? {}) : null)
        } catch {
          // partial line
        }
      }
    })
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: 1, clientCapabilities: {} } }) + '\n')
  })
}

export interface DiscoverDeps {
  env: Env
  homeDir?: string
  /** Folders searched after the PATH (default: ~/.local/bin, Homebrew, /usr/local/bin). */
  extraPath?: readonly string[]
  /** `npm root -g`; tests give a folder. */
  npmRoot?: () => Promise<string | null>
  probe?: typeof probe
}

/** What is installed, quickly (no ACP talk yet): `available` means the command was found. */
export async function discoverInstalled({ env, homeDir = homedir(), extraPath = usualBinDirs(homeDir), npmRoot = npmRootGlobal }: DiscoverDeps): Promise<Discovery> {
  const globalRoot = await npmRoot()
  const dirs = searchPath(env, extraPath, globalRoot)
  const registry = acpxRegistry(globalRoot)
  const agents: Found[] = []
  const claude = which('claude', dirs)
  if (claude) agents.push({ name: 'claude', label: 'Claude Code', type: 'claude-code', available: true, via: claude })
  for (const [name, line] of Object.entries(registry)) {
    const words = line.trim().split(/\s+/)
    const first = words[0]!
    const resolved = first === 'npx' ? resolveNpx(words, globalRoot, dirs) : (() => {
      const file = which(first, dirs)
      return file ? { command: file, args: words.slice(1), via: `PATH ${first}` } : null
    })()
    agents.push({
      name: name === 'claude' ? 'claude-acp' : name,
      label: name === 'claude' ? 'Claude Code (ACP)' : name,
      type: 'acp', available: Boolean(resolved), registry: line, ...(resolved ?? {}),
    })
  }
  return { agents, acpx: Object.keys(registry).length > 0 }
}

/** Like `discoverInstalled`, then each found agent must answer ACP `initialize`; the ones that do not are marked unavailable with a reason. */
export async function discoverVerified(deps: DiscoverDeps): Promise<Discovery> {
  const found = await discoverInstalled(deps)
  const ask = deps.probe ?? probe
  await Promise.all(found.agents.filter(a => a.type === 'acp' && a.available).map(async agent => {
    const info = await ask(agent.command!, agent.args ?? [], deps.env)
    if (info) {
      agent.agentInfo = info
      if (info.title || info.name) agent.label = agent.name === 'claude-acp' ? 'Claude Code (ACP)' : (info.title ?? info.name)!
    } else {
      agent.available = false
      agent.why = `เจอคำสั่ง ${agent.command} แต่ไม่ตอบ ACP`
    }
  }))
  return found
}

/** What `neo provider discover` shows (no start commands). */
export const publicAgent = ({ name, label, type, available, via, registry, why }: Found): DiscoveredAgent => ({
  name, label, type, available,
  ...(via !== undefined && { via }), ...(registry !== undefined && { registry }), ...(why !== undefined && { why }),
})
