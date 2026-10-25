import { afterEach, expect, test } from 'bun:test'
import { readdir } from 'node:fs/promises'
import { FakeClock, tempHome } from '../../../test/helpers'
import type { NeoEvent } from '../../protocol'
import type { Outcome } from '../conversation/conversation'
import { createEvents } from '../events/events'
import { createEars, type EarsDeps } from './ears'
import { FRAME } from './segmenter'
import type { Stt } from './stt'

const cleanups: Array<() => Promise<unknown>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

// ---- audio: 100 ms frames; alternating sign keeps every sample non-zero ----
const tone = (rms: number) => Int16Array.from({ length: FRAME }, (_, i) => Math.round((i % 2 ? 1 : -1) * rms * 32768))
const bytes = (frames: Int16Array[]) => {
  const out = new Uint8Array(frames.length * FRAME * 2)
  const view = new DataView(out.buffer)
  frames.forEach((frame, f) => frame.forEach((sample, i) => view.setInt16((f * FRAME + i) * 2, sample, true)))
  return out
}
const repeat = (frame: Int16Array, n: number) => Array.from({ length: n }, () => frame)
const QUIET = tone(0.0005)
const VOICE = tone(0.05)
/** A spoken sentence: a little room tone, 0.8 s of voice, then the 0.9 s of quiet that ends it. */
const sentence = () => bytes([...repeat(QUIET, 8), ...repeat(VOICE, 8), ...repeat(QUIET, 10)])
const muted = () => bytes(repeat(new Int16Array(FRAME), 12))

/** An STT the test controls: every call waits until the test answers it (or answers at once with `auto`). */
function fakeStt(auto?: (call: number) => string | Error) {
  const calls: Array<{ wav: string; hints: string[]; answer(text: string): void; fail(error: Error): void }> = []
  const stt: Stt = {
    transcribe: (wav, hints) => {
      const n = calls.length
      if (auto) {
        calls.push({ wav, hints, answer: () => {}, fail: () => {} })
        const r = auto(n)
        return r instanceof Error ? Promise.reject(r) : Promise.resolve(r)
      }
      return new Promise<string>((resolve, reject) => calls.push({ wav, hints, answer: resolve, fail: reject }))
    },
  }
  return { stt, calls }
}

async function setup(over: Partial<EarsDeps> & { auto?: (call: number) => string | Error } = {}) {
  const { dir, cleanup } = await tempHome()
  cleanups.push(cleanup)
  const clock = new FakeClock()
  const events = createEvents({ clock })
  const log: NeoEvent[] = []
  events.subscribe(e => log.push(e))
  const { stt, calls } = fakeStt(over.auto)
  const heard: Array<{ text: string; startedAt: number }> = []
  const streamCounts: number[] = []
  let busy = false
  const ears = createEars({
    events, clock, stt, audioDir: dir,
    hints: () => ['นีโอ', 'neo'],
    hear: async (text, startedAt) => {
      heard.push({ text, startedAt })
      return { outcome: 'heard', armed: false } satisfies Outcome
    },
    busy: () => busy,
    onStreams: n => void streamCounts.push(n),
    ...over,
  })
  const types = () => log.map(e => e.type)
  return { ears, clock, log, types, calls, heard, streamCounts, dir, setBusy: (b: boolean) => (busy = b) }
}
const tick = () => Bun.sleep(5)
async function until(check: () => boolean, ms = 1000) {
  for (let t = 0; t < ms && !check(); t += 5) await Bun.sleep(5)
  if (!check()) throw new Error('condition not reached')
}

test('a spoken sentence: rec, stt, then the words go to Conversation with the time speech started', async () => {
  const t = await setup({ auto: () => 'นีโอ วันนี้วันอะไร' })
  const stream = t.ears.open()
  const start = t.clock.now()
  stream.push(sentence())
  stream.close()
  await stream.finished()
  expect(t.types()).toEqual(['rec', 'stt'])
  expect(t.heard).toEqual([{ text: 'นีโอ วันนี้วันอะไร', startedAt: start }])
  expect(t.calls[0]!.hints).toEqual(['นีโอ', 'neo'])
})

test('chunks may cut a frame anywhere: the same audio gives the same segment', async () => {
  const t = await setup({ auto: () => 'พูดอะไรสักอย่าง' })
  const stream = t.ears.open()
  const all = sentence()
  for (let at = 0; at < all.length; at += 777) stream.push(all.subarray(at, at + 777))
  stream.close()
  await stream.finished()
  expect(t.heard.map(h => h.text)).toEqual(['พูดอะไรสักอย่าง'])
})

test('muted (all-zero) audio makes no events and no transcription', async () => {
  const t = await setup({ auto: () => 'x' })
  const stream = t.ears.open()
  stream.push(muted())
  stream.close()
  await stream.finished()
  expect(t.types()).toEqual([])
  expect(t.calls).toHaveLength(0)
})

test('too little voice is `short`, with no transcription', async () => {
  const t = await setup({ auto: () => 'x' })
  const stream = t.ears.open()
  stream.push(bytes([...repeat(QUIET, 8), ...repeat(VOICE, 2), ...repeat(QUIET, 10)]))
  stream.close()
  await stream.finished()
  expect(t.types()).toEqual(['rec', 'short'])
  expect(t.calls).toHaveLength(0)
})

test('an empty or one-letter transcript is `nothing` and is not passed on', async () => {
  const t = await setup({ auto: n => (n === 0 ? '' : 'ก') })
  const stream = t.ears.open()
  stream.push(sentence())
  stream.push(sentence())
  stream.close()
  await stream.finished()
  expect(t.types().filter(x => x === 'nothing')).toHaveLength(2)
  expect(t.heard).toEqual([])
})

test('a failing STT is `stterr` with the message, and the next sentence still works', async () => {
  const t = await setup({ auto: n => (n === 0 ? new Error('neo-stt หยุดทำงานกลางคัน') : 'นีโอ สวัสดี') })
  const stream = t.ears.open()
  stream.push(sentence())
  stream.push(sentence())
  stream.close()
  const done = await stream.finished()
  expect(t.log.find(e => e.type === 'stterr')).toMatchObject({ error: 'neo-stt หยุดทำงานกลางคัน' })
  expect(t.heard.map(h => h.text)).toEqual(['นีโอ สวัสดี'])
  expect(done.transcripts).toEqual(['นีโอ สวัสดี'])
})

test('while one segment is being transcribed only the latest waiting one is kept', async () => {
  const t = await setup()
  const stream = t.ears.open()
  stream.push(sentence())
  await until(() => t.calls.length === 1)
  stream.push(sentence()) // second: waits
  stream.push(sentence()) // third: replaces the second
  stream.push(sentence()) // fourth: replaces the third
  stream.close()
  t.calls[0]!.answer('อันแรก')
  await until(() => t.calls.length === 2)
  t.calls[1]!.answer('อันสุดท้าย')
  await stream.finished()
  expect(t.calls).toHaveLength(2)
  expect(t.heard.map(h => h.text)).toEqual(['อันแรก', 'อันสุดท้าย'])
})

test('the number of open audio streams is reported as streams open and close', async () => {
  const t = await setup({ auto: () => 'x' })
  const a = t.ears.open()
  const b = t.ears.open()
  a.close()
  b.close()
  expect(t.streamCounts).toEqual([1, 2, 1, 0])
  expect(t.ears.streams()).toBe(0)
})

test('listen mode: a 1.5 s pause does not end the sentence; 3 s does', async () => {
  const t = await setup({ auto: () => 'นีโอ ขอเวลาคิดแป๊บ' })
  const stream = t.ears.open()
  t.ears.listen()
  stream.push(bytes([...repeat(QUIET, 8), ...repeat(VOICE, 6), ...repeat(QUIET, 15), ...repeat(VOICE, 6)]))
  await tick()
  expect(t.calls).toHaveLength(0)
  stream.push(bytes(repeat(QUIET, 30)))
  stream.close()
  await stream.finished()
  expect(t.types().filter(x => x === 'stt')).toHaveLength(1) // one sentence (its two halves are transcribed separately)
  expect(t.heard).toHaveLength(1)
})

test('a long command is split at pauses of 0.8 s or more, transcribed in parts and joined with spaces', async () => {
  const t = await setup({ auto: n => `ท่อน${n + 1}` })
  const stream = t.ears.open()
  t.ears.listen()
  stream.push(bytes([...repeat(QUIET, 8), ...repeat(VOICE, 6), ...repeat(QUIET, 12), ...repeat(VOICE, 6), ...repeat(QUIET, 30)]))
  stream.close()
  const done = await stream.finished()
  expect(t.calls).toHaveLength(2)
  expect(t.heard.map(h => h.text)).toEqual(['ท่อน1 ท่อน2'])
  expect(done.transcripts).toEqual(['ท่อน1 ท่อน2'])
})

test('listen mode ends with `listen_end` after 15 s of silence, unless Neo is busy', async () => {
  const t = await setup({ auto: () => 'x' })
  t.ears.open()
  t.ears.listen()
  t.clock.advance(14_000)
  expect(t.types()).not.toContain('listen_end')
  t.clock.advance(1000)
  expect(t.types()).toEqual(['listen_end'])

  const busy = await setup({ auto: () => 'x' })
  busy.ears.open()
  busy.ears.listen()
  busy.setBusy(true)
  busy.clock.advance(15_000)
  expect(busy.types()).toEqual([])
})

test('when the listened sentence ends before the 15 s are up there is no `listen_end`', async () => {
  const t = await setup({ auto: () => 'นีโอ ทดสอบ' })
  const stream = t.ears.open()
  t.ears.listen()
  stream.push(bytes([...repeat(QUIET, 8), ...repeat(VOICE, 6), ...repeat(QUIET, 30)]))
  stream.close()
  await stream.finished()
  t.clock.advance(20_000)
  expect(t.types()).not.toContain('listen_end')
})

test('the debug WAV files are rotated: at most 10 are kept', async () => {
  const t = await setup({ auto: () => 'พูดอะไรสักอย่าง' })
  const stream = t.ears.open()
  for (let i = 0; i < 14; i++) {
    stream.push(sentence())
    await until(() => t.calls.length === i + 1)
  }
  stream.close()
  await stream.finished()
  expect((await readdir(t.dir)).filter(f => f.endsWith('.wav')).length).toBeLessThanOrEqual(10)
})

test('a Conversation failure does not break the audio loop', async () => {
  const t = await setup({ auto: () => 'นีโอ ทดสอบ', hear: async () => { throw new Error('boom') } })
  const stream = t.ears.open()
  stream.push(sentence())
  stream.close()
  await stream.finished()
  expect(t.types()).toContain('stt')
})
