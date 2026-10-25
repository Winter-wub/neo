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
}

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
  { type: 'tool', ts: 'ToolEvent', kotlin: 'Tool', fields: ['name'] },
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
]
/** Kotlin field name for a flattened object (default: the Kotlin type name, lower-cased first letter). */
const FLATTEN_FIELD: Record<string, string> = { Face: 'theme', IdleSettings: 'idle' }

// ---- Kotlin quirks that protocol.ts does not say ----

/** `number` is Int unless listed. */
const NUMBER_TYPE: Record<string, 'Long' | 'Float'> = {
  'IdleSettings.sleepAfter': 'Long',
  'PetRequest.hunger': 'Float',
  'PetRequest.affection': 'Float',
}
/** Null when the key is absent ("not sent": keep the current value), not the type's default. */
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
  | { is: 'map' }
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
        if (!(index.type.flags & ts.TypeFlags.String)) throw new Error(`${where}: only Record<string, string> maps are supported`)
        return { is: 'map' }
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

  field(owner: string, type: ts.Type, name: string): Field {
    const prop = this.props(type).get(name)
    if (!prop) throw new Error(`protocol.ts: ${owner} has no field "${name}", but NeoApp reads it`)
    return { name, kind: this.kindOf(this.checker.getTypeOfSymbolAtLocation(prop, prop.valueDeclaration!), `${owner}.${name}`) }
  }
}

// ---- writing Kotlin ----

const kotlinNameOf = new Map(OBJECTS.map((o) => [o.ts, o.kotlin]))

function kotlinType(kind: Kind, key: string): string {
  switch (kind.is) {
    case 'string': return 'String'
    case 'boolean': return 'Boolean'
    case 'number': return NUMBER_TYPE[key] ?? 'Int'
    case 'map': return 'Map<String, String>'
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
    case 'number': return NUMBER_TYPE[key] === 'Float' ? '0f' : NUMBER_TYPE[key] === 'Long' ? '0L' : '0'
    case 'map': return 'emptyMap()'
    case 'list': return 'emptyList()'
    case 'object': return 'null'
  }
}

/** Kotlin that reads the elements of the org.json array held in `arr`. */
function listOf(kind: Kind & { is: 'list' }, arr: string, depth: number): string {
  const e = kind.of
  switch (e.is) {
    case 'string': return `(0 until ${arr}.length()).map { ${arr}.optString(it) }`
    case 'object': return `(0 until ${arr}.length()).mapNotNull { ${arr}.optJSONObject(it) }.map { ${kotlinNameOf.get(e.name) ?? fail(`${e.name} is not in OBJECTS`)}.fromJson(it) }`
    case 'list': {
      const inner = `a${depth}`
      return `(0 until ${arr}.length()).mapNotNull { i${depth} -> ${arr}.optJSONArray(i${depth})?.let { ${inner} -> ${listOf(e, inner, depth + 1)} } }`
    }
    default: return fail('only lists of strings, objects and lists are supported')
  }
}

function reader(kind: Kind, key: string, name: string, obj = 'o'): string {
  const dflt = key in DEFAULT && !NULLABLE.has(key) ? `, ${DEFAULT[key]}` : ''
  const get = (() => {
    switch (kind.is) {
      case 'string': return `${obj}.optString("${name}"${dflt})`
      case 'boolean': return `${obj}.optBoolean("${name}")`
      case 'number': {
        const t = NUMBER_TYPE[key]
        return t === 'Long' ? `${obj}.optLong("${name}")` : t === 'Float' ? `${obj}.optDouble("${name}", 0.0).toFloat()` : `${obj}.optInt("${name}"${dflt})`
      }
      case 'map': return `${obj}.optJSONObject("${name}")?.let { m -> m.keys().asSequence().associateWith { m.optString(it) } } ?: emptyMap()`
      case 'list': return `${obj}.optJSONArray("${name}")?.let { a -> ${listOf(kind, 'a', 0)} } ?: emptyList()`
      case 'object': {
        if (kind.name in EXTERNAL) return `${obj}.optJSONObject("${name}")?.let { try { ${EXTERNAL[kind.name]}.fromJson(it) } catch (_: Exception) { null } }`
        return `${obj}.optJSONObject("${name}")?.let { ${kotlinNameOf.get(kind.name)}.fromJson(it) }`
      }
    }
  })()
  return NULLABLE.has(key) ? `if (${obj}.has("${name}")) ${get} else null` : get
}

function writeObject(src: Source, spec: ObjectSpec): string {
  const type = src.declared(spec.ts)
  const fields = spec.fields.map((f) => src.field(spec.ts, type, f))
  const key = (f: Field) => `${spec.ts}.${f.name}`
  const ctor = fields.map((f) => `    val ${f.name}: ${kotlinType(f.kind, key(f))}${NULLABLE.has(key(f)) || f.kind.is === 'object' ? '?' : ''} = ${defaultOf(f.kind, key(f))},`).join('\n')
  const args = fields.map((f) => `            ${f.name} = ${reader(f.kind, key(f), f.name)},`).join('\n')
  const out: string[] = [`data class ${spec.kotlin}(\n${ctor}\n) {`]
  if (spec.toJson) {
    const puts = fields.map((f) => {
      if (f.kind.is === 'object' || f.kind.is === 'list' || f.kind.is === 'map') return fail(`${spec.ts}.${f.name}: toJson supports scalars only`)
      return `.put("${f.name}", ${f.name}${f.kind.is === 'number' && NUMBER_TYPE[key(f)] === 'Float' ? '.toDouble()' : ''})`
    })
    out.push(`    fun toJson(): String = JSONObject()${puts.join('')}.toString()\n`)
  }
  out.push(`    companion object {\n        fun fromJson(o: JSONObject) = ${spec.kotlin}(\n${args}\n        )`)
  if (spec.parse === 'lenient') {
    out.push(`        fun parse(s: String): ${spec.kotlin} = fromJson(try { JSONObject(s) } catch (_: Exception) { JSONObject() })`)
  } else if (spec.parse === 'nullable') {
    out.push(`        fun parse(s: String): ${spec.kotlin}? = if (s.isEmpty()) null else try { fromJson(JSONObject(s)) } catch (_: Exception) { null }`)
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
    return `val ${f.name}: ${kotlinType(f.kind, key)}${f.kind.is === 'object' ? '?' : ''} = ${defaultOf(f.kind, key)}`
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
