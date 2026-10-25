import { afterEach, expect, test } from 'bun:test'
import { FakeClock, tempHome } from '../../test/helpers'
import type { NeoEvent } from '../protocol'
import { createCore } from './core'

const homes: Array<() => Promise<void>> = []
afterEach(async () => {
  await Promise.all(homes.splice(0).map(c => c()))
})
async function setup() {
  const { dir, cleanup } = await tempHome()
  homes.push(cleanup)
  const clock = new FakeClock()
  const core = await createCore({ home: dir, clock, pid: 4242 })
  return { core, clock }
}

test('status is a snapshot of the idle daemon', async () => {
  const { core, clock } = await setup()
  clock.advance(90_500)
  expect(core.status()).toEqual({
    phone: false, consoles: 0, provider: 'Claude Code', model: null, thinking: false, ringing: false, busy: false,
    requireName: true, bypass: true, pet: null, uptime: 90, pid: 4242,
  })
})

test('a stream listener counts as a console, and its arrival and departure publish status', async () => {
  const { core } = await setup()
  const watcher: NeoEvent[] = []
  const stopWatching = core.attach(ev => watcher.push(ev))
  expect(watcher.map(e => e.type === 'status' && e.consoles)).toEqual([1])

  const second = core.attach(() => {})
  expect(core.status().consoles).toBe(2)
  second()
  expect(watcher.map(e => e.type === 'status' && e.consoles)).toEqual([1, 2, 1])
  stopWatching()
  expect(core.status().consoles).toBe(0)
})

test('attach with history replays the backlog before the live status', async () => {
  const { core } = await setup()
  await core.settings.set({ bypass: false })
  const got: NeoEvent[] = []
  core.attach(ev => got.push(ev), { history: true })
  expect(got.map(e => e.type)).toEqual(['settings', 'status'])
})

test('update publishes status only when something actually changed', async () => {
  const { core } = await setup()
  const got: NeoEvent[] = []
  core.attach(ev => got.push(ev))
  got.length = 0
  core.update({ thinking: true })
  core.update({ thinking: true })
  expect(got).toHaveLength(1)
  expect(core.status().thinking).toBe(true)
})
