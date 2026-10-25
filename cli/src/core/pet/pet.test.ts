import { expect, test } from 'bun:test'
import { FakeClock } from '../../../test/helpers'
import type { NeoEvent } from '../../protocol'
import { createEvents } from '../events/events'
import { DEEP_SLEEP_DREAM_MS, createPet } from './pet'

const MIN = 60_000

function setup() {
  const clock = new FakeClock()
  const events = createEvents({ clock })
  const log: NeoEvent[] = []
  events.subscribe(e => log.push(e))
  const saved = new Map<string, unknown>()
  const dreams: string[] = []
  const pet = createPet({
    clock, events,
    store: { read: key => saved.get(key), write: async (key, value) => void saved.set(key, value) },
    dream: reason => void dreams.push(reason),
  })
  const types = () => log.map(e => e.type)
  return { pet, clock, log, types, saved, dreams }
}

test('the phone reports hunger and affection: clamped to 0..1, saved, announced as a pet event', async () => {
  const t = setup()
  expect(t.pet.current()).toBeNull()
  await t.pet.report(5, -3)
  expect(t.pet.current()).toEqual({ hunger: 1, affection: 0, at: t.clock.now() })
  expect(t.saved.get('pet')).toEqual({ hunger: 1, affection: 0, at: t.clock.now() })
  expect(t.log).toEqual([{ type: 'pet', hunger: 1, affection: 0, at: t.clock.now() }])
})

test('garbage reports are ignored', async () => {
  const t = setup()
  await t.pet.report(Number.NaN, 0.5)
  await t.pet.report('x' as unknown as number, 0.5)
  expect(t.pet.current()).toBeNull()
  expect(t.log).toEqual([])
})

test('feed announces the food; an unknown food is fish', () => {
  const t = setup()
  t.pet.feed('milk')
  t.pet.feed('sushi' as never)
  t.pet.feed()
  expect(t.log.map(e => e.type === 'feed' && e.food)).toEqual(['milk', 'fish', 'fish'])
})

test('deep sleep: emits sleep, the mic is off, and after 15 minutes Memory is asked to dream', () => {
  const t = setup()
  t.pet.sleep()
  expect(t.types()).toEqual(['sleep'])
  expect(t.pet.sleeping()).toBe(true)
  t.clock.advance(DEEP_SLEEP_DREAM_MS - 1000)
  expect(t.dreams).toEqual([])
  t.clock.advance(1000)
  expect(t.dreams).toEqual(['สั่งให้นอนครบ 15 นาที'])
  t.clock.advance(30 * MIN)
  expect(t.dreams).toHaveLength(1)
})

test('wakeup before 15 minutes cancels the dream and says so; a second wakeup says nothing was cancelled', () => {
  const t = setup()
  t.pet.sleep()
  t.clock.advance(5 * MIN)
  expect(t.pet.wake()).toBe(true)
  expect(t.pet.sleeping()).toBe(false)
  expect(t.pet.wake()).toBe(false)
  t.clock.advance(30 * MIN)
  expect(t.dreams).toEqual([])
  expect(t.log.filter(e => e.type === 'wakeup').map(e => e.type === 'wakeup' && e.dreamCancelled)).toEqual([true, false])
})

test('sleeping again restarts the 15 minutes', () => {
  const t = setup()
  t.pet.sleep()
  t.clock.advance(10 * MIN)
  t.pet.sleep()
  t.clock.advance(10 * MIN)
  expect(t.dreams).toEqual([])
  t.clock.advance(5 * MIN)
  expect(t.dreams).toHaveLength(1)
})

test('an alarm (or any wake) after the dream started still reports dreamCancelled:false', () => {
  const t = setup()
  t.pet.sleep()
  t.clock.advance(16 * MIN)
  expect(t.pet.wake()).toBe(false)
})

test('the saved report survives a restart', async () => {
  const t = setup()
  await t.pet.report(0.4, 0.9)
  const again = createPet({ clock: t.clock, events: createEvents({ clock: t.clock }), store: { read: k => t.saved.get(k), write: async () => {} } })
  expect(again.current()).toEqual({ hunger: 0.4, affection: 0.9, at: t.clock.now() })
})

test('without a Memory hook the dream is simply skipped', () => {
  const clock = new FakeClock()
  const pet = createPet({ clock, events: createEvents({ clock }), store: { read: () => undefined, write: async () => {} } })
  pet.sleep()
  clock.advance(DEEP_SLEEP_DREAM_MS)
  expect(pet.sleeping()).toBe(true)
})

// ---- fast phrases (ported from app/server.js) ----
const run = (t: ReturnType<typeof setup>, phrase: string) => {
  const action = t.pet.understand(phrase)
  action?.()
  return action !== null
}

test('phrases: feeding picks the food, "หิวไหม" asks, "ไปนอนได้แล้ว" sleeps', () => {
  const t = setup()
  expect(run(t, 'ให้ปลาหน่อย')).toBe(true)
  expect(run(t, 'ให้นมหน่อย')).toBe(true)
  expect(run(t, 'กินขนมกัน')).toBe(true)
  expect(run(t, 'ข้าวมาแล้ว')).toBe(true)
  expect(run(t, 'หิวไหม')).toBe(true)
  expect(run(t, 'ไปนอนได้แล้วนะ')).toBe(true)
  expect(run(t, 'ราตรีสวัสดิ์')).toBe(true)
  expect(t.log.map(e => (e.type === 'feed' ? `feed:${e.food}` : e.type))).toEqual(['feed:fish', 'feed:milk', 'feed:cookie', 'feed:fish', 'pet_ask', 'sleep', 'sleep'])
})

test('phrases: other sentences are not pet commands', () => {
  const t = setup()
  expect(run(t, 'ราคาทองวันนี้เท่าไหร่')).toBe(false)
  expect(run(t, 'ปลาแซลมอนทำยังไง')).toBe(false)
  expect(run(t, 'ฉันจะไปนอนที่โรงแรมไหนดี')).toBe(false)
  expect(t.log).toEqual([])
})
