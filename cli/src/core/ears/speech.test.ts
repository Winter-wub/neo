// Speech end to end inside the core: PCM in → Ears → Conversation → events out. Fake STT, fake Brain, fake clock.
import { afterEach, expect, test } from 'bun:test'
import { FakeClock, tempHome } from '../../../test/helpers'
import type { NeoEvent } from '../../protocol'
import type { Brain } from '../brain/brain'
import { textCard } from '../cards/cards'
import { createCore } from '../core'
import { FRAME } from './segmenter'

const cleanups: Array<() => Promise<unknown>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

const tone = (rms: number) => Int16Array.from({ length: FRAME }, (_, i) => Math.round((i % 2 ? 1 : -1) * rms * 32768))
const repeat = (frame: Int16Array, n: number) => Array.from({ length: n }, () => frame)
const pcm = (frames: Int16Array[]) => {
  const out = new Uint8Array(frames.length * FRAME * 2)
  const view = new DataView(out.buffer)
  frames.forEach((frame, f) => frame.forEach((sample, i) => view.setInt16((f * FRAME + i) * 2, sample, true)))
  return out
}
const sentence = () => pcm([...repeat(tone(0.0005), 8), ...repeat(tone(0.05), 8), ...repeat(tone(0.0005), 10)])

async function setup(settings: Record<string, boolean> = {}) {
  const { dir, cleanup } = await tempHome()
  cleanups.push(cleanup)
  const clock = new FakeClock()
  const said: string[] = []
  const asked: string[] = []
  const brain: Brain = {
    label: 'Fake',
    ask: async request => {
      asked.push(request.text)
      return { answer: { type: 'card', card: textCard({ title: request.text, lines: [request.text] }) }, session: 's1' }
    },
    runSkill: async () => ({ answer: { type: 'error', error: 'no' }, session: null }),
  }
  const core = await createCore({
    home: dir, clock, pid: 1, brain, audioDir: dir,
    stt: { transcribe: async () => said.shift() ?? '' },
  })
  if (Object.keys(settings).length) await core.settings.set(settings)
  const log: NeoEvent[] = []
  core.events.subscribe(e => log.push(e))
  const types = () => log.map(e => e.type).filter(type => type !== 'status' && type !== 'changed')
  /** The phone speaks one sentence (transcribed as `text`) and the turn is over. */
  async function speak(text: string) {
    said.push(text)
    const stream = core.ears.open()
    stream.push(sentence())
    stream.close()
    return stream.finished()
  }
  return { core, clock, log, types, speak, asked, said }
}

test('the name and a question: rec, stt, heard, thinking, a card', async () => {
  const t = await setup()
  const done = await t.speak('นีโอ ราคาทองวันนี้เท่าไหร่')
  expect(t.types()).toEqual(['rec', 'stt', 'heard', 'thinking', 'session', 'card'])
  expect(t.asked).toEqual(['ราคาทองวันนี้เท่าไหร่'])
  expect(done.outcome).toMatchObject({ outcome: 'card' })
})

test('without the name (requireName on) it is only heard; a tap then lets the next sentence through for 15 s', async () => {
  const t = await setup()
  await t.speak('ราคาทองวันนี้เท่าไหร่')
  expect(t.asked).toEqual([])
  expect(t.types()).toContain('heard')
  t.core.arm()
  await t.speak('ราคาทองวันนี้เท่าไหร่')
  expect(t.asked).toEqual(['ราคาทองวันนี้เท่าไหร่'])
})

test('the name alone arms the window: `armed`, then the next sentence is the question; 15 s of silence is `listen_end`', async () => {
  const t = await setup()
  await t.speak('นีโอ')
  expect(t.types()).toContain('armed')
  await t.speak('วันนี้วันอะไร')
  expect(t.asked).toEqual(['วันนี้วันอะไร'])

  const quiet = await setup()
  await quiet.speak('นีโอ')
  quiet.clock.advance(15_000)
  expect(quiet.types()).toContain('listen_end')
})

test('after a card, speech within 45 s needs no name; later it does', async () => {
  const t = await setup()
  await t.speak('นีโอ วันนี้วันอะไร')
  t.clock.advance(30_000)
  await t.speak('แล้วพรุ่งนี้ล่ะ')
  expect(t.asked).toHaveLength(2)
  t.clock.advance(46_000)
  await t.speak('แล้วมะรืนนี้ล่ะ')
  expect(t.asked).toHaveLength(2)
})

test('status.phone follows the open audio streams', async () => {
  const t = await setup()
  const stream = t.core.ears.open()
  expect(t.core.status().phone).toBe(true)
  stream.close()
  expect(t.core.status().phone).toBe(false)
})

test('STT failing is `stterr`; the daemon keeps listening', async () => {
  const { dir, cleanup } = await tempHome()
  cleanups.push(cleanup)
  const core = await createCore({
    home: dir, clock: new FakeClock(), pid: 1, audioDir: dir,
    brain: { label: 'Fake', ask: async () => ({ answer: { type: 'error', error: 'x' }, session: null }), runSkill: async () => ({ answer: { type: 'error', error: 'x' }, session: null }) },
    stt: { transcribe: async () => { throw new Error('ไม่มีตัวถอดเสียงไทยบนเครื่อง') } },
  })
  const log: NeoEvent[] = []
  core.events.subscribe(e => log.push(e))
  const stream = core.ears.open()
  stream.push(sentence())
  stream.close()
  const done = await stream.finished()
  expect(log.find(e => e.type === 'stterr')).toMatchObject({ error: 'ไม่มีตัวถอดเสียงไทยบนเครื่อง' })
  expect(done.outcome).toEqual({ outcome: 'stterr', error: 'ไม่มีตัวถอดเสียงไทยบนเครื่อง' })
})
