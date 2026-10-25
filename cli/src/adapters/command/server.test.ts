import { afterEach, expect, test } from 'bun:test'
import { stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createCore } from '../../core/core'
import { FakeClock, nextOf, tempHome } from '../../../test/helpers'
import type { StreamLine } from '../../protocol'
import { CommandFailed, DaemonDown, connect } from './client'
import { startCommandServer, DaemonStartError } from './server'

const cleanups: Array<() => Promise<unknown>> = []
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map(c => c()))
})
async function setup() {
  const { dir, cleanup } = await tempHome()
  cleanups.push(cleanup)
  const clock = new FakeClock()
  const core = await createCore({ home: dir, clock, pid: 7 })
  const server = await startCommandServer({ core, clock, home: dir })
  cleanups.unshift(() => server.stop())
  return { dir, clock, core, server, daemon: connect(dir) }
}

test('the socket is mode 0600 and the home directory is private', async () => {
  const { dir, server } = await setup()
  expect((await stat(server.path)).mode & 0o777).toBe(0o600)
  expect((await stat(dir)).mode & 0o777).toBe(0o700)
})

test('typed calls reach the core', async () => {
  const { daemon } = await setup()
  expect((await daemon.call('GET /status')).pid).toBe(7)
  expect(await daemon.call('POST /settings', { followUp: false })).toMatchObject({ followUp: false })
  expect(await daemon.call('GET /daemon/info')).toMatchObject({ protocol: 1 })
})

test('a bad request comes back as {error, code}', async () => {
  const { daemon } = await setup()
  const err = await daemon.call('POST /settings', { requireName: 'x' } as never).catch(e => e)
  expect(err).toBeInstanceOf(CommandFailed)
  expect(err.code).toBe(1)
})

test('with nothing listening the client reports the daemon as down', async () => {
  const { dir, cleanup } = await tempHome()
  cleanups.push(cleanup)
  await expect(connect(dir).call('GET /status')).rejects.toBeInstanceOf(DaemonDown)
})

test('a stale socket file is replaced, a live one is refused', async () => {
  const { dir, clock, core, server } = await setup()
  await expect(startCommandServer({ core, clock, home: dir })).rejects.toBeInstanceOf(DaemonStartError)
  await server.stop()
  await writeFile(join(dir, 'neo.sock'), '')
  const again = await startCommandServer({ core, clock, home: dir })
  cleanups.unshift(() => again.stop())
  expect((await connect(dir).call('GET /status')).pid).toBe(7)
})

test('events: a status event arrives when a console connects, pings every 15 s', async () => {
  const { daemon, clock } = await setup()
  const abort = new AbortController()
  const it = daemon.events({ signal: abort.signal })[Symbol.asyncIterator]()
  const first = await nextOf(it)
  expect(first).toMatchObject({ type: 'status', consoles: 1 })
  clock.advance(15_000)
  expect(await nextOf(it)).toEqual({ type: 'ping' })
  abort.abort()
})

test('events: the live stream sees settings changes; --history replays first', async () => {
  const { daemon, core } = await setup()
  await core.settings.set({ bypass: false })
  const abort = new AbortController()
  const it = daemon.events({ history: true, signal: abort.signal })[Symbol.asyncIterator]()
  const got: StreamLine[] = []
  got.push(await nextOf(it), await nextOf(it))
  expect(got.map(e => e.type)).toEqual(['settings', 'status'])
  await daemon.call('POST /settings', { followUp: false })
  expect(await nextOf(it)).toMatchObject({ type: 'settings', followUp: false })
  abort.abort()
})

test('closing the stream drops the console count', async () => {
  const { daemon, core } = await setup()
  const abort = new AbortController()
  const it = daemon.events({ signal: abort.signal })[Symbol.asyncIterator]()
  await nextOf(it)
  expect(core.status().consoles).toBe(1)
  abort.abort()
  await it.return?.(undefined)
  for (let i = 0; i < 50 && core.status().consoles > 0; i++) await Bun.sleep(20)
  expect(core.status().consoles).toBe(0)
})
