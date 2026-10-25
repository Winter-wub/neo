import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import type { HomePlace, IdleSettings, Settings, SettingsPatch } from '../../protocol'
import type { Events } from '../events/events'
import { homeOf } from '../weather/weather'

export const IDLE_MIN = 15
export const IDLE_MAX = 3600
const DEFAULT_IDLE = { sleepAfter: 150, clock: true } as const satisfies IdleSettings
const BOOLEANS = ['requireName', 'followUp', 'bypass', 'tailscale', 'lan', 'dream', 'onboarded'] as const
const DEFAULT_BOOLEANS = { requireName: true, followUp: true, bypass: true, tailscale: true, lan: false, dream: true, onboarded: false } as const satisfies Record<(typeof BOOLEANS)[number], boolean>
const UNSET_WORDS = ['unset', 'none', 'default']

export class SettingsError extends Error {}

const clampSleep = (seconds: number) => Math.min(IDLE_MAX, Math.max(IDLE_MIN, Math.round(seconds)))
const isUnset = (args: string[]) => args.length === 1 && UNSET_WORDS.includes(args[0]!.toLowerCase())

function toBoolean(key: string, text: string | undefined) {
  if (text !== 'true' && text !== 'false') throw new SettingsError(`${key} ต้องเป็น true หรือ false`)
  return text === 'true'
}

function toNumber(label: string, text: string | undefined) {
  const value = Number(text)
  if (!text?.trim() || !Number.isFinite(value)) throw new SettingsError(`${label} ต้องเป็นตัวเลข`)
  return value
}

function checkedConfigDir(value: unknown) {
  if (typeof value !== 'string') throw new SettingsError('claudeConfigDir ต้องเป็น path เต็มของโฟลเดอร์ (หรือ unset)')
  const path = value === '~' || value.startsWith('~/') ? join(homedir(), value.slice(1)) : value
  if (!isAbsolute(path)) throw new SettingsError('claudeConfigDir ต้องเป็น path เต็มของโฟลเดอร์ เช่น /Users/you/.claude (หรือ unset)')
  return path
}

function checkedHome(value: unknown): HomePlace {
  const { city, lat, lon } = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>
  if (typeof city !== 'string' || !city.trim()) throw new SettingsError('home ต้องมี city lat lon เช่น neo settings set home เชียงใหม่ 18.79 98.98')
  if (typeof lat !== 'number' || !Number.isFinite(lat) || Math.abs(lat) > 90) throw new SettingsError('lat ต้องเป็นตัวเลขระหว่าง -90 ถึง 90')
  if (typeof lon !== 'number' || !Number.isFinite(lon) || Math.abs(lon) > 180) throw new SettingsError('lon ต้องเป็นตัวเลขระหว่าง -180 ถึง 180')
  return { city: city.trim(), lat, lon }
}

function checkedServers(value: unknown) {
  const names = Array.isArray(value) ? value.map(name => (typeof name === 'string' ? name.trim() : '')) : []
  if (!names.length || names.some(name => !name)) throw new SettingsError('mcpServers ต้องเป็นชื่อ MCP server คั่นด้วยจุลภาค เช่น MCP_DOCKER,peekaboo (หรือ unset)')
  return names
}

function checkedIdle(value: unknown): Partial<IdleSettings> {
  if (typeof value !== 'object' || value === null) throw new SettingsError('idle ใช้ idle.sleepAfter หรือ idle.clock')
  const next: Partial<IdleSettings> = {}
  for (const [key, part] of Object.entries(value)) {
    if (key === 'sleepAfter') {
      if (typeof part !== 'number' || !Number.isFinite(part)) throw new SettingsError('idle.sleepAfter ต้องเป็นตัวเลข (วินาที)')
      next.sleepAfter = clampSleep(part)
    } else if (key === 'clock') {
      if (typeof part !== 'boolean') throw new SettingsError('idle.clock ต้องเป็น true หรือ false')
      next.clock = part
    } else throw new SettingsError(`ไม่มีการตั้งค่า idle.${key}`)
  }
  return next
}

/** The typed patch for `neo settings set <name> <args…>`; the strings are what the command line sent. */
function patchFromArgs(name: string, args: string[]): SettingsPatch & { unset?: Array<'claudeConfigDir' | 'home' | 'mcpServers'> } {
  if ((BOOLEANS as readonly string[]).includes(name)) return { [name]: toBoolean(name, args[0]) }
  switch (name) {
    case 'idle.sleepAfter': return { idle: { sleepAfter: clampSleep(toNumber('idle.sleepAfter', args[0])) } }
    case 'idle.clock': return { idle: { clock: toBoolean('idle.clock', args[0]) } }
    case 'claudeConfigDir': return isUnset(args) ? { unset: [name] } : { claudeConfigDir: checkedConfigDir(args[0]) }
    case 'home': {
      if (isUnset(args)) return { unset: [name] }
      if (args.length === 1) {
        try { return { home: checkedHome(JSON.parse(args[0]!)) } } catch (e) { if (e instanceof SettingsError) throw e }
      }
      if (args.length !== 3) throw new SettingsError('home ต้องมี city lat lon เช่น neo settings set home เชียงใหม่ 18.79 98.98')
      return { home: checkedHome({ city: args[0], lat: toNumber('lat', args[1]), lon: toNumber('lon', args[2]) }) }
    }
    case 'mcpServers': return isUnset(args) ? { unset: [name] } : { mcpServers: checkedServers(args.join(',').split(',')) }
    case 'idle': throw new SettingsError('idle ใช้ idle.sleepAfter <วินาที> หรือ idle.clock <true|false>')
    default: throw new SettingsError(`ไม่มีการตั้งค่า ${name}`)
  }
}

export async function createSettings({ home, events }: { home: string; events: Events }) {
  const file = join(home, 'state.json')
  let state: Record<string, unknown> = {}
  try {
    state = JSON.parse(await readFile(file, 'utf8'))
  } catch {
    // missing or unreadable: start from defaults
  }

  const idleOf = (): IdleSettings => {
    const saved = (typeof state.idle === 'object' && state.idle !== null ? state.idle : {}) as Record<string, unknown>
    return {
      sleepAfter: typeof saved.sleepAfter === 'number' && Number.isFinite(saved.sleepAfter) ? clampSleep(saved.sleepAfter) : DEFAULT_IDLE.sleepAfter,
      clock: typeof saved.clock === 'boolean' ? saved.clock : DEFAULT_IDLE.clock,
    }
  }
  const serversOf = () => (Array.isArray(state.mcpServers) && state.mcpServers.length && state.mcpServers.every(n => typeof n === 'string' && n) ? (state.mcpServers as string[]) : null)

  const get = (): Settings => {
    const flag = <K extends keyof typeof DEFAULT_BOOLEANS>(key: K) => (typeof state[key] === 'boolean' ? (state[key] as boolean) : DEFAULT_BOOLEANS[key])
    return {
      requireName: flag('requireName'),
      followUp: flag('followUp'),
      bypass: flag('bypass'),
      tailscale: flag('tailscale'),
      lan: flag('lan'),
      idle: idleOf(),
      dream: flag('dream'),
      onboarded: flag('onboarded'),
      claudeConfigDir: typeof state.claudeConfigDir === 'string' && state.claudeConfigDir ? state.claudeConfigDir : null,
      home: homeOf(state.home),
      mcpServers: serversOf(),
    }
  }

  async function save() {
    await mkdir(home, { recursive: true, mode: 0o700 })
    const tmp = `${file}.tmp`
    await writeFile(tmp, JSON.stringify(state, null, 1), { mode: 0o600 })
    await rename(tmp, file)
  }

  /** Checks every value first, so a bad one changes nothing. */
  function validated(patch: SettingsPatch & { unset?: string[] }) {
    const next: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(patch)) {
      if (key === 'unset') continue
      if ((BOOLEANS as readonly string[]).includes(key)) {
        if (typeof value !== 'boolean') throw new SettingsError(`${key} ต้องเป็น true หรือ false`)
        next[key] = value
      } else if (key === 'idle') next.idle = { ...idleOf(), ...checkedIdle(value) }
      else if (key === 'claudeConfigDir') next[key] = value === null ? null : checkedConfigDir(value)
      else if (key === 'home') next[key] = checkedHome(value)
      else if (key === 'mcpServers') next[key] = value === null ? null : checkedServers(value)
      else throw new SettingsError(`ไม่มีการตั้งค่า ${key}`)
    }
    return next
  }

  async function apply(patch: SettingsPatch & { unset?: string[] }) {
    const next = validated(patch)
    const before = get()
    state = { ...state, ...next }
    for (const key of patch.unset ?? []) delete state[key]
    for (const key of Object.keys(next)) if (next[key] === null) delete state[key]
    const after = get()
    if (JSON.stringify(after) !== JSON.stringify(before)) {
      await save()
      events.publish({ type: 'settings', ...after })
      if (JSON.stringify(after.idle) !== JSON.stringify(before.idle)) events.publish({ type: 'idle', ...after.idle })
    }
    return after
  }

  return {
    get,
    /** A value other modules keep inside state.json (the chosen provider and models …). */
    raw: (key: string): unknown => state[key],
    async setRaw(key: string, value: unknown) {
      state = { ...state, [key]: value }
      await save()
    },
    set: async (patch: SettingsPatch) => apply(patch),
    /** `neo settings set <name> <args…>`: parses the words, validates, saves. */
    setByKey: async (name: string, args: string[]) => apply(patchFromArgs(name, args)),
  }
}

export type SettingsModule = Awaited<ReturnType<typeof createSettings>>
