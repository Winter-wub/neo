// The single definition of every shape that crosses a process boundary:
// events, command-socket requests and responses. Plain types only: no runtime schema, no version field in payloads.

export const PROTOCOL_VERSION = 1
export const PROTOCOL_HEADER = 'x-neo-protocol'
export const DAEMON_VERSION = '0.1.0'

export interface Pet {
  hunger: number
  affection: number
  at: number
}

/** `neo status` / `GET /status` */
export interface Status {
  phone: boolean
  consoles: number
  provider: string
  model: string | null
  thinking: boolean
  /** An alarm is ringing. */
  ringing: boolean
  /** A task job is running or waiting to retry. Neo Console restarts the daemon only when neither this nor `ringing` is set. */
  busy: boolean
  requireName: boolean
  bypass: boolean
  pet: Pet | null
  uptime: number
  pid: number
}

export interface Settings {
  requireName: boolean
  followUp: boolean
  bypass: boolean
  /** Listen for the phone on the Tailscale/VPN address (default on). */
  tailscale: boolean
  /** Listen for the phone on the Wi-Fi/LAN address (default off; token but no encryption). */
  lan: boolean
  /** How long the phone is quiet before it dozes (15..3600 s), and whether it then shows the clock face. */
  idle: IdleSettings
  /** Dream (tidy memory) while nobody is around. */
  dream: boolean
  /** Neo Console's onboarding is finished. */
  onboarded: boolean
  /** Where Claude Code keeps its config; null = not passed on, so `claude` uses its own default. */
  claudeConfigDir: string | null
  /** What "here" means for the weather. */
  home: HomePlace
  /** Which Claude Code MCP servers Neo borrows; null = the built-in short list. */
  mcpServers: string[] | null
}

export interface IdleSettings {
  sleepAfter: number
  clock: boolean
}
export interface HomePlace {
  city: string
  lat: number
  lon: number
}

export type SettingsKey = keyof Settings
/** The names `neo settings set` takes: the keys of `Settings`, with `idle` split in two. */
export const SETTING_NAMES = [
  'requireName', 'followUp', 'bypass', 'tailscale', 'lan', 'idle.sleepAfter', 'idle.clock',
  'dream', 'onboarded', 'claudeConfigDir', 'home', 'mcpServers',
] as const
export type SettingName = (typeof SETTING_NAMES)[number]
/** `POST /settings`: any subset; `idle` may be partial. */
export type SettingsPatch = Partial<Omit<Settings, 'idle'>> & { idle?: Partial<IdleSettings> }

export interface DaemonInfo {
  version: string
  build: string
  protocol: number
}

/** One row of a `list` card. */
export interface CardItem {
  t: string
  v: string
}

/** What the phone and Neo Console show (contract.md §2.1). Humanized before it leaves the core. */
export interface Card {
  kind: string
  layout: 'text' | 'list' | 'big' | 'pixel'
  icon: string
  title: string
  big?: string
  lines: string[]
  items: CardItem[]
  emotion: string
  sounds: string[]
  seconds: number
  dream?: true
  // pixel pictures
  w?: number
  h?: number
  palette?: Record<string, string>
  frames?: string[][]
  fps?: number
}

// ---- events (every one carries `at`, ms since epoch; `ping` does not) ----

export type StatusEvent = { type: 'status'; at: number } & Status
export type SettingsEvent = { type: 'settings'; at: number } & Settings
/** The phone's idle behaviour changed (`neo settings set idle.sleepAfter|idle.clock`). */
export type IdleEvent = { type: 'idle'; at: number } & IdleSettings
export type PingEvent = { type: 'ping' }

// conversation events (ticket 04); same shapes as contract.md §2
export type HeardEvent = { type: 'heard'; at: number; text: string }
export type IgnoredEvent = { type: 'ignored'; at: number; text: string }
export type ArmedEvent = { type: 'armed'; at: number }
export type ThinkingEvent = { type: 'thinking'; at: number; text: string }
export type SessionEvent = { type: 'session'; at: number; fresh: boolean; turn: number; provider: string }
/** `key` and `animation` (ticket 27): the exact-tool key and the pixel loop Neo drew for it; `animation: null` = none yet. Old NeoApps ignore both. */
export type ToolEvent = { type: 'tool'; at: number; name: string; input: string; key?: string; animation?: ToolAnimation | null }
/** A tool's animation was drawn, redrawn (`animation` set) or removed (`animation: null`). */
export type AnimationEvent = { type: 'animation'; at: number; tool: string; animation: ToolAnimation | null }

/** One pixel loop for one exact tool (`animations/<tool>.json`): 24×24 up to 48×32, ≤12 palette colours, 2–8 frames. */
export interface ToolAnimation {
  /** Exact tool name (`Bash`, `mcp__MCP_DOCKER__jira_search`); for the Skill tool `Skill:<skill name>`. */
  tool: string
  /** The text label the phone showed before the animation existed. */
  label: string
  w: number
  h: number
  palette: Record<string, string>
  frames: string[][]
  fps: number
  /** The Brain that drew it: provider and model. */
  createdBy: string
  at: number
}
/** One row of `neo animation list` (no pixels). */
export interface AnimationInfo {
  tool: string
  label: string
  w: number
  h: number
  frames: number
  fps: number
  createdBy: string
  at: number
}
export interface AnimationRefRequest {
  /** An exact tool key from `GET /animations`, or a part of one that matches a single tool. */
  tool: string
}
export type CardEvent = { type: 'card'; at: number; card: Card }
export type AskerrEvent = { type: 'askerr'; at: number; error: string }
export type CancelledEvent = { type: 'cancelled'; at: number }

// brains (ticket 06): which provider / model answers; same shapes as contract.md §2
export type ProviderEvent = { type: 'provider'; at: number; name: string; label: string }
export type ModelEvent = { type: 'model'; at: number; name: string; model: string | null; id: string | null }

export type ProviderType = 'claude-code' | 'acp' | 'openai' | 'http'
/** One entry of providers.json (user overrides and custom endpoints). Keys are never stored here: only the names of where to read one. */
export interface ProviderConfig {
  type?: ProviderType
  label?: string
  command?: string
  args?: string[]
  baseUrl?: string
  url?: string
  model?: string
  /** alias → model id */
  models?: Record<string, string>
  /** other names the user may say for it */
  aliases?: string[]
  config?: Record<string, string>
  apiKeyEnv?: string
  apiKeyFile?: string
  headers?: Record<string, string>
  _note?: string
}
/** `neo provider list` */
export interface ProviderInfo {
  name: string
  label: string
  type: ProviderType | undefined
  found: boolean
  model: string | null
}
export interface ProviderList {
  current: string
  list: ProviderInfo[]
}
/** `neo provider discover`: what the machine offers (claude, acpx registry agents), probed with ACP `initialize` only. */
export interface DiscoveredAgent {
  name: string
  label: string
  type: 'claude-code' | 'acp'
  available: boolean
  via?: string
  registry?: string
  why?: string
}
/** `neo provider config --json`: never contains key values, only whether one is found. */
/** A provider as `neo provider config` shows it: the saved entry, plus `found` when the machine has what it needs. */
export interface ProviderConfigEntry extends ProviderConfig {
  found?: true
}
export interface ProviderConfigView {
  default: string
  providers: Record<string, ProviderConfigEntry>
  overrides: Record<string, ProviderConfig>
  discovered: DiscoveredAgent[]
  keys: Record<string, boolean>
}
export interface ModelEntry {
  id: string
  name: string
}
/** `neo model list` */
export interface ModelAlias {
  alias: string
  id: string
}
export interface ModelList {
  name: string
  mapped: ModelAlias[]
  list: ModelEntry[]
  current: string | null
  error?: string
}

// speech (ticket 05): what the Ears heard before any words exist
export type RecEvent = { type: 'rec'; at: number }
export type ShortEvent = { type: 'short'; at: number }
export type LoudEvent = { type: 'loud'; at: number }
export type SttEvent = { type: 'stt'; at: number }
export type NothingEvent = { type: 'nothing'; at: number }
export type SttErrEvent = { type: 'stterr'; at: number; error: string }
export type ListenEndEvent = { type: 'listen_end'; at: number }

// phone pairing (ticket 03)
export type PairedEvent = { type: 'paired'; at: number; name: string }
export type DevicesEvent = { type: 'devices'; at: number }

// memory and journal (ticket 11)
export interface MemoryItem {
  section: string
  text: string
  /** Set (by `neo memory show`) when a dream added this item. */
  from?: { id: string; at: number; dream: string }
}
/** `neo memory show --json`. `version` is what a conflict-checked save must send back as `since`. */
export interface MemoryDoc {
  text: string
  version: string
  items: MemoryItem[]
}
/** One turn in a journal day (`time` is local HH:mm; `ok` false = failed or cancelled). */
export interface JournalEntry {
  day: string
  time: string
  q: string
  a: string
  ok: boolean
}
/** `neo journal list --json` */
export interface JournalDay {
  day: string
  entries: number
}
/** `neo journal show --json`: the day's markdown plus its parsed entries. */
export interface JournalDoc {
  day: string
  text: string
  version: string
  entries: JournalEntry[]
}
/** A file the daemon watches changed (an edit in an editor, or a neo command). `day` is set for the journal, `id` for a dream. */
export type ChangedEvent = { type: 'changed'; at: number; file: 'memory' | 'journal' | 'dream'; day?: string; id?: string }
/** A dream began. */
export type DreamingEvent = { type: 'dreaming'; at: number; reason: string; entries: number }
/** A dream ended. Live: `dream` and `insights` (a count) are set. The copy re-sent on every events connect has only `card`. */
export type DreamDoneEvent = { type: 'dream_done'; at: number; card: Card; dream?: string; insights?: number }
export type DreamFailEvent = { type: 'dream_fail'; at: number; error: string }

// dreams (ticket 12)
/** One line of `neo dream list`. */
export interface DreamInfo {
  /** The file name without `.md`: `YYYY-MM-DD-HHmm`. */
  id: string
  at: number
  reason: string
  /** ms */
  took: number
  /** Journal turns it read. */
  entries: number
  dream: string
  insights: number
  /** The phone has not shown its card yet. */
  undelivered: boolean
}
/** `neo dream show --json`: the file's markdown plus what it says. */
export interface DreamInsight {
  q: string
  finding: string
}
/** What the dream card says, before it becomes a `Card`. */
export interface DreamCardView {
  title: string
  lines: string[]
  items: CardItem[]
}
export interface DreamDoc {
  id: string
  text: string
  version: string
  at: number
  reason: string
  took: number
  entries: number
  dream: string
  insights: DreamInsight[]
  patterns: string[]
  added: string[]
  removed: string[]
  card: DreamCardView
  undelivered: boolean
}
/** `neo dream status --json` */
export interface DreamStatus {
  /** The `dream` setting. */
  enabled: boolean
  running: boolean
  last: DreamInfo | null
  /** Why a dream starts now (the 5-minute check would pick it up); null when none would. */
  why: string | null
  /** Why not, in words; null when `why` is set. */
  blocked: string | null
  /** Journal turns since the last dream. */
  newEntries: number
  /** Minutes since the user was last around. */
  idleMinutes: number
  quietNow: boolean
  /** Hours of the day (0–23) that are normally quiet. */
  quietHours: number[]
  /** Per hour of the day, 0..1 relative to the busiest. */
  activity: number[]
}

// jobs (ticket 09); same shapes as contract.md §2, minus `job.notify`
export type JobKind = 'alarm' | 'task'
/** A scheduled alarm or task as kept in jobs.md. `at` / `last` are ms since epoch. */
export interface Job {
  id: string
  kind: JobKind
  title: string
  enabled: boolean
  /** Tasks only: what Neo does at that time. */
  prompt?: string
  /** One-off time, or ... */
  at?: number
  /** ... a repeating 5-field cron. */
  cron?: string
  last?: number
}
/** A job plus when it runs next (null: never, e.g. disabled) and how a person says it. */
export interface JobInfo extends Job {
  next: number | null
  when: string
}
/** A job that is not saved yet (`neo jobs add` previews it). */
export interface JobDraft {
  kind: JobKind
  title: string
  prompt?: string
  at?: number
  cron?: string
  when: string
}
export interface RingingJob {
  id: string
  title: string
}
/** `neo jobs list` */
export interface JobList {
  jobs: JobInfo[]
  ringing: RingingJob | null
  problems: JobProblem[]
}
/** One line of jobs.md Neo could not read. */
export interface JobProblem {
  line: number
  text: string
  error: string
}
export type AlarmEvent = { type: 'alarm'; at: number; id: string; title: string; card: Card }
export type AlarmOffEvent = { type: 'alarm_off'; at: number; id: string; why: string; snooze?: number }
export type JobEvent = { type: 'job'; at: number; id: string; title: string }
export type ScheduleEvent = { type: 'schedule'; at: number; action: 'add'; title: string; when: string }
/** The job list changed (added, edited, fired, or jobs.md was edited by hand): refresh. */
export type JobsEvent = { type: 'jobs'; at: number }
/** jobs.md has a line Neo cannot read; the previous jobs stay in force. `problems` is empty once it is fixed. */
export type JobsWarningEvent = { type: 'jobs_warning'; at: number; problems: JobProblem[] }

// pet, name and face (ticket 10); same shapes as contract.md §2
export type Food = 'fish' | 'cookie' | 'milk'
export const FOODS = ['fish', 'cookie', 'milk'] as const satisfies readonly Food[]
/** The A7 eats. */
export type FeedEvent = { type: 'feed'; at: number; food: Food }
/** Someone asked "หิวไหม": the phone answers aloud. */
export type PetAskEvent = { type: 'pet_ask'; at: number }
/** The phone's own report (never kept in history). */
export type PetEvent = { type: 'pet'; at: number; hunger: number; affection: number }
/** Deep sleep: the microphone is off until the phone is tapped. */
export type SleepEvent = { type: 'sleep'; at: number }
export type WakeupEvent = { type: 'wakeup'; at: number; dreamCancelled: boolean }
/** The name and the ways the recogniser writes it changed. */
export type WakeEvent = { type: 'wake'; at: number; name: string; variants: string[] }
/** Name training: the n-th of three transcripts was taken as a variant. `n` is 0 when training starts. */
export type TrainEvent = { type: 'train'; at: number; name: string; n: number; text?: string }
export type FaceEvent = { type: 'face'; at: number } & Face
/** `neo name` */
export interface WakeTraining {
  name: string
  got: string[]
}
export interface WakeInfo {
  name: string
  variants: string[]
  training: WakeTraining | null
}
/** `neo pet` */
export interface PetInfo {
  /** What the phone last reported; null before its first report. */
  pet: Pet | null
  sleeping: boolean
}

export interface Face {
  fg: string
  accent: string
  cheek: string
  bg: string
}
/** First line on every phone `GET /api/events`: no `at`, never in history. */
export interface HelloEvent {
  type: 'hello'
  thinking: boolean
  provider: string
  name: string
  face: Face
  idle: IdleSettings
  ringing: string | null
}

export interface PairAddress {
  method: string
  url: string
  note: string
}
/** `neo devices pair` */
export interface PairStart {
  code: string
  expiresAt: number
  addresses: PairAddress[]
}
/** `neo devices list` (`paired` / `lastSeen` are ISO strings) */
export interface DeviceInfo {
  id: string
  name: string
  paired: string
  lastSeen: string | null
}

export type NeoEvent =
  | StatusEvent | SettingsEvent | IdleEvent | PairedEvent | DevicesEvent
  | HeardEvent | IgnoredEvent | ArmedEvent | ThinkingEvent | SessionEvent | ToolEvent | AnimationEvent | CardEvent | AskerrEvent | CancelledEvent
  | ProviderEvent | ModelEvent
  | AlarmEvent | AlarmOffEvent | JobEvent | ScheduleEvent | JobsEvent | JobsWarningEvent
  | ChangedEvent | DreamingEvent | DreamDoneEvent | DreamFailEvent
  | FeedEvent | PetAskEvent | PetEvent | SleepEvent | WakeupEvent | WakeEvent | TrainEvent | FaceEvent
  | RecEvent | ShortEvent | LoudEvent | SttEvent | NothingEvent | SttErrEvent | ListenEndEvent
export type StreamLine = NeoEvent | PingEvent | HelloEvent

/** Event types that are broadcast but never kept in the history backlog. */
export const UNSTORED_EVENT_TYPES = ['rec', 'short', 'loud', 'ping', 'pet'] as const
export const HISTORY_LIMIT = 400
export const PING_INTERVAL_MS = 15_000

// ---- phone routes (port 8000, device token) that NeoApp calls; `gen:kotlin` turns these into Kotlin ----

/** `POST /api/pair` */
export interface PairRequest {
  code: string
  name: string
}
/** 200 `{token, id, name}` or 400 `{error}`. */
export interface PairResponse {
  token: string
  id: string
  name: string
  error?: string
}
/** `POST /api/pet`: the phone's own hunger and affection (0..1). */
export interface PetRequest {
  hunger: number
  affection: number
}
/** `POST /api/ask` (NeoApp's debug intent; the reply is a `Card`). NeoCli has no such route: 404. */
export interface AskRequest {
  text: string
}

// ---- phone settings routes (ticket 24): the command-socket routes below, served on the phone port under `/api` ----

/** `POST /settings/set`: the daemon parses and validates; a bad value is a 400 with a Thai message. */
export interface SettingSetRequest {
  name: string
  args: string[]
}
export interface DeviceRevokeRequest {
  id: string
}
/** `GET /api/devices` marks the caller's own row, so a phone can revoke itself. */
export interface PhoneDeviceInfo extends DeviceInfo {
  self: boolean
}
export interface ProviderUseRequest {
  name: string
}
export interface ProviderUseResponse {
  current: string
  card: Card
}
/** `cfg` and `apiKey` to save, or `remove: true`. The key is written 0600 to NEO_HOME and never returned. */
export interface ProviderConfigSave {
  name: string
  cfg?: ProviderConfig
  apiKey?: string
  remove?: boolean
}
export interface ModelsListRequest {
  name?: string
}
/** `model: null` = the provider's default. */
export interface ModelUseRequest {
  name?: string
  model: string | null
}
export interface CardResponse {
  card: Card
}
export interface NameSetRequest {
  name: string
  variants?: string[]
}
export interface NameRequest {
  name: string
}
export interface JobParseRequest {
  speech: string
}
export interface JobParseResponse {
  draft: JobDraft
}
export interface JobAddRequest {
  kind: JobKind
  title?: string
  prompt?: string
  at?: number
  cron?: string
}
/** `ref` is a job id or its title. */
export interface JobEditRequest {
  ref: string
  title?: string
  prompt?: string
  at?: number
  cron?: string
}
export interface JobEnableRequest {
  ref: string
  enabled: boolean
}
export interface JobRefRequest {
  ref: string
}
export interface JobRemoveResponse {
  removed: JobInfo
}
export interface MemorySaveRequest {
  text: string
  since: string
}
export interface MemoryAddRequest {
  text: string
  section?: string
}
/** Memory and journal: several matches without `all` is a 409 listing them, nothing removed. */
export interface ForgetRequest {
  text: string
  all?: boolean
}
export interface MemoryForgetResponse {
  removed: MemoryItem[]
}
export interface JournalShowRequest {
  day?: string
}
export interface JournalForgetResponse {
  removed: JournalEntry[]
}
export interface DreamEnableRequest {
  enabled: boolean
}
/** `id` is a file name from `GET /dreams`, or `last`. */
export interface DreamIdRequest {
  id: string
}
export interface DreamRemoveResponse {
  removed: DreamInfo
}

/** The command-socket routes a paired phone may also call, at `/api` + path (device token, same bodies and replies). */
export const PHONE_SETTINGS_ROUTES = [
  'GET /status',
  'GET /settings', 'POST /settings', 'POST /settings/set',
  'GET /devices', 'POST /devices/revoke',
  'GET /providers', 'POST /providers/use', 'POST /providers/discover', 'GET /providers/config', 'POST /providers/config',
  'POST /models/list', 'POST /models/use',
  'GET /animations', 'POST /animations/show', 'POST /animations/redo', 'POST /animations/rm',
  'GET /name', 'POST /name/set', 'POST /name/train', 'POST /name/train/cancel',
  'GET /face', 'POST /face',
  'GET /jobs', 'POST /jobs/parse', 'POST /jobs/add', 'POST /jobs/edit', 'POST /jobs/enable', 'POST /jobs/remove', 'POST /jobs/test',
  'GET /memory', 'POST /memory', 'POST /memory/add', 'POST /memory/forget',
  'GET /journal', 'POST /journal/show', 'POST /journal/forget',
  'GET /dream', 'POST /dream/now', 'POST /dream/enable',
  'GET /dreams', 'POST /dreams/show', 'POST /dreams/rm',
] as const satisfies readonly (keyof Routes)[]
export type PhoneSettingsRoute = (typeof PHONE_SETTINGS_ROUTES)[number]

// ---- command socket ----

/** How one `neo say` ended. `accepted` is only for `wait: false`. */
export type SayResult =
  | { outcome: 'card'; card: Card }
  | { outcome: 'error'; error: string }
  | { outcome: 'cancelled' }
  /** Heard, but not addressed to Neo (wake word needed) or only the name. */
  | { outcome: 'heard'; armed: boolean }
  | { outcome: 'accepted' }

export interface ErrorBody {
  error: string
  code: number
}

/** `neo phone audio`: what came of one audio file. */
export interface PhoneAudioResult {
  /** What the recogniser heard, one entry per segment. */
  transcripts: string[]
  /** `nothing`: no words; `error`: STT failed; otherwise how the last transcript was handled. */
  outcome: SayResult | { outcome: 'nothing' } | { outcome: 'stterr'; error: string }
}

/** One row of `neo doctor`. */
export interface DoctorRow {
  id: string
  ok: boolean
  label: string
  detail: string
  fix?: string
  optional?: boolean
  /** Where each tool this check needs was found on the daemon's PATH (null = not found). */
  found?: Record<string, string | null>
}

/** Typed routes on NEO_HOME/neo.sock. The daemon never sees argv. */
export interface Routes {
  'GET /daemon/info': { response: DaemonInfo }
  'GET /status': { response: Status }
  'GET /settings': { response: Settings }
  'POST /settings': { body: SettingsPatch; response: Settings }
  /** `neo settings set <name> <args…>`: the daemon parses and validates; a bad value is code 1 with a Thai message. */
  'POST /settings/set': { body: SettingSetRequest; response: Settings }
  /** Same path as speech. `wait: false` returns `accepted` at once. */
  'POST /say': { body: { text: string; wait?: boolean }; response: SayResult }
  /** Socket-only (not on port 8000). */
  'POST /cancel': { response: { cancelled: boolean } }
  'POST /devices/pair': { response: PairStart }
  'GET /devices': { response: DeviceInfo[] }
  'POST /devices/revoke': { body: DeviceRevokeRequest; response: { ok: true } }
  'GET /memory': { response: MemoryDoc }
  /** Conflict-checked: 409 when memory.md is no longer the version `since`. */
  'POST /memory': { body: MemorySaveRequest; response: MemoryDoc }
  'POST /memory/add': { body: MemoryAddRequest; response: MemoryDoc }
  /** Several matches without `all`: 409 listing them, nothing removed. */
  'POST /memory/forget': { body: ForgetRequest; response: MemoryForgetResponse }
  'POST /memory/clear': { response: { removed: number } }
  'GET /journal': { response: JournalDay[] }
  /** `day` is YYYY-MM-DD, `today` or `yesterday`; default today. */
  'POST /journal/show': { body: JournalShowRequest; response: JournalDoc }
  'POST /journal/save': { body: { day: string; text: string; since: string }; response: JournalDoc }
  'POST /journal/forget': { body: ForgetRequest; response: JournalForgetResponse }
  'POST /journal/clear': { response: { removed: number } }
  /** Dreams (ticket 12). `id` is a file name from `GET /dreams`, or `last`. */
  'GET /dream': { response: DreamStatus }
  /** Starts a dream and returns when it is over; 409 while one is running or when there is nothing new in the journal. */
  'POST /dream/now': { response: DreamDoc }
  'POST /dream/enable': { body: DreamEnableRequest; response: DreamStatus }
  'GET /dreams': { response: DreamInfo[] }
  'POST /dreams/show': { body: DreamIdRequest; response: DreamDoc }
  'POST /dreams/rm': { body: DreamIdRequest; response: DreamRemoveResponse }
  'POST /dreams/clear': { response: { removed: number } }
  /** Jobs (ticket 09). `ref` is a job id or its title. */
  'GET /jobs': { response: JobList }
  /** Understand a sentence like "ปลุกพรุ่งนี้ตีห้าครึ่ง" without saving anything. */
  'POST /jobs/parse': { body: JobParseRequest; response: JobParseResponse }
  'POST /jobs/add': { body: JobAddRequest; response: JobInfo }
  'POST /jobs/edit': { body: JobEditRequest; response: JobInfo }
  'POST /jobs/enable': { body: JobEnableRequest; response: JobInfo }
  'POST /jobs/remove': { body: JobRefRequest; response: JobRemoveResponse }
  'POST /jobs/clear': { body: { kind?: JobKind }; response: { removed: number } }
  /** Fire it now. */
  'POST /jobs/test': { body: JobRefRequest; response: { ok: true } }
  'GET /jobs/file': { response: { text: string; version: string } }
  /** Refused with exit 1 when jobs.md changed since `since` (the version you read). */
  'POST /jobs/file': { body: { text: string; since: string }; response: { version: string } }
  /** Tool animations (ticket 27). `redo` queues a new drawing and returns at once; the `animation` event announces it. */
  'GET /animations': { response: AnimationInfo[] }
  'POST /animations/show': { body: AnimationRefRequest; response: ToolAnimation }
  'POST /animations/redo': { body: AnimationRefRequest; response: { tool: string; queued: true } }
  'POST /animations/rm': { body: AnimationRefRequest; response: { removed: AnimationInfo } }
  /** Pet, name, face (ticket 10). */
  'GET /pet': { response: PetInfo }
  'POST /pet/feed': { body: { food?: Food }; response: { food: Food } }
  'POST /pet/sleep': { response: { ok: true } }
  /** `neo phone wake` / `neo phone pet`: the neo command acting as the phone. */
  'POST /phone/wake': { response: { ok: true } }
  'POST /phone/pet': { body: { hunger: number; affection: number }; response: { ok: true } }
  'GET /name': { response: WakeInfo }
  /** Set the name now; `variants` default to the name alone. */
  'POST /name/set': { body: NameSetRequest; response: WakeInfo }
  /** The next three transcripts become the variants. */
  'POST /name/train': { body: NameRequest; response: WakeInfo }
  'POST /name/train/cancel': { response: WakeInfo }
  'GET /face': { response: Face }
  'POST /face': { body: Partial<Face>; response: Face }
  'POST /alarm/stop': { body: { snooze?: number }; response: { stopped: boolean } }
  // brains (ticket 06)
  'GET /providers': { response: ProviderList }
  'POST /providers/use': { body: ProviderUseRequest; response: ProviderUseResponse }
  'POST /providers/discover': { response: DiscoveredAgent[] }
  'GET /providers/config': { response: ProviderConfigView }
  /** `cfg` and `apiKey` to save, or `remove: true`. The key is written 0600 to NEO_HOME and never returned. */
  'POST /providers/config': { body: ProviderConfigSave; response: { ok: true } }
  'POST /models/list': { body: ModelsListRequest; response: ModelList }
  /** `model: null` = the provider's default. Emits `model`, then a card. */
  'POST /models/use': { body: ModelUseRequest; response: CardResponse }
  /** NDJSON stream; `?history=1` replays the backlog first. */
  'GET /events': { response: StreamLine }
  /** Body is a 16 kHz mono 16-bit WAV (raw bytes, not JSON): the neo command acting as a phone. Client sends it itself. */
  'POST /phone/audio': { response: PhoneAudioResult }
  'GET /doctor': { response: DoctorRow[] }
  /** Runs the fix for one check (stt: asks for Speech permission). */
  'POST /doctor/fix': { body: { id: string }; response: DoctorRow }
}

export const EXIT = { ok: 0, failed: 1, usage: 2, daemonDown: 3 } as const
export type ExitCode = (typeof EXIT)[keyof typeof EXIT]
