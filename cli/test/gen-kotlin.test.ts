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
