import { afterEach, expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { FakeClock, tempHome } from '../../../test/helpers'
import type { NeoEvent } from '../../protocol'
import { createEvents } from '../events/events'
import { createDevices } from './devices'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup()
})

async function setup(existingHome?: string) {
  const temp = existingHome ? null : await tempHome()
  if (temp) cleanups.push(temp.cleanup)
  const home = existingHome ?? temp!.dir
  const clock = new FakeClock()
  const events = createEvents({ clock })
  const published: NeoEvent[] = []
  events.subscribe(ev => published.push(ev))
  const devices = await createDevices({ home, clock, events })
  cleanups.unshift(devices.flush)
  return { home, clock, devices, published }
}

const bearer = (token: string) => ({ authorization: `Bearer ${token}` })

async function pairOne(devices: Awaited<ReturnType<typeof setup>>['devices'], name = 'samsung SM-A750F') {
  const { code } = devices.startPairing()
  const result = devices.pair(code, name)
  if ('error' in result) throw new Error(result.error)
  return result
}

test('a pairing code is six digits and lasts five minutes', async () => {
  const { devices, clock } = await setup()
  const { code, expiresAt } = devices.startPairing()
  expect(code).toMatch(/^\d{6}$/)
  expect(expiresAt).toBe(clock.now() + 5 * 60_000)
})

test('the right code gives a 48-hex token, once; the device then passes', async () => {
  const { devices, published } = await setup()
  const { code } = devices.startPairing()
  const paired = devices.pair(code, 'samsung SM-A750F')
  expect(paired).toMatchObject({ token: expect.stringMatching(/^[a-f0-9]{48}$/), id: expect.stringMatching(/^[a-f0-9]{12}$/) })
  expect(published.map(e => e.type)).toEqual(['paired'])
  expect(published[0]).toMatchObject({ type: 'paired', name: 'samsung SM-A750F' })
  expect(devices.pair(code, 'again')).toEqual({ error: expect.stringContaining('ไม่มีรหัส') })
})

test('a wrong code is refused, and five wrong tries burn the code', async () => {
  const { devices } = await setup()
  const { code } = devices.startPairing()
  const wrong = code === '000000' ? '111111' : '000000'
  for (let i = 0; i < 5; i++) expect(devices.pair(wrong, 'x')).toEqual({ error: 'รหัสไม่ถูกต้อง' })
  expect(devices.pair(wrong, 'x')).toEqual({ error: expect.stringContaining('ผิดหลายครั้ง') })
  expect(devices.pair(code, 'x')).toEqual({ error: expect.stringContaining('ไม่มีรหัส') })
})

test('an expired code is refused; a new code replaces the previous one', async () => {
  const { devices, clock } = await setup()
  const first = devices.startPairing()
  clock.advance(5 * 60_000 + 1)
  expect(devices.pair(first.code, 'x')).toEqual({ error: expect.stringContaining('ไม่มีรหัส') })

  const a = devices.startPairing()
  const b = devices.startPairing()
  if (a.code !== b.code) expect(devices.pair(a.code, 'x')).toEqual({ error: 'รหัสไม่ถูกต้อง' })
  expect(devices.pair(b.code, 'x')).toMatchObject({ token: expect.any(String) })
})

test('access: open routes need nothing; every other route needs a valid device token, localhost has no special rights', async () => {
  const { devices } = await setup()
  const { token } = await pairOne(devices)
  for (const route of ['/api/hello', '/api/pair', '/neo.apk']) {
    expect(devices.check({ route, headers: {} })).toEqual({ ok: true })
  }
  for (const route of ['/api/events', '/api/audio', '/api/face', '/api/arm', '/api/pet', '/api/anything']) {
    expect(devices.check({ route, headers: {} })).toMatchObject({ ok: false, status: 401 })
    expect(devices.check({ route, headers: bearer('0'.repeat(48)) })).toMatchObject({ ok: false, status: 401 })
    expect(devices.check({ route, headers: { authorization: `Bearer ${token.toUpperCase()}x` } })).toMatchObject({ ok: false, status: 401 })
    expect(devices.check({ route, headers: bearer(token) })).toMatchObject({ ok: true, device: { name: 'samsung SM-A750F' } })
  }
})

test('revoke makes the token fail on its next request and emits devices', async () => {
  const { devices, published } = await setup()
  const { token, id } = await pairOne(devices)
  expect(devices.revoke(id)).toBe(true)
  expect(devices.check({ route: '/api/events', headers: bearer(token) })).toMatchObject({ ok: false, status: 401 })
  expect(published.map(e => e.type)).toEqual(['paired', 'devices'])
  expect(devices.revoke(id)).toBe(false)
  expect(devices.list()).toEqual([])
})

test('devices.json keeps only sha256 of the token, mode 0600, and survives a restart', async () => {
  const { home, devices } = await setup()
  const { token } = await pairOne(devices)
  await devices.flush()
  const file = join(home, 'devices.json')
  const raw = await readFile(file, 'utf8')
  expect(raw).not.toContain(token)
  expect((await Bun.file(file).stat()).mode & 0o777).toBe(0o600)
  const hash = new Bun.CryptoHasher('sha256').update(token).digest('hex')
  expect(Object.keys(JSON.parse(raw))).toEqual([hash])

  const again = await setup(home)
  expect(again.devices.check({ route: '/api/events', headers: bearer(token) })).toMatchObject({ ok: true })
})

test('lastSeen shows in list at once but is saved at most once a minute per device', async () => {
  const { home, devices, clock } = await setup()
  const { token, id } = await pairOne(devices)
  const savedLastSeen = async () => {
    await devices.flush()
    const saved = Object.values(JSON.parse(await readFile(join(home, 'devices.json'), 'utf8'))) as Array<{ lastSeen: string | null }>
    return saved[0]!.lastSeen
  }
  const iso = () => new Date(clock.now()).toISOString()
  expect(devices.list()[0]).toMatchObject({ id, lastSeen: null })

  devices.check({ route: '/api/events', headers: bearer(token) })
  const first = iso()
  expect(devices.list()[0]!.lastSeen).toBe(first)
  expect(await savedLastSeen()).toBe(first)

  clock.advance(30_000)
  devices.check({ route: '/api/events', headers: bearer(token) })
  expect(devices.list()[0]!.lastSeen).toBe(iso())
  expect(await savedLastSeen()).toBe(first)

  clock.advance(31_000)
  devices.check({ route: '/api/events', headers: bearer(token) })
  expect(await savedLastSeen()).toBe(iso())
})
