// Acts like NeoApp: Net.get/post against /api/hello, /api/pair, then the /api/events loop with a Bearer token.
import { afterEach, expect, test } from 'bun:test'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { FakeClock, golden, tempHome } from '../../../test/helpers'
import { createCore, type Core } from '../../core/core'
import type { StreamLine } from '../../protocol'
import { startPhoneServer, type Network } from './server'

const cleanups: Array<() => Promise<unknown>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

async function setup(options: { networks?: Network[]; tailscale?: { ip: string; host: string } | null; apk?: boolean } = {}) {
  const { dir, cleanup } = await tempHome()
  const clock = new FakeClock()
  const core = await createCore({ home: dir, clock, pid: 1 })
  const apkPath = join(dir, 'neo.apk')
  if (options.apk) await writeFile(apkPath, 'APKBYTES')
  const phone = await startPhoneServer({
    core, clock, port: 0, apkPath, pingMs: 15_000,
    networks: () => options.networks ?? [],
    tailscale: async () => options.tailscale ?? null,
  })
  cleanups.push(cleanup, () => phone.stop(), () => core.devices.flush())
  return { core, clock, phone, base: `http://127.0.0.1:${phone.port}` }
}

async function pairPhone(core: Core, base: string, name = 'samsung SM-A750F') {
  const { code } = core.devices.startPairing()
  const res = await fetch(`${base}/api/pair`, { method: 'POST', body: JSON.stringify({ code, name }) })
  return { res, ...(await res.json() as { token: string; id: string; name: string }) }
}

/** The NeoApp event loop: GET /api/events with the token, read NDJSON lines. */
async function openEvents(base: string, token: string) {
  const abort = new AbortController()
  const res = await fetch(`${base}/api/events`, { headers: { authorization: `Bearer ${token}` }, signal: abort.signal })
  cleanups.push(async () => abort.abort())
  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  async function next(timeoutMs = 2000): Promise<string> {
    for (;;) {
      const nl = buffer.indexOf('\n')
      if (nl >= 0) {
        const line = buffer.slice(0, nl)
        buffer = buffer.slice(nl + 1)
        return line
      }
      const timer = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout waiting for a line')), timeoutMs))
      const chunk = await Promise.race([reader.read(), timer])
      if (chunk.done) throw new Error('stream ended')
      buffer += decoder.decode(chunk.value, { stream: true })
    }
  }
  return { res, next, json: async () => JSON.parse(await next()) as StreamLine }
}

test('hello is open and says neo; pair with the right code returns token, id and the pet name', async () => {
  const { core, base } = await setup()
  const hello = await fetch(`${base}/api/hello`, { method: 'POST' })
  expect(hello.status).toBe(200)
  expect(await hello.text()).toContain('"neo"')

  const bad = await fetch(`${base}/api/pair`, { method: 'POST', body: JSON.stringify({ code: '123456', name: 'x' }) })
  expect(bad.status).toBe(400)
  expect(await bad.json()).toMatchObject({ error: expect.any(String) })

  const paired = await pairPhone(core, base)
  expect(paired.res.status).toBe(200)
  expect(paired.token).toMatch(/^[a-f0-9]{48}$/)
  expect(paired.name).toBe('นีโอ')
})

test('a malformed pair body is a 400, not a crash', async () => {
  const { base } = await setup()
  const res = await fetch(`${base}/api/pair`, { method: 'POST', body: '{nope' })
  expect(res.status).toBe(400)
})

test('every route except hello/pair/apk is 401 without a device token, including from localhost', async () => {
  const { base } = await setup()
  for (const [method, path] of [
    ['GET', '/api/events'], ['POST', '/api/audio'], ['POST', '/api/arm'], ['GET', '/api/face'], ['POST', '/api/face'],
    ['POST', '/api/pet'], ['POST', '/api/wakeup'], ['POST', '/api/alarm/stop'], ['POST', '/api/dream/seen'],
    ['POST', '/api/say'], ['GET', '/api/status'], ['GET', '/api/settings'], ['POST', '/api/pair/start'], ['GET', '/api/devices'],
  ] as const) {
    const res = await fetch(`${base}${path}`, { method })
    expect([method, path, res.status]).toEqual([method, path, 401])
  }
  const wrong = await fetch(`${base}/api/events`, { headers: { authorization: `Bearer ${'a'.repeat(48)}` } })
  expect(wrong.status).toBe(401)
})

test('/api/ask and /api/cancel are not on the phone port: 404 for a paired phone', async () => {
  const { core, base } = await setup()
  const { token } = await pairPhone(core, base)
  const headers = { authorization: `Bearer ${token}` }
  expect((await fetch(`${base}/api/ask`, { method: 'POST', headers, body: '{"text":"hi"}' })).status).toBe(404)
  expect((await fetch(`${base}/api/cancel`, { method: 'POST', headers, body: '{}' })).status).toBe(404)
})

test('events: hello first (no at), then live events, then the exact ping every 15 s', async () => {
  const { core, clock, base } = await setup()
  const { token } = await pairPhone(core, base)
  const events = await openEvents(base, token)
  expect(events.res.headers.get('content-type')).toContain('application/x-ndjson')

  const hello = await events.json()
  await golden('event-hello', hello)
  expect(hello).toEqual({
    type: 'hello', thinking: false, provider: 'Claude Code', name: 'นีโอ',
    face: { fg: '#7fffd4', accent: '#ff7aa8', cheek: '#ff9a9a', bg: '#000000' },
    idle: { sleepAfter: 150, clock: true }, ringing: null,
  })

  core.events.publish({ type: 'devices' })
  // `status` is console-only and filtered from the phone stream, so the next line is the live event
  expect((await events.json()).type).toBe('devices')

  clock.advance(15_000)
  let line = await events.next()
  while (line !== '{"type":"ping"}') line = await events.next()
  expect(line).toBe('{"type":"ping"}')
})

test('an event payload containing the string ping reaches NeoApp intact and survives its "ping" line filter', async () => {
  const { core, base } = await setup()
  const { token } = await pairPhone(core, base)
  const events = await openEvents(base, token)
  await events.next() // hello
  core.events.publish({ type: 'paired', name: 'ping' })
  let line = await events.next()
  while (!line.includes('paired')) line = await events.next()
  expect(line.includes('"ping"')).toBe(false) // Link.kt's filter
  expect(JSON.parse(line)).toMatchObject({ type: 'paired', name: 'ping' })
})

test('a phone on the event stream counts as a console in status', async () => {
  const { core, base } = await setup()
  const { token } = await pairPhone(core, base)
  const events = await openEvents(base, token)
  await events.next()
  expect(core.status().consoles).toBe(1)
})

test('revoke: the phone\'s next request is 401 (NeoApp shows unpaired)', async () => {
  const { core, base } = await setup()
  const { token, id } = await pairPhone(core, base)
  const headers = { authorization: `Bearer ${token}` }
  expect((await fetch(`${base}/api/events`, { headers })).status).toBe(200)
  core.devices.revoke(id)
  expect((await fetch(`${base}/api/events`, { headers })).status).toBe(401)
})

test('/neo.apk serves the file to anyone as an attachment; 404 text when there is none', async () => {
  const withApk = await setup({ apk: true })
  const ok = await fetch(`${withApk.base}/neo.apk`)
  expect(ok.status).toBe(200)
  expect(ok.headers.get('content-type')).toBe('application/vnd.android.package-archive')
  expect(ok.headers.get('content-disposition')).toBe('attachment; filename="neo.apk"')
  expect(await ok.text()).toBe('APKBYTES')

  const none = await setup()
  const missing = await fetch(`${none.base}/neo.apk`)
  expect(missing.status).toBe(404)
  expect(await missing.text()).toBe('no apk')
})

test('listeners: localhost always; LAN only while the lan setting is on; Tailscale only while tailscale is on', async () => {
  const networks: Network[] = [{ ip: '::1', kind: 'lan', iface: 'lo0' }]
  const { core, phone, base } = await setup({ networks })
  const lanUrl = `http://[::1]:${phone.port}/api/hello`
  const reachable = () => fetch(lanUrl).then(r => r.status, () => 0)

  await phone.rebind()
  expect(await reachable()).toBe(0)
  await core.settings.set({ lan: true })
  await phone.rebind()
  expect(await reachable()).toBe(200)
  await core.settings.set({ lan: false })
  await phone.rebind()
  expect(await reachable()).toBe(0)
  expect((await fetch(`${base}/api/hello`)).status).toBe(200)
})

test('a settings change rebinds without being asked', async () => {
  const { core, phone } = await setup({ networks: [{ ip: '::1', kind: 'lan', iface: 'lo0' }] })
  await core.settings.set({ lan: true })
  await Bun.sleep(100)
  expect((await fetch(`http://[::1]:${phone.port}/api/hello`).catch(() => null))?.status).toBe(200)
})

test('pairing addresses: Tailscale host, LAN ip, USB with the real port, custom URL', async () => {
  const { core, phone } = await setup({
    networks: [{ ip: '::1', kind: 'lan', iface: 'lo0' }],
    tailscale: { ip: '::1', host: 'mac.tail1234.ts.net' },
  })
  await core.settings.set({ lan: true })
  await phone.rebind()
  const methods = phone.addresses().map(a => [a.method, a.url])
  expect(methods).toContainEqual(['Wi-Fi/LAN', `http://[::1]:${phone.port}`])
  expect(methods).toContainEqual(['USB', `http://localhost:${phone.port}`])
  expect(phone.addresses().map(a => a.method)).toContain('URL ของคุณเอง')
})

test('pairing addresses list the Tailscale host while the tailscale setting is on and its address is bound', async () => {
  const { phone, core } = await setup({
    networks: [{ ip: '::1', kind: 'tailscale', iface: 'utun3' }],
    tailscale: { ip: '::1', host: 'mac.tail1234.ts.net' },
  })
  expect(phone.addresses()[0]).toMatchObject({ method: 'Tailscale', url: `http://mac.tail1234.ts.net:${phone.port}` })
  await core.settings.set({ tailscale: false })
  await phone.rebind()
  expect(phone.addresses().map(a => a.method)).not.toContain('Tailscale')
})

test('idle settings reach the phone: in hello, and as an idle event when they change', async () => {
  const { core, base } = await setup()
  const { token } = await pairPhone(core, base)
  await core.settings.set({ idle: { sleepAfter: 900 } })
  const events = await openEvents(base, token)
  expect(await events.json()).toMatchObject({ type: 'hello', idle: { sleepAfter: 900, clock: true } })
  await core.settings.setByKey('idle.clock', ['false'])
  const seen: StreamLine[] = []
  while (!seen.some(line => line.type === 'idle')) seen.push(await events.json())
  expect(seen.find(line => line.type === 'idle')).toMatchObject({ sleepAfter: 900, clock: false })
})
