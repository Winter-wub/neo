// Turns the shapes NeoApp uses in src/protocol.ts into android/.../Protocol.kt (org.json only, no new APK dependency).
// Run: bun run gen:kotlin. The committed file is checked by test/gen-kotlin.test.ts.
//
// protocol.ts stays plain TS. This script reads it with the TypeScript compiler API and writes lenient Kotlin parsers:
// a missing or mistyped field is the type's default (like `optString` / `optInt`), never an exception.
// Only the fields NeoApp reads are listed below; a field renamed, retyped or removed in protocol.ts stops the generator.
// typescript 7 (the type checker we run) has no JS API, so the generator reads protocol.ts with the 5.x line.
import ts from 'typescript-js'
import { join } from 'node:path'

export const PROTOCOL_TS = join(import.meta.dir, '../src/protocol.ts')
export const PROTOCOL_KT = join(import.meta.dir, '../../android/app/src/main/java/com/mochi/companion/Protocol.kt')

// ---- what NeoApp uses ----

interface ObjectSpec {
  /** Name in protocol.ts. */
  ts: string
  kotlin: string
  /** The fields NeoApp reads, in constructor order. */
  fields: string[]
  /** Write `toJson(): String` (requests, and what is stored in SharedPreferences). */
  toJson?: boolean
  /** `parse(String)`: `lenient` = a body that is not JSON gives the all-defaults value; `nullable` = null for empty or broken text. */
  parse?: 'lenient' | 'nullable'
  /** `parseList(String)`: the body is a JSON array of these (broken text gives an empty list). */
  parseList?: boolean
  /** Optional fields in protocol.ts are nullable here: "not sent" is left out of `toJson` and is null when read. */
  partial?: boolean
}

const PROVIDER_FIELDS = ['type', 'label', 'command', 'args', 'baseUrl', 'url', 'model', 'models', 'aliases', 'config', 'apiKeyEnv', 'apiKeyFile', 'headers']
const JOB_FIELDS = ['id', 'kind', 'title', 'enabled', 'prompt', 'at', 'cron', 'last']

/**
 * Ticket 24: what a paired phone reads and sends on the settings routes (`PHONE_SETTINGS_ROUTES`). Reply types are `Neo…`
 * so they never collide with NeoApp's own classes; `parse` / `parseList` read a whole reply body.
 */
const PHONE_SETTINGS_OBJECTS: ObjectSpec[] = [
  { ts: 'Pet', kotlin: 'NeoPet', fields: ['hunger', 'affection', 'at'] },
  {
    ts: 'Status', kotlin: 'NeoStatus', parse: 'lenient',
    fields: ['phone', 'consoles', 'provider', 'model', 'thinking', 'ringing', 'busy', 'requireName', 'bypass', 'pet', 'uptime', 'pid'],
  },
  { ts: 'HomePlace', kotlin: 'NeoHome', fields: ['city', 'lat', 'lon'], toJson: true },
  {
    ts: 'Settings', kotlin: 'NeoSettings', parse: 'lenient',
    fields: ['requireName', 'followUp', 'bypass', 'tailscale', 'lan', 'idle', 'dream', 'onboarded', 'claudeConfigDir', 'home', 'mcpServers'],
  },
  { ts: 'SettingSetRequest', kotlin: 'SettingSetRequest', fields: ['name', 'args'], toJson: true },
  { ts: 'PhoneDeviceInfo', kotlin: 'NeoDevice', fields: ['id', 'name', 'paired', 'lastSeen', 'self'], parseList: true },
  { ts: 'DeviceRevokeRequest', kotlin: 'DeviceRevokeRequest', fields: ['id'], toJson: true },
  { ts: 'ProviderInfo', kotlin: 'NeoProvider', fields: ['name', 'label', 'type', 'found', 'model'] },
  { ts: 'ProviderList', kotlin: 'NeoProviderList', fields: ['current', 'list'], parse: 'lenient' },
  { ts: 'ProviderUseRequest', kotlin: 'ProviderUseRequest', fields: ['name'], toJson: true },
  { ts: 'ProviderUseResponse', kotlin: 'ProviderUseResponse', fields: ['current', 'card'], parse: 'lenient' },
  { ts: 'DiscoveredAgent', kotlin: 'NeoDiscoveredAgent', fields: ['name', 'label', 'type', 'available', 'via', 'registry', 'why'], parseList: true },
  { ts: 'ProviderConfig', kotlin: 'NeoProviderConfig', fields: PROVIDER_FIELDS, toJson: true, partial: true },
  { ts: 'ProviderConfigEntry', kotlin: 'NeoProviderConfigEntry', fields: [...PROVIDER_FIELDS, 'found'], partial: true },
  { ts: 'ProviderConfigView', kotlin: 'NeoProviderConfigView', fields: ['default', 'providers', 'overrides', 'discovered', 'keys'], parse: 'lenient' },
  { ts: 'ProviderConfigSave', kotlin: 'ProviderConfigSave', fields: ['name', 'cfg', 'apiKey', 'remove'], toJson: true, partial: true },
  { ts: 'ModelsListRequest', kotlin: 'ModelsListRequest', fields: ['name'], toJson: true, partial: true },
  { ts: 'ModelUseRequest', kotlin: 'ModelUseRequest', fields: ['name', 'model'], toJson: true, partial: true },
  { ts: 'ModelEntry', kotlin: 'NeoModelEntry', fields: ['id', 'name'] },
  { ts: 'ModelAlias', kotlin: 'NeoModelAlias', fields: ['alias', 'id'] },
  { ts: 'ModelList', kotlin: 'NeoModelList', fields: ['name', 'mapped', 'list', 'current', 'error'], parse: 'lenient' },
  { ts: 'CardResponse', kotlin: 'CardResponse', fields: ['card'], parse: 'lenient' },
  { ts: 'WakeTraining', kotlin: 'NeoWakeTraining', fields: ['name', 'got'] },
  { ts: 'WakeInfo', kotlin: 'NeoWakeInfo', fields: ['name', 'variants', 'training'], parse: 'lenient' },
  { ts: 'NameSetRequest', kotlin: 'NameSetRequest', fields: ['name', 'variants'], toJson: true, partial: true },
  { ts: 'NameRequest', kotlin: 'NameRequest', fields: ['name'], toJson: true },
  { ts: 'JobInfo', kotlin: 'NeoJob', fields: [...JOB_FIELDS, 'next', 'when'], parse: 'lenient', partial: true },
  { ts: 'JobDraft', kotlin: 'NeoJobDraft', fields: ['kind', 'title', 'prompt', 'at', 'cron', 'when'], partial: true },
  { ts: 'JobProblem', kotlin: 'NeoJobProblem', fields: ['line', 'text', 'error'] },
  { ts: 'RingingJob', kotlin: 'NeoRingingJob', fields: ['id', 'title'] },
  { ts: 'JobList', kotlin: 'NeoJobList', fields: ['jobs', 'ringing', 'problems'], parse: 'lenient' },
  { ts: 'JobParseRequest', kotlin: 'JobParseRequest', fields: ['speech'], toJson: true },
  { ts: 'JobParseResponse', kotlin: 'JobParseResponse', fields: ['draft'], parse: 'lenient' },
  { ts: 'JobAddRequest', kotlin: 'JobAddRequest', fields: ['kind', 'title', 'prompt', 'at', 'cron'], toJson: true, partial: true },
  { ts: 'JobEditRequest', kotlin: 'JobEditRequest', fields: ['ref', 'title', 'prompt', 'at', 'cron'], toJson: true, partial: true },
  { ts: 'JobEnableRequest', kotlin: 'JobEnableRequest', fields: ['ref', 'enabled'], toJson: true },
  { ts: 'JobRefRequest', kotlin: 'JobRefRequest', fields: ['ref'], toJson: true },
  { ts: 'JobRemoveResponse', kotlin: 'JobRemoveResponse', fields: ['removed'], parse: 'lenient' },
  { ts: 'MemoryItem', kotlin: 'NeoMemoryItem', fields: ['section', 'text'] },
  { ts: 'MemoryDoc', kotlin: 'NeoMemoryDoc', fields: ['text', 'version', 'items'], parse: 'lenient' },
  { ts: 'MemorySaveRequest', kotlin: 'MemorySaveRequest', fields: ['text', 'since'], toJson: true },
  { ts: 'MemoryAddRequest', kotlin: 'MemoryAddRequest', fields: ['text', 'section'], toJson: true, partial: true },
  { ts: 'ForgetRequest', kotlin: 'ForgetRequest', fields: ['text', 'all'], toJson: true, partial: true },
  { ts: 'MemoryForgetResponse', kotlin: 'MemoryForgetResponse', fields: ['removed'], parse: 'lenient' },
  { ts: 'JournalDay', kotlin: 'NeoJournalDay', fields: ['day', 'entries'], parseList: true },
  { ts: 'JournalEntry', kotlin: 'NeoJournalEntry', fields: ['day', 'time', 'q', 'a', 'ok'] },
  { ts: 'JournalDoc', kotlin: 'NeoJournalDoc', fields: ['day', 'text', 'version', 'entries'], parse: 'lenient' },
  { ts: 'JournalShowRequest', kotlin: 'JournalShowRequest', fields: ['day'], toJson: true, partial: true },
  { ts: 'JournalForgetResponse', kotlin: 'JournalForgetResponse', fields: ['removed'], parse: 'lenient' },
  { ts: 'DreamInfo', kotlin: 'NeoDreamInfo', fields: ['id', 'at', 'reason', 'took', 'entries', 'dream', 'insights', 'undelivered'], parseList: true },
  { ts: 'DreamInsight', kotlin: 'NeoDreamInsight', fields: ['q', 'finding'] },
  { ts: 'DreamCardView', kotlin: 'NeoDreamCard', fields: ['title', 'lines', 'items'] },
  {
    ts: 'DreamDoc', kotlin: 'NeoDreamDoc', parse: 'lenient',
    fields: ['id', 'text', 'version', 'at', 'reason', 'took', 'entries', 'dream', 'insights', 'patterns', 'added', 'removed', 'card', 'undelivered'],
  },
  {
    ts: 'DreamStatus', kotlin: 'NeoDreamStatus', parse: 'lenient',
    fields: ['enabled', 'running', 'last', 'why', 'blocked', 'newEntries', 'idleMinutes', 'quietNow', 'quietHours', 'activity'],
  },
  { ts: 'DreamEnableRequest', kotlin: 'DreamEnableRequest', fields: ['enabled'], toJson: true },
  { ts: 'DreamIdRequest', kotlin: 'DreamIdRequest', fields: ['id'], toJson: true },
  { ts: 'DreamRemoveResponse', kotlin: 'DreamRemoveResponse', fields: ['removed'], parse: 'lenient' },
  // tool animations (ticket 27)
  { ts: 'ToolAnimation', kotlin: 'NeoToolAnimation', fields: ['tool', 'label', 'w', 'h', 'palette', 'frames', 'fps', 'createdBy', 'at'], parse: 'lenient' },
  { ts: 'AnimationInfo', kotlin: 'NeoAnimationInfo', fields: ['tool', 'label', 'w', 'h', 'frames', 'fps', 'createdBy', 'at'], parseList: true },
  { ts: 'AnimationRefRequest', kotlin: 'AnimationRefRequest', fields: ['tool'], toJson: true },
]

const OBJECTS: ObjectSpec[] = [
  { ts: 'IdleSettings', kotlin: 'IdleSettings', fields: ['sleepAfter', 'clock'] },
  { ts: 'Face', kotlin: 'FaceTheme', fields: ['fg', 'accent', 'cheek', 'bg'], toJson: true, parse: 'nullable' },
  { ts: 'CardItem', kotlin: 'CardItem', fields: ['t', 'v'] },
  // The wire shape of a card. NeoApp's own `Card` (Card.kt) is built from it: cleaned text, caps, decoded pixel art.
  {
    ts: 'Card', kotlin: 'WireCard',
    fields: ['kind', 'layout', 'icon', 'title', 'big', 'lines', 'items', 'emotion', 'sounds', 'seconds', 'w', 'h', 'palette', 'frames', 'fps'],
  },
  { ts: 'PairRequest', kotlin: 'PairRequest', fields: ['code', 'name'], toJson: true },
  { ts: 'PairResponse', kotlin: 'PairResponse', fields: ['token', 'name', 'error'], parse: 'lenient' },
  { ts: 'PetRequest', kotlin: 'PetRequest', fields: ['hunger', 'affection'], toJson: true },
  { ts: 'AskRequest', kotlin: 'AskRequest', fields: ['text'], toJson: true },
  ...PHONE_SETTINGS_OBJECTS,
]

/** Types NeoApp models by hand on top of a generated wire type: events call `<kotlin>.fromJson` and a bad one is null. */
const EXTERNAL: Record<string, string> = { Card: 'Card' }

interface EventSpec {
  type: string
  ts: string
  kotlin: string
  /** Payload fields NeoApp reads. Everything else on the event is ignored. */
  fields?: string[]
}

const EVENTS: EventSpec[] = [
  { type: 'hello', ts: 'HelloEvent', kotlin: 'Hello', fields: ['thinking', 'idle', 'face'] },
  { type: 'ping', ts: 'PingEvent', kotlin: 'Ping' },
  { type: 'rec', ts: 'RecEvent', kotlin: 'Rec' },
  { type: 'short', ts: 'ShortEvent', kotlin: 'Short' },
  { type: 'loud', ts: 'LoudEvent', kotlin: 'Loud' },
  { type: 'stt', ts: 'SttEvent', kotlin: 'Stt' },
  { type: 'nothing', ts: 'NothingEvent', kotlin: 'Nothing' },
  { type: 'stterr', ts: 'SttErrEvent', kotlin: 'Stterr' },
  { type: 'heard', ts: 'HeardEvent', kotlin: 'Heard', fields: ['text'] },
  { type: 'armed', ts: 'ArmedEvent', kotlin: 'Armed' },
  { type: 'listen_end', ts: 'ListenEndEvent', kotlin: 'ListenEnd' },
  { type: 'thinking', ts: 'ThinkingEvent', kotlin: 'Thinking', fields: ['text'] },
  { type: 'tool', ts: 'ToolEvent', kotlin: 'Tool', fields: ['name', 'key', 'animation'] },
  { type: 'animation', ts: 'AnimationEvent', kotlin: 'AnimationChanged', fields: ['tool', 'animation'] },
  { type: 'card', ts: 'CardEvent', kotlin: 'CardShown', fields: ['card'] },
  { type: 'askerr', ts: 'AskerrEvent', kotlin: 'Askerr' },
  { type: 'cancelled', ts: 'CancelledEvent', kotlin: 'Cancelled' },
  { type: 'alarm', ts: 'AlarmEvent', kotlin: 'Alarm', fields: ['card'] },
  { type: 'alarm_off', ts: 'AlarmOffEvent', kotlin: 'AlarmOff', fields: ['snooze'] },
  { type: 'job', ts: 'JobEvent', kotlin: 'Job', fields: ['title'] },
  { type: 'sleep', ts: 'SleepEvent', kotlin: 'Sleep' },
  { type: 'feed', ts: 'FeedEvent', kotlin: 'Feed', fields: ['food'] },
  { type: 'pet_ask', ts: 'PetAskEvent', kotlin: 'PetAsk' },
  { type: 'dreaming', ts: 'DreamingEvent', kotlin: 'Dreaming' },
  { type: 'dream_done', ts: 'DreamDoneEvent', kotlin: 'DreamDone', fields: ['card'] },
  { type: 'dream_fail', ts: 'DreamFailEvent', kotlin: 'DreamFail' },
  // `IdleEvent` and `FaceEvent` are `{type, at} & IdleSettings|Face`: the settings object is read from the event itself.
  { type: 'idle', ts: 'IdleEvent', kotlin: 'Idle' },
  { type: 'face', ts: 'FaceEvent', kotlin: 'Face' },
  // what a phone that changes settings needs to stay in step with Neo Console (ticket 24)
  { type: 'settings', ts: 'SettingsEvent', kotlin: 'SettingsChanged' },
  { type: 'provider', ts: 'ProviderEvent', kotlin: 'ProviderChanged', fields: ['name', 'label'] },
  { type: 'model', ts: 'ModelEvent', kotlin: 'ModelChanged', fields: ['name', 'model', 'id'] },
  { type: 'wake', ts: 'WakeEvent', kotlin: 'WakeChanged', fields: ['name', 'variants'] },
  { type: 'train', ts: 'TrainEvent', kotlin: 'Training', fields: ['name', 'n', 'text'] },
  { type: 'devices', ts: 'DevicesEvent', kotlin: 'DevicesChanged' },
  { type: 'jobs', ts: 'JobsEvent', kotlin: 'JobsChanged' },
  { type: 'jobs_warning', ts: 'JobsWarningEvent', kotlin: 'JobsWarning', fields: ['problems'] },
  { type: 'changed', ts: 'ChangedEvent', kotlin: 'FileChanged', fields: ['file', 'day', 'id'] },
]
/** Kotlin field name for a flattened object (default: the Kotlin type name, lower-cased first letter). */
const FLATTEN_FIELD: Record<string, string> = { Face: 'theme', IdleSettings: 'idle', Settings: 'settings' }

// ---- Kotlin quirks that protocol.ts does not say ----

/** `number` is Int unless listed. */
const NUMBER_TYPE: Record<string, 'Long' | 'Float' | 'Double'> = {
  'IdleSettings.sleepAfter': 'Long',
  'PetRequest.hunger': 'Float',
  'PetRequest.affection': 'Float',
  'DreamStatus.activity': 'Double',
}
/** Numbers by field name when `NUMBER_TYPE` has no entry for `Type.field`: times in ms, coordinates, 0..1 levels. */
const NUMBER_BY_FIELD: Record<string, 'Long' | 'Float' | 'Double'> = {
  at: 'Long', next: 'Long', last: 'Long', took: 'Long', uptime: 'Long', expiresAt: 'Long',
  lat: 'Double', lon: 'Double', idleMinutes: 'Double', hunger: 'Float', affection: 'Float',
}
const numberType = (key: string) => NUMBER_TYPE[key] ?? NUMBER_BY_FIELD[key.slice(key.lastIndexOf('.') + 1)]
/**
 * Null when the key is absent or null ("not sent": keep the current value), not the type's default.
 * Starts with the fields NeoApp has always read this way; `Source.field` adds every `| null` field, and optional ones of a `partial` object.
 */
const NULLABLE = new Set(['IdleSettings.sleepAfter', 'IdleSettings.clock', 'PairResponse.error'])
/** Defaults other than "" / 0 / false, as Kotlin source. */
const DEFAULT: Record<string, string> = {
  'Card.kind': '"text"',
  'Card.layout': '"text"',
  'Card.emotion': '"happy"',
  'Card.seconds': '15',
  'Card.fps': '3',
  'PairResponse.name': '"Neo"',
}

// ---- reading protocol.ts ----

type Kind =
  | { is: 'string' }
  | { is: 'number' }
  | { is: 'boolean' }
  | { is: 'list'; of: Kind }
  | { is: 'map'; of: Kind }
  | { is: 'object'; name: string }

interface Field {
  name: string
  kind: Kind
}

class Source {
  readonly checker: ts.TypeChecker
  readonly file: ts.SourceFile

  constructor(text: string) {
    const host = ts.createCompilerHost({ strict: true, noEmit: true, types: [], target: ts.ScriptTarget.ESNext })
    const getSourceFile = host.getSourceFile.bind(host)
    host.getSourceFile = (name, ...rest) => (name === PROTOCOL_TS ? ts.createSourceFile(name, text, ts.ScriptTarget.ESNext, true) : getSourceFile(name, ...rest))
    const program = ts.createProgram([PROTOCOL_TS], { strict: true, noEmit: true, types: [], target: ts.ScriptTarget.ESNext }, host)
    this.checker = program.getTypeChecker()
    this.file = program.getSourceFile(PROTOCOL_TS)!
  }

  declared(name: string): ts.Type {
    for (const stmt of this.file.statements) {
      if ((ts.isInterfaceDeclaration(stmt) || ts.isTypeAliasDeclaration(stmt)) && stmt.name.text === name) {
        return this.checker.getDeclaredTypeOfSymbol(this.checker.getSymbolAtLocation(stmt.name)!)
      }
    }
    throw new Error(`protocol.ts has no type ${name}`)
  }

  kindOf(t: ts.Type, where: string): Kind {
    const c = this.checker
    t = c.getNonNullableType(t)
    if (t.flags & ts.TypeFlags.StringLike) return { is: 'string' }
    if (t.flags & ts.TypeFlags.NumberLike) return { is: 'number' }
    if (t.flags & ts.TypeFlags.BooleanLike) return { is: 'boolean' }
    if (t.isUnion() && t.types.every((m) => m.flags & ts.TypeFlags.StringLiteral)) return { is: 'string' }
    if (c.isArrayType(t)) return { is: 'list', of: this.kindOf(c.getTypeArguments(t as ts.TypeReference)[0]!, where) }
    if (t.flags & ts.TypeFlags.Object) {
      const index = c.getIndexInfoOfType(t, ts.IndexKind.String)
      if (index) {
        return { is: 'map', of: this.kindOf(index.type, `${where}[]`) }
      }
      const name = t.aliasSymbol?.name ?? t.symbol?.name
      if (name && !name.startsWith('__')) return { is: 'object', name }
    }
    throw new Error(`${where}: type ${c.typeToString(t)} is not supported by gen-kotlin`)
  }

  /** The properties of an object type, by name. */
  props(t: ts.Type): Map<string, ts.Symbol> {
    return new Map(this.checker.getPropertiesOfType(t).map((p) => [p.name, p]))
  }

  /** `partial`: an optional field is "not sent" (null here), not the type's default. A `| null` field is always nullable. */
  field(owner: string, type: ts.Type, name: string, partial = false): Field {
    const prop = this.props(type).get(name)
    if (!prop) throw new Error(`protocol.ts: ${owner} has no field "${name}", but NeoApp reads it`)
    const t = this.checker.getTypeOfSymbolAtLocation(prop, prop.valueDeclaration!)
    const allowsNull = t.isUnion() && t.types.some((member) => member.flags & ts.TypeFlags.Null)
    if (allowsNull || (partial && prop.flags & ts.SymbolFlags.Optional)) NULLABLE.add(`${owner}.${name}`)
    return { name, kind: this.kindOf(t, `${owner}.${name}`) }
  }
}

// ---- writing Kotlin ----

const kotlinNameOf = new Map(OBJECTS.map((o) => [o.ts, o.kotlin]))

function kotlinType(kind: Kind, key: string): string {
  switch (kind.is) {
    case 'string': return 'String'
    case 'boolean': return 'Boolean'
    case 'number': return numberType(key) ?? 'Int'
    case 'map': return `Map<String, ${kotlinType(kind.of, key)}>`
    case 'list': return `List<${kotlinType(kind.of, key)}>`
    case 'object': return EXTERNAL[kind.name] ?? kotlinNameOf.get(kind.name) ?? fail(`${key}: ${kind.name} is not in OBJECTS`)
  }
}

function fail(message: string): never {
  throw new Error(message)
}

function defaultOf(kind: Kind, key: string): string {
  if (NULLABLE.has(key)) return 'null'
  if (key in DEFAULT) return DEFAULT[key]!
  switch (kind.is) {
    case 'string': return '""'
    case 'boolean': return 'false'
    case 'number': return { Float: '0f', Long: '0L', Double: '0.0', Int: '0' }[numberType(key) ?? 'Int']
    case 'map': return 'emptyMap()'
    case 'list': return 'emptyList()'
    case 'object': return 'null'
  }
}

/** Kotlin that reads the elements of the org.json array held in `arr`. */
function listOf(kind: Kind & { is: 'list' }, arr: string, depth: number, key: string): string {
  const e = kind.of
  switch (e.is) {
    case 'string': return `(0 until ${arr}.length()).map { ${arr}.optString(it) }`
    case 'number': {
      const t = numberType(key)
      return `(0 until ${arr}.length()).map { ${t === 'Long' ? `${arr}.optLong(it)` : t === 'Double' ? `${arr}.optDouble(it)` : t === 'Float' ? `${arr}.optDouble(it).toFloat()` : `${arr}.optInt(it)`} }`
    }
    case 'object': return `(0 until ${arr}.length()).mapNotNull { ${arr}.optJSONObject(it) }.map { ${kotlinNameOf.get(e.name) ?? fail(`${e.name} is not in OBJECTS`)}.fromJson(it) }`
    case 'list': {
      const inner = `a${depth}`
      return `(0 until ${arr}.length()).mapNotNull { i${depth} -> ${arr}.optJSONArray(i${depth})?.let { ${inner} -> ${listOf(e, inner, depth + 1, key)} } }`
    }
    default: return fail('only lists of strings, numbers, objects and lists are supported')
  }
}

/** Kotlin that reads the values of the org.json object held in `m`, as a Map<String, …>. */
function mapOf(kind: Kind & { is: 'map' }, key: string): string {
  const e = kind.of
  switch (e.is) {
    case 'string': return 'm.keys().asSequence().associateWith { m.optString(it) }'
    case 'boolean': return 'm.keys().asSequence().associateWith { m.optBoolean(it) }'
    case 'object': return `m.keys().asSequence().mapNotNull { k -> m.optJSONObject(k)?.let { k to ${kotlinNameOf.get(e.name) ?? fail(`${key}: ${e.name} is not in OBJECTS`)}.fromJson(it) } }.toMap()`
    default: return fail(`${key}: maps of strings, booleans and objects only`)
  }
}

function reader(kind: Kind, key: string, name: string, obj = 'o'): string {
  const dflt = key in DEFAULT && !NULLABLE.has(key) ? `, ${DEFAULT[key]}` : ''
  const get = (() => {
    switch (kind.is) {
      case 'string': return `${obj}.optString("${name}"${dflt})`
      case 'boolean': return `${obj}.optBoolean("${name}")`
      case 'number': {
        const t = numberType(key)
        return t === 'Long' ? `${obj}.optLong("${name}")` : t === 'Float' ? `${obj}.optDouble("${name}", 0.0).toFloat()` : t === 'Double' ? `${obj}.optDouble("${name}", 0.0)` : `${obj}.optInt("${name}"${dflt})`
      }
      case 'map': return `${obj}.optJSONObject("${name}")?.let { m -> ${mapOf(kind, key)} } ?: emptyMap()`
      case 'list': return `${obj}.optJSONArray("${name}")?.let { a -> ${listOf(kind, 'a', 0, key)} } ?: emptyList()`
      case 'object': {
        if (kind.name in EXTERNAL) return `${obj}.optJSONObject("${name}")?.let { try { ${EXTERNAL[kind.name]}.fromJson(it) } catch (_: Exception) { null } }`
        return `${obj}.optJSONObject("${name}")?.let { ${kotlinNameOf.get(kind.name)}.fromJson(it) }`
      }
    }
  })()
  return NULLABLE.has(key) ? `if (${obj}.isNull("${name}")) null else ${get}` : get
}

const KOTLIN_KEYWORDS = new Set(['when', 'in', 'is', 'object', 'val', 'var', 'fun', 'class', 'interface', 'as', 'do', 'if', 'else', 'for', 'while', 'return', 'try', 'typealias', 'null', 'true', 'false', 'this', 'super', 'break', 'continue', 'package', 'throw'])
/** A Kotlin identifier for a JSON key (`when` needs backticks). */
const ident = (name: string) => (KOTLIN_KEYWORDS.has(name) ? `\`${name}\`` : name)

/** Kotlin that adds one field to the JSONObject `j`; a nullable one is left out when null. */
function putter(f: Field, key: string, owner: string): string {
  const v = ident(f.name)
  const value = (() => {
    switch (f.kind.is) {
      case 'string': case 'boolean': return 'it'
      case 'number': return numberType(key) === 'Float' ? 'it.toDouble()' : 'it'
      case 'map': return 'org.json.JSONObject(it)'
      case 'list':
        if (f.kind.of.is === 'string') return 'org.json.JSONArray(it)'
        return fail(`${owner}.${f.name}: toJson supports lists of strings only`)
      case 'object': return 'it.toJsonObject()'
    }
  })()
  if (NULLABLE.has(key) || f.kind.is === 'object') return `${v}?.let { j.put("${f.name}", ${value}) }`
  return `j.put("${f.name}", ${value === 'it' ? v : value.replace('it', v)})`
}

function writeObject(src: Source, spec: ObjectSpec): string {
  const type = src.declared(spec.ts)
  const fields = spec.fields.map((f) => src.field(spec.ts, type, f, spec.partial))
  const key = (f: Field) => `${spec.ts}.${f.name}`
  const ctor = fields.map((f) => `    val ${ident(f.name)}: ${kotlinType(f.kind, key(f))}${NULLABLE.has(key(f)) || f.kind.is === 'object' ? '?' : ''} = ${defaultOf(f.kind, key(f))},`).join('\n')
  const args = fields.map((f) => `            ${ident(f.name)} = ${reader(f.kind, key(f), f.name)},`).join('\n')
  const out: string[] = [`data class ${spec.kotlin}(\n${ctor}\n) {`]
  if (spec.toJson) {
    const puts = fields.map((f) => `        ${putter(f, key(f), spec.ts)}`)
    out.push(`    fun toJsonObject(): JSONObject = JSONObject().also { j ->\n${puts.join('\n')}\n    }\n    fun toJson(): String = toJsonObject().toString()\n`)
  }
  out.push(`    companion object {\n        fun fromJson(o: JSONObject) = ${spec.kotlin}(\n${args}\n        )`)
  if (spec.parse === 'lenient') {
    out.push(`        fun parse(s: String): ${spec.kotlin} = fromJson(try { JSONObject(s) } catch (_: Exception) { JSONObject() })`)
  } else if (spec.parse === 'nullable') {
    out.push(`        fun parse(s: String): ${spec.kotlin}? = if (s.isEmpty()) null else try { fromJson(JSONObject(s)) } catch (_: Exception) { null }`)
  }
  if (spec.parseList) {
    out.push(`        fun parseList(s: String): List<${spec.kotlin}> = try { org.json.JSONArray(s).let { a -> (0 until a.length()).mapNotNull { a.optJSONObject(it) }.map { fromJson(it) } } } catch (_: Exception) { emptyList() }`)
  }
  out.push('    }\n}')
  return out.join('\n')
}

interface EventPlan {
  spec: EventSpec
  fields: Field[]
  /** Set when the event is `{...} & Named`: the Named object is read from the event itself. */
  flat: ObjectSpec | null
}

function planEvent(src: Source, spec: EventSpec): EventPlan {
  const t = src.declared(spec.ts)
  const members = t.isIntersection() ? t.types : [t]
  const body = members.find((m) => src.props(m).has('type')) ?? fail(`protocol.ts: ${spec.ts} has no "type"`)
  const typeProp = src.props(body).get('type')!
  const literal = src.checker.typeToString(src.checker.getTypeOfSymbolAtLocation(typeProp, typeProp.valueDeclaration!))
  if (literal !== `"${spec.type}"`) throw new Error(`protocol.ts: ${spec.ts} has type ${literal}, expected "${spec.type}"`)
  const flatName = members.filter((m) => m !== body).map((m) => m.aliasSymbol?.name ?? m.symbol?.name)[0]
  const flat = flatName ? OBJECTS.find((o) => o.ts === flatName) ?? fail(`${spec.ts}: ${flatName} is not in OBJECTS`) : null
  return { spec, fields: (spec.fields ?? []).map((f) => src.field(spec.ts, body, f)), flat }
}

function writeEvent(plan: EventPlan): string {
  const { spec, fields, flat } = plan
  const base = `ServerEvent("${spec.type}")`
  if (flat) {
    const name = FLATTEN_FIELD[flat.ts] ?? flat.kotlin[0]!.toLowerCase() + flat.kotlin.slice(1)
    return `    data class ${spec.kotlin}(val ${name}: ${flat.kotlin} = ${flat.kotlin}()) : ${base}`
  }
  if (fields.length === 0) return `    data object ${spec.kotlin} : ${base}`
  const ctor = fields.map((f) => {
    const key = `${spec.ts}.${f.name}`
    return `val ${ident(f.name)}: ${kotlinType(f.kind, key)}${NULLABLE.has(key) || f.kind.is === 'object' ? '?' : ''} = ${defaultOf(f.kind, key)}`
  })
  return `    data class ${spec.kotlin}(${ctor.join(', ')}) : ${base}`
}

function eventBranch(plan: EventPlan): string {
  const { spec, fields, flat } = plan
  if (flat) return `                "${spec.type}" -> ${spec.kotlin}(${flat.kotlin}.fromJson(o))`
  if (fields.length === 0) return `                "${spec.type}" -> ${spec.kotlin}`
  const args = fields.map((f) => reader(f.kind, `${spec.ts}.${f.name}`, f.name))
  return `                "${spec.type}" -> ${spec.kotlin}(${args.join(', ')})`
}

export function generate(protocolSource: string): string {
  const src = new Source(protocolSource)
  const plans = EVENTS.map((e) => planEvent(src, e))
  return `// GENERATED by cli/tools/gen-kotlin.ts from cli/src/protocol.ts. Do not edit: change protocol.ts and run \`bun run gen:kotlin\`.
// Every parser is lenient: a missing or mistyped field is the type's default, never an exception; org.json only.
package com.mochi.companion

import org.json.JSONObject

${OBJECTS.map((o) => writeObject(src, o)).join('\n\n')}

sealed class ServerEvent(val type: String) {
${plans.map(writeEvent).join('\n')}
    /** A type the app does not react to (or does not know). */
    data class Unknown(val raw: String) : ServerEvent(raw)

    companion object {
        fun fromJson(o: JSONObject): ServerEvent {
            return when (val t = o.optString("type")) {
${plans.map(eventBranch).join('\n')}
                else -> Unknown(t)
            }
        }

        /** One line of the NDJSON stream -> event; null = skip (blank, not a JSON object, or \`type\` is \`ping\`). */
        fun parseLine(line: String): ServerEvent? {
            if (line.isBlank()) return null
            val ev = try { fromJson(JSONObject(line)) } catch (_: Exception) { return null }
            return if (ev is Ping) null else ev
        }
    }
}
`
}

if (import.meta.main) {
  await Bun.write(PROTOCOL_KT, generate(await Bun.file(PROTOCOL_TS).text()))
  console.log(`wrote ${PROTOCOL_KT}`)
}
