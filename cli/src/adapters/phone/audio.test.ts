// Acts like NeoApp's Link.kt: one endless chunked POST /api/audio of 100 ms PCM chunks, while /api/events is open.
import { afterEach, expect, test } from 'bun:test'
import { FakeClock, golden, tempHome } from '../../../test/helpers'
import type { Brain } from '../../core/brain/brain'
import { textCard } from '../../core/cards/cards'
import { createCore } from '../../core/core'
import { FRAME } from '../../core/ears/segmenter'
import type { StreamLine } from '../../protocol'
import { startPhoneServer } from './server'

const cleanups: Array<() => Promise<unknown>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

const tone = (rms: number) => Int16Array.from({ length: FRAME }, (_, i) => Math.round((i % 2 ? 1 : -1) * rms * 32768))
const chunk = (frame: Int16Array) => new Uint8Array(frame.buffer.slice(0))
const quiet = () => chunk(tone(0.0005))
const voice = () => chunk(tone(0.05))
const zeros = () => new Uint8Array(FRAME * 2)

async function setup() {
  const { dir, cleanup } = await tempHome()
  const clock = new FakeClock()
  const said: string[] = []
  const brain: Brain = {
    label: 'Fake',
    ask: async r => ({ answer: { type: 'card', card: textCard({ title: r.text, lines: [r.text] }) }, session: 's' }),
    runSkill: async () => ({ answer: { type: 'error', error: 'no' }, session: null }),
  }
  const core = await createCore({ home: dir, clock, pid: 1, brain, audioDir: dir, stt: { transcribe: async () => said.shift() ?? '' } })
  const phone = await startPhoneServer({ core, clock, port: 0, apkPath: `${dir}/neo.apk`, networks: () => [], tailscale: async () => null })
  cleanups.push(cleanup, () => phone.stop(), () => core.devices.flush())
  const base = `http://127.0.0.1:${phone.port}`
  const { code } = core.devices.startPairing()
  const { token } = await (await fetch(`${base}/api/pair`, { method: 'POST', body: JSON.stringify({ code, name: 'a7' }) })).json() as { token: string }
  const auth = { authorization: `Bearer ${token}` }

  // the event stream the phone reads
  const abort = new AbortController()
  cleanups.push(async () => abort.abort())
  const res = await fetch(`${base}/api/events`, { headers: auth, signal: abort.signal })
  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  const seen: StreamLine[] = []
  async function until(type: string, ms = 3000): Promise<StreamLine> {
    const deadline = Date.now() + ms
    for (;;) {
      const found = seen.find(e => e.type === type)
      if (found) return found
      for (let nl = buffer.indexOf('\n'); nl >= 0; nl = buffer.indexOf('\n')) {
        seen.push(JSON.parse(buffer.slice(0, nl)) as StreamLine)
        buffer = buffer.slice(nl + 1)
      }
      if (seen.find(e => e.type === type)) continue
      if (Date.now() > deadline) throw new Error(`no ${type} event; saw ${seen.map(e => e.type)}`)
      const timer = new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`timeout waiting for ${type}; saw ${seen.map(e => e.type)}`)), deadline - Date.now()))
      const part = await Promise.race([reader.read(), timer])
      if (part.done) throw new Error('events ended')
      buffer += decoder.decode(part.value, { stream: true })
    }
  }

  /** The upload: a body that stays open until `end()`. */
  function upload(headers: Record<string, string> = auth) {
    let controller!: ReadableStreamDefaultController<Uint8Array>
    const body = new ReadableStream<Uint8Array>({ start: c => void (controller = c) })
    const response = fetch(`${base}/api/audio`, { method: 'POST', headers: { 'content-type': 'application/octet-stream', ...headers }, body, duplex: 'half' } as RequestInit)
    return { write: (bytes: Uint8Array) => controller.enqueue(bytes), end: () => controller.close(), response }
  }
  return { core, clock, base, auth, said, until, seen, upload }
}

test('audio needs a device token', async () => {
  const t = await setup()
  const up = t.upload({})
  expect((await Promise.race([up.response, Bun.sleep(2000).then(() => null)]))?.status).toBe(401)
  const arm = await fetch(`${t.base}/api/arm`, { method: 'POST', body: '{}' })
  expect(arm.status).toBe(401)
})

test('the upload never ends, yet speech turns into heard and a card while it is open; ending it answers {ok:true}', async () => {
  const t = await setup()
  t.said.push('นีโอ วันนี้วันอะไร')
  const up = t.upload()
  for (let i = 0; i < 8; i++) up.write(quiet())
  for (let i = 0; i < 8; i++) up.write(voice())
  for (let i = 0; i < 10; i++) up.write(quiet())
  expect(await t.until('rec')).toMatchObject({ type: 'rec' })
  await t.until('stt')
  expect(await t.until('heard')).toMatchObject({ text: 'นีโอ วันนี้วันอะไร' })
  const card = await t.until('card')
  expect(card).toMatchObject({ type: 'card', card: { title: 'วันนี้วันอะไร' } })
  expect(t.core.status().phone).toBe(true)
  await golden('event-rec', { type: 'rec', at: 1_700_000_000_000 })
  await golden('event-short', { type: 'short', at: 1_700_000_000_000 })
  await golden('event-loud', { type: 'loud', at: 1_700_000_000_000 })
  await golden('event-stt', { type: 'stt', at: 1_700_000_000_000 })
  await golden('event-nothing', { type: 'nothing', at: 1_700_000_000_000 })
  await golden('event-stterr', { type: 'stterr', at: 1_700_000_000_000, error: 'ถอดเสียงไม่สำเร็จ' })
  await golden('event-listen_end', { type: 'listen_end', at: 1_700_000_000_000 })

  up.end()
  const done = await up.response
  expect(done.status).toBe(200)
  expect(await done.json()).toEqual({ ok: true })
  expect(t.core.status().phone).toBe(false)
})

test('all-zero frames (muted while Neo makes a sound) keep the stream alive but make no events', async () => {
  const t = await setup()
  const up = t.upload()
  for (let i = 0; i < 20; i++) up.write(zeros())
  up.end()
  expect((await up.response).status).toBe(200)
  expect(t.seen.filter(e => e.type === 'rec')).toEqual([])
})

test('POST /api/arm: the next sentence needs no name', async () => {
  const t = await setup()
  const arm = await fetch(`${t.base}/api/arm`, { method: 'POST', headers: t.auth, body: '{}' })
  expect(arm.status).toBe(200)
  expect(await arm.json()).toEqual({ ok: true })
  t.said.push('วันนี้วันอะไร')
  const up = t.upload()
  for (let i = 0; i < 8; i++) up.write(quiet())
  for (let i = 0; i < 8; i++) up.write(voice())
  for (let i = 0; i < 30; i++) up.write(quiet()) // armed = listen mode: 3 s of quiet ends the sentence
  expect(await t.until('card')).toMatchObject({ type: 'card' })
  up.end()
  await up.response
})

test('a phone that drops the connection mid-sentence stops counting as a phone', async () => {
  const t = await setup()
  const abort = new AbortController()
  let controller!: ReadableStreamDefaultController<Uint8Array>
  const body = new ReadableStream<Uint8Array>({ start: c => void (controller = c) })
  const response = fetch(`${t.base}/api/audio`, { method: 'POST', headers: t.auth, body, signal: abort.signal, duplex: 'half' } as RequestInit)
  response.catch(() => {})
  controller.enqueue(voice())
  for (let i = 0; i < 100 && !t.core.status().phone; i++) await Bun.sleep(10)
  expect(t.core.status().phone).toBe(true)
  abort.abort()
  for (let i = 0; i < 100 && t.core.status().phone; i++) await Bun.sleep(10)
  expect(t.core.status().phone).toBe(false)
})

test('the phone stream never carries `status` events (those are for consoles), even as the phone connects and speaks', async () => {
  const t = await setup()
  t.said.push('นีโอ วันนี้วันอะไร')
  const up = t.upload()
  for (let i = 0; i < 8; i++) up.write(quiet())
  for (let i = 0; i < 8; i++) up.write(voice())
  for (let i = 0; i < 10; i++) up.write(quiet())
  await t.until('card')
  up.end()
  await up.response
  expect(t.seen.map(e => e.type)).not.toContain('status')
})
