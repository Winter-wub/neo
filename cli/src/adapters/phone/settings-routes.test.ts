import { afterEach, expect, test } from 'bun:test'
import { join } from 'node:path'
import { FakeClock, tempHome } from '../../../test/helpers'
import { createCore } from '../../core/core'
import { PHONE_SETTINGS_ROUTES } from '../../protocol'
import { startPhoneServer } from './server'
import { settingsRouteOf } from './settings-routes'

const cleanups: Array<() => Promise<unknown>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

test('only the listed command routes are phone routes, and each maps to its command-socket name', () => {
  for (const route of PHONE_SETTINGS_ROUTES) {
    const [method, path] = route.split(' ') as [string, string]
    expect(settingsRouteOf(method, `/api${path}`)).toBe(route)
  }
  expect(settingsRouteOf('GET', '/settings')).toBeUndefined() // not under /api
  expect(settingsRouteOf('GET', '/api/pet')).toBeUndefined() // POST /api/pet is the phone's own report
  expect(settingsRouteOf('POST', '/api/say')).toBeUndefined()
  expect(settingsRouteOf('POST', '/api/cancel')).toBeUndefined()
  expect(settingsRouteOf('POST', '/api/devices/pair')).toBeUndefined()
  expect(settingsRouteOf('GET', '/api/doctor')).toBeUndefined()
})

test('a revoked phone is cut off: its event stream ends by itself, others keep theirs', async () => {
  const { dir, cleanup } = await tempHome()
  const clock = new FakeClock()
  const core = await createCore({ home: dir, clock, pid: 1 })
  const phone = await startPhoneServer({ core, clock, port: 0, apkPath: join(dir, 'neo.apk'), networks: () => [], tailscale: async () => null })
  cleanups.push(cleanup, () => phone.stop(), () => core.devices.flush())
  const base = `http://127.0.0.1:${phone.port}`

  const pair = async () => {
    const { code } = core.devices.startPairing()
    return (await (await fetch(`${base}/api/pair`, { method: 'POST', body: JSON.stringify({ code, name: 'p' }) })).json()) as { token: string; id: string }
  }
  const [gone, stays] = [await pair(), await pair()]
  const open = async (token: string) => {
    const abort = new AbortController()
    cleanups.push(async () => abort.abort())
    const res = await fetch(`${base}/api/events`, { headers: { authorization: `Bearer ${token}` }, signal: abort.signal })
    const reader = res.body!.getReader()
    await reader.read() // hello
    return reader
  }
  const [goneStream, staysStream] = [await open(gone.token), await open(stays.token)]

  // the revoked phone asks for it itself
  const revoked = await fetch(`${base}/api/devices/revoke`, { method: 'POST', headers: { authorization: `Bearer ${gone.token}` }, body: JSON.stringify({ id: gone.id }) })
  expect(revoked.status).toBe(200)

  const ended = await Promise.race([
    (async () => { for (;;) if ((await goneStream.read()).done) return true })(),
    Bun.sleep(2000).then(() => false),
  ])
  expect(ended).toBe(true)
  const next = await staysStream.read()
  expect(next.done).toBe(false) // it hears the `devices` event
  expect(new TextDecoder().decode(next.value)).toContain('"devices"')

  expect((await fetch(`${base}/api/settings`, { headers: { authorization: `Bearer ${gone.token}` } })).status).toBe(401)
  expect((await fetch(`${base}/api/settings`, { headers: { authorization: `Bearer ${stays.token}` } })).status).toBe(200)
})
