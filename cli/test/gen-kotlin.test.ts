import { expect, test } from 'bun:test'
import { generate, PROTOCOL_KT, PROTOCOL_TS } from '../tools/gen-kotlin'

const protocol = await Bun.file(PROTOCOL_TS).text()

function changed(from: string, to: string) {
  expect(protocol).toContain(from)
  return protocol.replace(from, to)
}

test('Protocol.kt is up to date: regenerating with no protocol change gives no diff', async () => {
  const committed = await Bun.file(PROTOCOL_KT).text()
  expect(generate(protocol), 'run `bun run gen:kotlin` in cli/ and commit android/.../Protocol.kt').toBe(committed)
})

test('generation is deterministic', () => {
  expect(generate(protocol)).toBe(generate(protocol))
})

test('retyping an event field changes the generated file, so a stale Protocol.kt fails the check above', () => {
  const out = generate(changed("type: 'alarm_off'; at: number; id: string; why: string; snooze?: number", "type: 'alarm_off'; at: number; id: string; why: string; snooze?: boolean"))
  expect(out).toContain('data class AlarmOff(val snooze: Boolean = false)')
  expect(out).not.toBe(generate(protocol))
})

test('renaming a field NeoApp reads stops the generator', () => {
  expect(() => generate(changed("type: 'heard'; at: number; text: string", "type: 'heard'; at: number; words: string"))).toThrow('HeardEvent has no field "text"')
})

test('changing an event type string stops the generator', () => {
  expect(() => generate(changed("type: 'feed'; at: number; food: Food", "type: 'eat'; at: number; food: Food"))).toThrow('expected "feed"')
})

test('the generated Kotlin has every event NeoApp reacts to and no extra dependency', () => {
  const out = generate(protocol)
  for (const type of ['hello', 'ping', 'rec', 'heard', 'card', 'alarm', 'alarm_off', 'dream_done', 'idle', 'face']) expect(out).toContain(`"${type}" ->`)
  expect(out).toContain('import org.json.JSONObject')
  expect([...out.matchAll(/^import (.+)$/gm)].map((m) => m[1])).toEqual(['org.json.JSONObject'])
})

/** The Kotlin source of one top-level generated class. */
function classBlock(out: string, name: string) {
  const start = out.indexOf(`\ndata class ${name}(`)
  expect(start, `data class ${name}`).toBeGreaterThanOrEqual(0)
  const end = out.indexOf('\n}\n', start)
  return out.slice(start, end)
}

test('the phone settings routes (ticket 24) have their request and reply types in Protocol.kt', () => {
  const out = generate(protocol)
  for (const name of ['NeoStatus', 'NeoSettings', 'NeoDevice', 'NeoProviderList', 'NeoProviderConfigView', 'NeoModelList', 'NeoJobList', 'NeoMemoryDoc', 'NeoJournalDoc', 'NeoDreamDoc', 'NeoDreamStatus', 'NeoWakeInfo']) {
    expect(classBlock(out, name), name).toContain('fun fromJson(')
  }
  for (const name of ['SettingSetRequest', 'ProviderConfigSave', 'ModelUseRequest', 'JobAddRequest', 'MemorySaveRequest', 'DeviceRevokeRequest']) {
    expect(classBlock(out, name), name).toContain('fun toJson(): String')
  }
  for (const type of ['settings', 'provider', 'model', 'wake', 'train', 'jobs', 'devices', 'changed']) expect(out).toContain(`"${type}" ->`)
})

test('an API key has no place in any reply type: only the write-only apiKey of a save request holds one', () => {
  const out = generate(protocol)
  expect(classBlock(out, 'ProviderConfigSave')).toContain('val apiKey: String? = null')
  for (const reply of ['NeoProviderConfigView', 'NeoProviderConfig', 'NeoProviderConfigEntry', 'NeoProviderList', 'NeoProvider', 'NeoSettings', 'NeoStatus']) {
    expect(classBlock(out, reply), reply).not.toMatch(/\bapiKey:/)
  }
})

test('renaming a field of a settings reply stops the generator', () => {
  expect(() => generate(changed('  requireName: boolean\n  bypass: boolean\n  pet: Pet | null', '  requireName: boolean\n  bypassed: boolean\n  pet: Pet | null'))).toThrow('Status has no field "bypass"')
})

test('a field that can be null is nullable in Kotlin, and an optional one of a partial request is left out when null', () => {
  const out = generate(protocol)
  expect(classBlock(out, 'NeoSettings')).toContain('val claudeConfigDir: String? = null')
  expect(classBlock(out, 'ProviderConfigSave')).toContain('apiKey?.let { j.put("apiKey", it) }')
})
