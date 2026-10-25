import { expect, test } from 'bun:test'
import { FakeClock } from '../../../test/helpers'
import { createEvents } from './events'

test('subscribers get every published event stamped with the time', () => {
  const clock = new FakeClock(5000)
  const events = createEvents({ clock })
  const seen: unknown[] = []
  events.subscribe(ev => seen.push(ev))
  events.publish({ type: 'paired', name: 'A7' })
  expect(seen).toEqual([{ type: 'paired', at: 5000, name: 'A7' }])
})

test('history replays what happened before subscribing, only when asked', () => {
  const events = createEvents({ clock: new FakeClock() })
  events.publish({ type: 'paired', name: 'A7' })
  const plain: unknown[] = []
  const withHistory: unknown[] = []
  events.subscribe(ev => plain.push(ev))
  events.subscribe(ev => withHistory.push(ev), { history: true })
  expect(plain).toHaveLength(0)
  expect(withHistory).toHaveLength(1)
})

test('history keeps the last 400 only', () => {
  const events = createEvents({ clock: new FakeClock() })
  for (let i = 0; i < 450; i++) events.publish({ type: 'paired', name: String(i) })
  const got: unknown[] = []
  events.subscribe(ev => got.push(ev), { history: true })
  expect(got).toHaveLength(400)
})

test('unsubscribe stops delivery and the listener count follows', () => {
  const events = createEvents({ clock: new FakeClock() })
  expect(events.listeners()).toBe(0)
  const off = events.subscribe(() => {})
  expect(events.listeners()).toBe(1)
  off()
  expect(events.listeners()).toBe(0)
})

test('events of unstored types are delivered but never replayed', () => {
  const events = createEvents({ clock: new FakeClock() })
  const live: unknown[] = []
  events.subscribe(ev => live.push(ev))
  events.publish({ type: 'pet', hunger: 0.5, affection: 0.5 } as never)
  const replay: unknown[] = []
  events.subscribe(ev => replay.push(ev), { history: true })
  expect(live).toHaveLength(1)
  expect(replay).toHaveLength(0)
})
