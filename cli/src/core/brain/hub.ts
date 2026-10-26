// The Brain the rest of Neo sees: it knows every provider (Claude Code, ACP agents, OpenAI-compatible, HTTP), which one is
// chosen and which model, and forwards each ask to the chosen one. Ported from the provider code in app/server.js.
import { join } from 'node:path'
import type { Card, DiscoveredAgent, ModelEntry, ModelList, ProviderConfig, ProviderConfigView, ProviderInfo, ProviderList } from '../../protocol'
import { textCard } from '../cards/cards'
import type { Events } from '../events/events'
import { homedir } from 'node:os'
import { createAcpBrain, toAcpMcp } from './acp'
import { readApiKey } from './api-key'
import type { Brain, Provider, Reply } from './brain'
import { discoverVerified, publicAgent, type Discovery, type Found } from './discover'
import { pickMcpServers } from './mcp-config'
import { createHttpBrain, createOpenAiBrain } from './plain'
import { BrainError, cleanConfig, readProvidersFile, writeKeyFile, writeProvidersFile, type ProvidersFile } from './providers-file'
import { MODEL_SWITCH, SWITCH, findModel, findProvider } from './switch-phrases'

export { BrainError } from './providers-file'

type Env = Record<string, string | undefined>
type Entry = ProviderConfig & { found?: true }

const DEFAULT_NAME = 'claude'
const CLAUDE: ProviderConfig = { type: 'claude-code', label: 'Claude Code' }
const PET = 'นีโอ'
const TITLE_MAX = 16

export interface HubOptions {
  /** NEO_HOME */
  home: string
  events: Events
  /** The environment the daemon runs in; `NEO_PROVIDER` and API key variables are read from it. */
  env: Env
  homeDir?: string
  /** Where the choice is kept (state.json): `provider`, and `model: {<provider>: alias | id | null}`. */
  store: { read(key: string): unknown; write(key: string, value: unknown): Promise<void> }
  /** Claude Code as a provider. `model` is the chosen model, or null for its own default. */
  claude(model: () => string | null): Brain
  /** What an ACP agent is told about Neo's MCP servers (the same ones Claude Code gets). */
  mcp: { configDir?(): string | undefined; servers?(): readonly string[] | undefined; neoCommand: readonly [string, ...string[]] }
  /** Agents the machine offers. Default: none (the daemon passes the real one). */
  discover?(): Promise<Discovery>
  petName?(): string
  bypass(): boolean
  /** Where agents run (`NEO_HOME/tasks`). */
  cwd?: string
  /** The label or model shown in `status` changed. */
  onChange?(): void
  /** A different provider is now in use: whatever conversation was going on cannot continue with it. */
  onProviderChange?(): void
  log?(message: string): void
}

export async function createBrainHub(options: HubOptions) {
  const { home, events, env, store } = options
  const log = options.log ?? (() => {})
  const file = join(home, 'providers.json')
  const cwd = options.cwd ?? join(home, 'tasks')
  const petName = () => options.petName?.() ?? PET

  let conf: ProvidersFile
  {
    const read = await readProvidersFile(file)
    conf = read.conf
    if (read.problem) log(read.problem)
  }
  let found: Found[] = []
  const cache = new Map<string, Provider>()
  const modelCache = new Map<string, ModelEntry[]>()

  // ---- what exists ----

  /** Discovered agents that can run here, with the user's overrides on top; then custom endpoints. */
  function table(): Record<string, Entry> {
    const out: Record<string, Entry> = { claude: { ...CLAUDE, ...conf.providers.claude, found: true } }
    for (const agent of found) {
      if (!agent.available) continue
      const base: ProviderConfig = agent.type === 'claude-code'
        ? { type: 'claude-code', label: agent.label }
        : { type: 'acp', label: agent.label, command: agent.command, args: agent.args ?? [] }
      out[agent.name] = { ...base, ...conf.providers[agent.name], found: true }
    }
    for (const [name, cfg] of Object.entries(conf.providers)) {
      if (!out[name] && cfg.type && !found.some(a => a.name === name)) out[name] = cfg
    }
    return out
  }
  const entry = (name: string) => {
    const cfg = table()[name]
    if (!cfg) throw new BrainError(`ไม่รู้จัก provider ${name} (ดู neo provider list)`)
    return cfg
  }

  const models = (): Record<string, string | null> => {
    const raw = store.read('model')
    return raw && typeof raw === 'object' ? { ...(raw as Record<string, string | null>) } : {}
  }
  const chosenModel = (name: string): string | null => models()[name] ?? table()[name]?.model ?? null
  /** A nickname from `models` → the real id; anything else is used as typed. */
  const resolveModel = (name: string, value: string | null): string | null =>
    value == null || value === '' ? null : (table()[name]?.models?.[value] ?? value)

  const startName = () => {
    const names = table()
    const saved = store.read('provider')
    return [env.NEO_PROVIDER, typeof saved === 'string' ? saved : undefined, conf.default, DEFAULT_NAME, ...Object.keys(names)].find((n): n is string => Boolean(n) && n! in names)!
  }
  const labelOf = (name: string) => table()[name]?.label || name

  // ---- provider instances ----

  function create(name: string, cfg: Entry): Provider {
    const model = () => resolveModel(name, chosenModel(name))
    const claudeConfigDir = options.mcp.configDir
    switch (cfg.type) {
      case 'claude-code': {
        const inner = options.claude(() => {
          const id = model()
          return id && id !== 'default' ? id : null
        })
        return {
          label: cfg.label || inner.label,
          ask: r => inner.ask(r),
          runSkill: r => inner.runSkill(r),
          dream: inner.dream && (r => inner.dream!(r)),
          // the live list comes from the Claude ACP agent on this Mac (same account); there is no list written down here
          listModels: async () => {
            const acp = Object.entries(table()).find(([n, c]) => n !== name && c.type === 'acp' && /claude/i.test(n))
            return acp ? get(acp[0]).listModels() : []
          },
        }
      }
      case 'acp':
        return createAcpBrain({
          name, cfg, cwd, env, claudeConfigDir, model, log,
          mcpServers: async () => toAcpMcp(await pickMcpServers({ configDir: claudeConfigDir?.(), servers: options.mcp.servers?.(), neoCommand: options.mcp.neoCommand })),
        })
      case 'openai':
        return createOpenAiBrain({ name, cfg, env, homeDir: options.homeDir, model })
      case 'http':
        return createHttpBrain({ name, cfg, env, homeDir: options.homeDir, model })
      default:
        throw new BrainError(`ไม่รู้จัก provider type ${String(cfg.type)}`)
    }
  }
  function get(name: string): Provider {
    let provider = cache.get(name)
    if (!provider) {
      provider = create(name, entry(name))
      cache.set(name, provider)
    }
    return provider
  }
  function forget(name: string) {
    cache.get(name)?.stop?.()
    cache.delete(name)
    modelCache.delete(name)
  }

  let active = startName()
  /** Tell the owner what changed: always the status, and a new conversation when the provider in use is another one. */
  const changed = () => {
    const now = startName()
    if (now !== active) {
      active = now
      options.onProviderChange?.()
    }
    options.onChange?.()
  }
  const announceProvider = () => events.publish({ type: 'provider', name: startName(), label: labelOf(startName()) })

  // ---- the Brain Conversation talks to ----

  const failure = (e: unknown): Reply => ({ answer: { type: 'error', error: e instanceof BrainError ? e.message : String((e as Error)?.message ?? e) }, session: null })
  const brain: Brain = {
    get label() {
      return labelOf(startName())
    },
    async ask(request) {
      try {
        return await get(startName()).ask(request)
      } catch (e) {
        return failure(e)
      }
    },
    async runSkill(request) {
      try {
        return await get(startName()).runSkill(request)
      } catch (e) {
        return failure(e)
      }
    },
    async dream(request) {
      try {
        const provider = get(startName())
        return provider.dream ? await provider.dream(request) : { type: 'error', error: `${provider.label} ฝันไม่ได้ (ต้องใช้ Claude Code ที่ค้นข้อมูลเองได้)` }
      } catch (e) {
        return { type: 'error', error: e instanceof BrainError ? e.message : String((e as Error)?.message ?? e) }
      }
    },
  }

  // ---- actions ----

  const providerCard = (name: string): Card => {
    const model = chosenModel(name)
    return textCard({
      icon: 'task', title: `ใช้ ${labelOf(name)}`,
      lines: [`ต่อจากนี้ ${petName()} ถาม ${labelOf(name)} แทน`, ...(model ? [`โมเดล: ${model}`] : []), 'พูด "สลับไปใช้ …" เพื่อเปลี่ยนอีก'],
      emotion: 'excited', sounds: ['happy'], seconds: 10,
    })
  }
  const modelCard = (name: string, value: string | null): Card => {
    const id = resolveModel(name, value)
    const shown = value || 'ค่าเริ่มต้น'
    // a card title holds 16 characters: "โมเดล x" when it fits, else the bare name (after any provider/ prefix), else a generic title; the full id stays in the lines
    const short = shown.split('/').pop()!
    const title = `โมเดล ${shown}`.length <= TITLE_MAX ? `โมเดล ${shown}` : short.length <= TITLE_MAX ? short : 'เปลี่ยนโมเดล'
    return textCard({
      icon: 'task', title,
      lines: [labelOf(name), ...(title === `โมเดล ${shown}` ? [] : [shown]), ...(id && id !== value ? [id] : [])],
      emotion: 'proud', sounds: ['happy'], seconds: 8,
    })
  }

  async function use(name: string): Promise<Card> {
    entry(name)
    await store.write('provider', name)
    log(`provider → ${labelOf(name)}`)
    announceProvider()
    changed()
    return providerCard(name)
  }

  async function useModel(value: string | null, name = startName()): Promise<Card> {
    entry(name)
    const chosen = value === '' ? null : value
    await store.write('model', { ...models(), [name]: chosen })
    get(name) // build it now so a bad config shows up here
    const id = resolveModel(name, chosen)
    log(`model ${name} → ${chosen}${id !== chosen ? ` (${id})` : ''}`)
    events.publish({ type: 'model', name, model: chosen, id })
    changed()
    return modelCard(name, chosen)
  }

  async function listModels(name = startName()): Promise<ModelList> {
    const cfg = entry(name)
    const mapped = Object.entries(cfg.models ?? {}).map(([alias, id]) => ({ alias, id }))
    try {
      const list = await get(name).listModels()
      modelCache.set(name, list)
      return { name, mapped, list, current: chosenModel(name) }
    } catch (e) {
      return { name, mapped, list: [], current: chosenModel(name), error: (e as Error).message }
    }
  }

  const list = (): ProviderList => ({
    current: startName(),
    list: Object.entries(table()).map(([name, c]): ProviderInfo => ({ name, label: c.label || name, type: c.type, found: Boolean(c.found), model: chosenModel(name) })),
  })

  /** Look for agents again. A `provider` event follows when asked for (`neo provider discover`) or when what is in use changed. */
  async function refresh({ announce = false } = {}): Promise<DiscoveredAgent[]> {
    const run = options.discover ?? (async () => ({ agents: [], acpx: false }))
    const before = `${startName()}\n${labelOf(startName())}`
    const result = await run()
    found = result.agents
    for (const name of [...cache.keys()]) if (!table()[name]) forget(name) // an agent that went away
    log(`agents: ${found.filter(a => a.available).map(a => a.name).join(', ') || '(ไม่มี)'}${result.acpx ? '' : ' (ไม่พบ acpx registry)'}`)
    if (announce || before !== `${startName()}\n${labelOf(startName())}`) announceProvider()
    changed()
    return found.map(publicAgent)
  }

  function config(): ProviderConfigView {
    const providers = table()
    return {
      default: conf.default ?? DEFAULT_NAME,
      providers,
      overrides: conf.providers,
      discovered: found.map(publicAgent),
      keys: Object.fromEntries(Object.entries(providers).map(([name, c]) => [name, readApiKey(c, env, options.homeDir) !== ''])),
    }
  }

  async function saveConfig({ name, cfg, apiKey, remove }: { name: string; cfg?: ProviderConfig; apiKey?: string; remove?: boolean }) {
    const next: ProvidersFile = { ...conf, providers: { ...conf.providers } }
    if (remove) {
      if (name === startName()) throw new BrainError('ลบตัวที่ใช้อยู่ไม่ได้ — สลับไปตัวอื่นก่อน (neo provider use …)')
      if (!(name in conf.providers)) throw new BrainError(`ไม่มีการตั้งค่า ${name} ใน providers.json`)
      delete next.providers[name]
      await store.write('model', Object.fromEntries(Object.entries(models()).filter(([n]) => n !== name)))
    } else {
      const clean = cleanConfig(name, cfg, found.some(a => a.name === name && a.available) || name === DEFAULT_NAME)
      if (apiKey?.trim()) {
        const path = join(home, `${name}.key`)
        await writeKeyFile(path, apiKey)
        clean.apiKeyFile = path.startsWith(`${options.homeDir ?? homedir()}/`) ? path.replace(options.homeDir ?? homedir(), '~') : path
      }
      next.providers[name] = clean
    }
    await writeProvidersFile(file, next)
    conf = next
    forget(name)
    log(`provider ${remove ? 'removed' : 'saved'} ${name}`)
    announceProvider()
    changed()
  }

  /** The spoken switch phrases (fast phrases): a card when it was one, null to let the Brain answer. */
  async function understand(text: string): Promise<Card | null> {
    const said = text.trim()
    const asModel = said.match(MODEL_SWITCH)
    if (asModel) {
      const name = startName()
      if (!modelCache.has(name)) modelCache.set(name, await get(name).listModels().catch(() => []))
      const model = findModel(asModel[1]!, entry(name), modelCache.get(name) ?? [])
      if (model) return useModel(model, name)
      return textCard({
        icon: 'task', title: 'ไม่รู้จักโมเดลนี้',
        lines: [`"${asModel[1]}" ไม่อยู่ในรายการของ ${labelOf(name)}`, 'ตั้งชื่อเล่นได้ใน providers.json (models)'],
        emotion: 'confused', sounds: ['confused'],
      })
    }
    const asProvider = said.match(SWITCH)
    if (asProvider) {
      const name = findProvider(asProvider[1]!, table())
      if (name) return use(name)
    }
    return null
  }

  return {
    brain,
    /** The provider name in use. */
    current: startName,
    /** What `status` shows: the provider's label and the chosen model. */
    status: () => ({ provider: labelOf(startName()), model: chosenModel(startName()) }),
    list, use, useModel, listModels, refresh, config, saveConfig, understand,
    stop() {
      for (const provider of cache.values()) provider.stop?.()
      cache.clear()
    },
  }
}

export type BrainHub = Awaited<ReturnType<typeof createBrainHub>>
/** The real discovery, with the daemon's environment. */
export const realDiscovery = (env: Env) => () => discoverVerified({ env })
