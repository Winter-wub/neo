// neo devices pair|list|revoke against a real daemon (command socket + phone port), with a phone acting like NeoApp.
import { afterEach, expect, test } from 'bun:test'
import { join } from 'node:path'
import { FakeClock, golden, tempHome } from '../../../test/helpers'
import { runCli } from '../command/cli'
import { startCommandServer } from '../command/server'
import { connect } from '../command/client'
import { createCore } from '../../core/core'
import type { DeviceInfo, PairStart } from '../../protocol'
import { startPhoneServer } from './server'

const cleanups: Array<() => Promise<unknown>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

async function running() {
  const { dir, cleanup } = await tempHome()
  const clock = new FakeClock()
  const core = await createCore({ home: dir, clock, pid: 1 })
  const command = await startCommandServer({ core, clock, home: dir })
  const phone = await startPhoneServer({
    core, clock, port: 0, apkPath: join(dir, 'neo.apk'),
    networks: () => [], tailscale: async () => ({ ip: '100.64.0.9', host: 'mac.tail0000.ts.net' }),
  })
  cleanups.push(cleanup, () => core.devices.flush(), () => command.stop(), () => phone.stop())
  return { dir, core, clock, phone, base: `http://127.0.0.1:${phone.port}` }
}

async function neo(dir: string, args: string[]) {
  const out: string[] = []
  const err: string[] = []
  const code = await runCli([...args, '--home', dir], { out: t => void out.push(t), err: t => void err.push(t), env: {} })
  return { code, stdout: out.join(''), stderr: err.join('') }
}

test('neo devices pair prints code, addresses and expiry; the phone pairs with it, shows in list with last seen, and revoke cuts it off', async () => {
  const { dir, base, phone, clock } = await running()

  const pairing = await neo(dir, ['devices', 'pair', '--json'])
  expect(pairing.code).toBe(0)
  const start = JSON.parse(pairing.stdout) as PairStart
  expect(start.code).toMatch(/^\d{6}$/)
  expect(start.expiresAt).toBe(clock.now() + 5 * 60_000)
  expect(start.addresses.map(a => a.method)).toEqual(['USB', 'URL ของคุณเอง'])
  expect(start.addresses[0]!.url).toBe(`http://localhost:${phone.port}`)
  await golden('devices-pair', { ...start, code: '123456', expiresAt: 1_700_000_300_000, addresses: start.addresses.map(a => ({ ...a, url: a.url.replace(String(phone.port), '8100'), note: a.note.replaceAll(String(phone.port), '8100') })) })

  const markdown = await neo(dir, ['devices', 'pair'])
  expect(markdown.stdout).toMatch(/\*\*รหัส: \d{6}\*\*/)
  expect(markdown.stdout).toContain('USB')

  // NeoApp's SetupActivity: hello, then pair with the latest code
  const code = JSON.parse((await neo(dir, ['devices', 'pair', '--json'])).stdout).code
  expect(await (await fetch(`${base}/api/hello`)).text()).toContain('"neo"')
  const paired = await (await fetch(`${base}/api/pair`, { method: 'POST', body: JSON.stringify({ code, name: 'samsung SM-A750F' }) })).json() as { token: string; id: string }

  const before = JSON.parse((await neo(dir, ['devices', 'list', '--json'])).stdout) as DeviceInfo[]
  expect(before).toEqual([{ id: paired.id, name: 'samsung SM-A750F', paired: new Date(clock.now()).toISOString(), lastSeen: null }])

  clock.advance(90_000)
  const headers = { authorization: `Bearer ${paired.token}` }
  const abort = new AbortController()
  cleanups.push(async () => abort.abort())
  expect((await fetch(`${base}/api/events`, { headers, signal: abort.signal })).status).toBe(200)
  const after = JSON.parse((await neo(dir, ['devices', 'list', '--json'])).stdout) as DeviceInfo[]
  expect(after[0]!.lastSeen).toBe(new Date(clock.now()).toISOString())
  expect((await neo(dir, ['devices', 'list'])).stdout).toContain('samsung SM-A750F')
  await golden('devices-list', after.map(d => ({ ...d, id: 'a1b2c3d4e5f6', paired: '2023-11-14T22:13:20.000Z', lastSeen: '2023-11-14T22:14:50.000Z' })))

  expect((await neo(dir, ['devices', 'revoke', paired.id])).code).toBe(0)
  expect((await fetch(`${base}/api/events`, { headers })).status).toBe(401)
  expect(JSON.parse((await neo(dir, ['devices', 'list', '--json'])).stdout)).toEqual([])
})

test('neo devices revoke with an unknown id exits 1; with no id exits 2', async () => {
  const { dir } = await running()
  expect((await neo(dir, ['devices', 'revoke', 'nope'])).code).toBe(1)
  expect((await neo(dir, ['devices', 'revoke'])).code).toBe(2)
  expect((await neo(dir, ['devices', 'wat'])).code).toBe(2)
})

test('neo events shows paired and devices events; golden fixtures for them', async () => {
  const { dir, core, base } = await running()
  const abort = new AbortController()
  const lines: unknown[] = []
  const reading = (async () => {
    for await (const line of connect(dir).events({ signal: abort.signal })) lines.push(line)
  })()
  cleanups.push(async () => { abort.abort(); await reading })
  const { code } = core.devices.startPairing()
  const paired = await (await fetch(`${base}/api/pair`, { method: 'POST', body: JSON.stringify({ code, name: 'Pixel' }) })).json() as { id: string }
  core.devices.revoke(paired.id)
  for (let i = 0; i < 50 && lines.length < 4; i++) await Bun.sleep(20)
  const types = lines.map(l => (l as { type: string }).type)
  expect(types).toContain('paired')
  expect(types).toContain('devices')
  await golden('event-paired', lines.find(l => (l as { type: string }).type === 'paired'))
  await golden('event-devices', lines.find(l => (l as { type: string }).type === 'devices'))
})
