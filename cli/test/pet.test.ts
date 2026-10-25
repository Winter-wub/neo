// Ticket 10 end to end: neo pet / neo name / neo face and the phone's /api/pet and /api/wakeup, against a real core, a real socket, the phone port and a fake clock.
import { afterEach, expect, test } from 'bun:test'
import { join } from 'node:path'
import { runCli } from '../src/adapters/command/cli'
import { startCommandServer } from '../src/adapters/command/server'
import { startPhoneServer } from '../src/adapters/phone/server'
import type { Answer, Brain } from '../src/core/brain/brain'
import { textCard } from '../src/core/cards/cards'
import { createCore } from '../src/core/core'
import type { NeoEvent, StreamLine } from '../src/protocol'
import { FakeClock, golden, tempHome } from './helpers'

const MIN = 60_000
const cleanups: Array<() => Promise<unknown>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

function scriptedBrain() {
  const asked: string[] = []
  const answer: Answer = { type: 'card', card: textCard({ title: 'ตอบแล้ว', lines: ['ตอบแล้ว'] }) }
  const brain: Brain = {
    label: 'Fake',
    ask: async request => (asked.push(request.text), { answer, session: 's1' }),
    runSkill: async () => ({ answer, session: null }),
  }
  return { brain, asked }
}

async function running(options: { dream?: (reason: string) => void } = {}) {
  const { dir, cleanup } = await tempHome()
  const clock = new FakeClock()
  const { brain, asked } = scriptedBrain()
  const core = await createCore({ home: dir, clock, pid: 1, brain, env: { HOME: dir, PATH: process.env.PATH }, dream: options.dream })
  const server = await startCommandServer({ core, clock, home: dir })
  const phone = await startPhoneServer({ core, clock, port: 0, apkPath: join(dir, 'neo.apk'), networks: () => [], tailscale: async () => null })
  cleanups.push(cleanup, () => core.stop(), () => server.stop(), () => phone.stop(), () => core.devices.flush())

  // a paired phone with its event stream, the way NeoApp does it
  const base = `http://127.0.0.1:${phone.port}`
  const { code } = core.devices.startPairing()
  const { token } = (await (await fetch(`${base}/api/pair`, { method: 'POST', body: JSON.stringify({ code, name: 'A7' }) })).json()) as { token: string }
  const abort = new AbortController()
  const res = await fetch(`${base}/api/events`, { headers: { authorization: `Bearer ${token}` }, signal: abort.signal })
  cleanups.push(async () => abort.abort())
  const lines: StreamLine[] = []
  void (async () => {
    const reader = res.body!.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    try {
      for (;;) {
        const chunk = await reader.read()
        if (chunk.done) return
        buffer += decoder.decode(chunk.value, { stream: true })
        for (let nl = buffer.indexOf('\n'); nl >= 0; nl = buffer.indexOf('\n')) {
          lines.push(JSON.parse(buffer.slice(0, nl)))
          buffer = buffer.slice(nl + 1)
        }
      }
    } catch {
      // closed
    }
  })()
  const seen = async (match: (e: StreamLine) => boolean) => {
    for (let i = 0; i < 200; i++) {
      const hit = lines.find(match)
      if (hit) return hit
      await Bun.sleep(10)
    }
    throw new Error('event never arrived')
  }
  const post = (path: string, body: unknown = {}) =>
    fetch(`${base}${path}`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: typeof body === 'string' ? body : JSON.stringify(body) })
  const hello = await seen(e => e.type === 'hello')
  return { dir, core, clock, asked, lines, seen, post, hello, base }
}

async function neo(dir: string, args: string[]) {
  const out: string[] = []
  const err: string[] = []
  const code = await runCli([...args, '--home', dir], { out: t => void out.push(t), err: t => void err.push(t), env: {} })
  return { code, stdout: out.join(''), stderr: err.join('') }
}

test('neo pet feed milk makes the phone eat; with no food it is fish', async () => {
  const { dir, seen } = await running()
  const fed = await neo(dir, ['pet', 'feed', 'milk', '--json'])
  expect(fed.code).toBe(0)
  expect(JSON.parse(fed.stdout)).toEqual({ food: 'milk' })
  await golden('pet-feed', { food: 'milk' })
  expect(await seen(e => e.type === 'feed' && e.food === 'milk')).toMatchObject({ type: 'feed', food: 'milk', at: expect.any(Number) })
  await golden('event-feed', { type: 'feed', at: 1_700_000_000_000, food: 'milk' })
  expect(JSON.parse((await neo(dir, ['pet', 'feed', '--json'])).stdout)).toEqual({ food: 'fish' })
})

test('the phone reports are saved and shown by neo pet (and by neo status)', async () => {
  const { dir, post, seen, core } = await running()
  expect(JSON.parse((await neo(dir, ['pet', '--json'])).stdout)).toEqual({ pet: null, sleeping: false })
  expect((await neo(dir, ['pet'])).stdout).toContain('ยังไม่มีรายงาน')

  const res = await post('/api/pet', { hunger: 0.4, affection: 1.7 })
  expect(await res.json()).toEqual({ ok: true })
  const event = await seen(e => e.type === 'pet')
  expect(event).toMatchObject({ type: 'pet', hunger: 0.4, affection: 1 })
  await golden('event-pet', { type: 'pet', at: 1_700_000_000_000, hunger: 0.4, affection: 1 })

  const shown = await neo(dir, ['pet', '--json'])
  expect(JSON.parse(shown.stdout)).toEqual({ pet: { hunger: 0.4, affection: 1, at: 1_700_000_000_000 }, sleeping: false })
  await golden('pet-show', { pet: { hunger: 0.4, affection: 1, at: 1_700_000_000_000 }, sleeping: false })
  const text = (await neo(dir, ['pet'])).stdout
  expect(text).toContain('40%')
  expect(core.status().pet).toMatchObject({ hunger: 0.4 })

  expect((await post('/api/pet', '{not json')).status).toBe(400)
  expect((await post('/api/pet', { hunger: 0.1, junk: 'x'.repeat(21_000) })).status).toBe(413)
})

test('the report survives a restart of the daemon', async () => {
  const { dir, post, seen, core } = await running()
  await post('/api/pet', { hunger: 0.25, affection: 0.75 })
  await seen(e => e.type === 'pet')
  await core.stop()
  const again = await createCore({ home: dir, clock: new FakeClock(), pid: 2, brain: scriptedBrain().brain, env: { HOME: dir, PATH: process.env.PATH } })
  cleanups.push(() => again.stop())
  expect(again.status().pet).toMatchObject({ hunger: 0.25, affection: 0.75 })
})

test('neo pet sleep emits sleep; tapping the phone (wakeup) cancels the pending dream; no tap and the dream is asked for after 15 minutes', async () => {
  const dreams: string[] = []
  const { dir, post, seen, clock, lines } = await running({ dream: reason => void dreams.push(reason) })
  const slept = await neo(dir, ['pet', 'sleep', '--json'])
  expect(JSON.parse(slept.stdout)).toEqual({ ok: true })
  await golden('pet-sleep', { ok: true })
  await seen(e => e.type === 'sleep')
  expect(JSON.parse((await neo(dir, ['pet', '--json'])).stdout).sleeping).toBe(true)

  clock.advance(5 * MIN)
  expect(await (await post('/api/wakeup')).json()).toEqual({ ok: true })
  expect(await seen(e => e.type === 'wakeup')).toMatchObject({ dreamCancelled: true })
  await golden('event-wakeup', { type: 'wakeup', at: 1_700_000_000_000, dreamCancelled: true })
  clock.advance(30 * MIN)
  expect(dreams).toEqual([])
  expect(JSON.parse((await neo(dir, ['pet', '--json'])).stdout).sleeping).toBe(false)

  await neo(dir, ['pet', 'sleep'])
  clock.advance(15 * MIN)
  expect(dreams).toEqual(['สั่งให้นอนครบ 15 นาที'])
  await post('/api/wakeup')
  await Bun.sleep(50)
  expect(lines.filter(e => e.type === 'wakeup').map(e => e.type === 'wakeup' && e.dreamCancelled)).toEqual([true, false])
})

test('neo phone wake and neo phone pet act as the phone', async () => {
  const { dir, seen } = await running()
  await neo(dir, ['pet', 'sleep'])
  expect((await neo(dir, ['phone', 'wake'])).code).toBe(0)
  expect(await seen(e => e.type === 'wakeup')).toMatchObject({ dreamCancelled: true })
  expect((await neo(dir, ['phone', 'pet', '0.5', '0.5'])).code).toBe(0)
  expect(await seen(e => e.type === 'pet')).toMatchObject({ hunger: 0.5 })
})

test('saying "นีโอ ให้ปลาหน่อย" / "นีโอ หิวไหม" / "นีโอ ไปนอนได้แล้ว" (neo say) reaches the phone and never the Brain', async () => {
  const { dir, seen, asked } = await running()
  expect((await neo(dir, ['say', 'นีโอ ให้ปลาหน่อย'])).code).toBe(0)
  await seen(e => e.type === 'feed')
  await neo(dir, ['say', 'นีโอ หิวไหม'])
  await seen(e => e.type === 'pet_ask')
  await neo(dir, ['say', 'นีโอ ไปนอนได้แล้ว'])
  await seen(e => e.type === 'sleep')
  expect(asked).toEqual([])
  await golden('event-pet_ask', { type: 'pet_ask', at: 1_700_000_000_000 })
  await golden('event-sleep', { type: 'sleep', at: 1_700_000_000_000 })
})

test('neo name set, then the new name is the wake word; hello and pairing use it', async () => {
  const { dir, asked, seen, hello, base, clock } = await running()
  expect((hello as { name: string }).name).toBe('นีโอ')
  const set = await neo(dir, ['name', 'set', 'จอห์น', '--variants', 'จอน,ชอน', '--json'])
  expect(JSON.parse(set.stdout)).toEqual({ name: 'จอห์น', variants: ['จอห์น', 'จอน', 'ชอน'], training: null })
  await golden('name-show', { name: 'จอห์น', variants: ['จอห์น', 'จอน', 'ชอน'], training: null })
  expect(await seen(e => e.type === 'wake')).toMatchObject({ name: 'จอห์น', variants: ['จอห์น', 'จอน', 'ชอน'] })
  await golden('event-wake', { type: 'wake', at: 1_700_000_000_000, name: 'จอห์น', variants: ['จอห์น', 'จอน', 'ชอน'] })

  await neo(dir, ['say', 'ชอน ราคาทองวันนี้เท่าไหร่'])
  expect(asked).toEqual(['ราคาทองวันนี้เท่าไหร่'])
  clock.advance(60_000) // past the follow-up window
  const old = await neo(dir, ['say', 'นีโอ ราคาทองวันนี้เท่าไหร่'])
  expect(old.code).toBe(1) // not addressed any more
  expect((await (await fetch(`${base}/api/hello`)).json() as { name: string }).name).toBe('จอห์น')
  expect(JSON.parse((await neo(dir, ['name', '--json'])).stdout).name).toBe('จอห์น')
})

test('neo name train: the next three transcripts become the variants used by the wake word', async () => {
  const { dir, core, seen, lines } = await running()
  const started = await neo(dir, ['name', 'train', 'จอห์น', '--json'])
  expect(JSON.parse(started.stdout)).toMatchObject({ name: 'นีโอ', training: { name: 'จอห์น', got: [] } }) // the old name stays until training is done
  await golden('name-train', JSON.parse(started.stdout))
  expect(await seen(e => e.type === 'train')).toMatchObject({ name: 'จอห์น', n: 0 })
  await golden('event-train', { type: 'train', at: 1_700_000_000_000, name: 'จอห์น', n: 1, text: 'จอน' })

  // the three transcripts arrive as speech does: through the Ears' hear path
  for (const text of ['จอน', 'ชอน', 'จอห์น']) await core.transcript(text)
  await seen(e => e.type === 'wake')
  expect(lines.filter(e => e.type === 'train').map(e => e.type === 'train' && e.n)).toEqual([0, 1, 2, 3])
  expect(lines.some(e => e.type === 'heard')).toBe(false) // samples are not commands
  expect(JSON.parse((await neo(dir, ['name', '--json'])).stdout)).toEqual({ name: 'จอห์น', variants: ['จอห์น', 'จอน', 'ชอน'], training: null })
})

test('neo name train --cancel stops collecting; training with no name or a bad face colour exit 2 / 1', async () => {
  const { dir } = await running()
  await neo(dir, ['name', 'train', 'จอห์น'])
  const cancelled = await neo(dir, ['name', 'train', '--cancel', '--json'])
  expect(JSON.parse(cancelled.stdout)).toMatchObject({ training: null })
  expect((await neo(dir, ['name', 'train'])).code).toBe(2)
  expect((await neo(dir, ['name', 'set', '   '])).code).toBe(2)
})

test('neo face set --fg #ffffff recolours the phone live; hello carries the face; neo face shows it', async () => {
  const { dir, seen, hello, base } = await running()
  expect((hello as { face: unknown }).face).toEqual({ fg: '#7fffd4', accent: '#ff7aa8', cheek: '#ff9a9a', bg: '#000000' })
  const set = await neo(dir, ['face', 'set', '--fg', '#ffffff', '--json'])
  expect(set.code).toBe(0)
  const face = { fg: '#ffffff', accent: '#ff7aa8', cheek: '#ff9a9a', bg: '#000000' }
  expect(JSON.parse(set.stdout)).toEqual(face)
  await golden('face-show', face)
  expect(await seen(e => e.type === 'face')).toMatchObject(face)
  await golden('event-face', { type: 'face', at: 1_700_000_000_000, ...face })
  expect(JSON.parse((await neo(dir, ['face', '--json'])).stdout)).toEqual(face)
  expect(((await (await fetch(`${base}/api/hello`)).json()) as { face: unknown }).face).toEqual(face)
  const bad = await neo(dir, ['face', 'set', '--fg', 'white'])
  expect(bad.code).toBe(2)
})

test('neo events prints the new events as one line each', async () => {
  const { dir } = await running()
  const abort = new AbortController()
  const out: string[] = []
  const done = runCli(['events', '--home', dir], { out: t => void out.push(t), err() {}, env: {}, signal: abort.signal })
  cleanups.push(async () => { abort.abort(); await done })
  await Bun.sleep(50)
  await neo(dir, ['pet', 'feed', 'cookie'])
  await neo(dir, ['pet', 'sleep'])
  await neo(dir, ['face', 'set', '--bg', '#101010'])
  await neo(dir, ['name', 'set', 'จอห์น'])
  await Bun.sleep(100)
  const text = out.join('')
  for (const word of ['feed', 'sleep', 'face', 'wake']) expect(text).toContain(word)
})

export type { NeoEvent }
