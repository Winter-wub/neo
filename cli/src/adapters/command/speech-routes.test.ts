import { afterEach, expect, test } from 'bun:test'
import { FakeClock, golden, tempHome } from '../../../test/helpers'
import { createCore } from '../../core/core'
import { textCard } from '../../core/cards/cards'
import { FRAME, toWav } from '../../core/ears/segmenter'
import { CommandFailed, connect } from './client'
import { startCommandServer } from './server'

const cleanups: Array<() => Promise<unknown>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

const tone = (rms: number) => Int16Array.from({ length: FRAME }, (_, i) => Math.round((i % 2 ? 1 : -1) * rms * 32768))
const repeat = (frame: Int16Array, n: number) => Array.from({ length: n }, () => frame)
const speechWav = () => toWav([...repeat(tone(0.0005), 4), ...repeat(tone(0.05), 8)])

async function setup(heard = 'นีโอ วันนี้วันอะไร', doctor: object = { check: async () => ({ status: 'authorized', onDevice: true }), authorize: async () => ({ status: 'authorized', onDevice: true }) }) {
  const { dir, cleanup } = await tempHome()
  const clock = new FakeClock()
  const core = await createCore({
    home: dir, clock, pid: 1, audioDir: dir,
    brain: {
      label: 'Fake',
      ask: async r => ({ answer: { type: 'card', card: textCard({ title: r.text, lines: ['คำตอบ'] }) }, session: 's' }),
      runSkill: async () => ({ answer: { type: 'error', error: 'no' }, session: null }),
    },
    stt: { transcribe: async () => heard, ...doctor },
  })
  const server = await startCommandServer({ core, clock, home: dir })
  cleanups.push(cleanup, () => server.stop())
  return { daemon: connect(dir), core }
}

test('POST /phone/audio plays a WAV as a phone would and answers with the transcript and the card', async () => {
  const { daemon } = await setup()
  const result = await daemon.upload('POST /phone/audio', speechWav())
  expect(result).toMatchObject({ transcripts: ['นีโอ วันนี้วันอะไร'], outcome: { outcome: 'card', card: { title: 'วันนี้วันอะไร' } } })
  await golden('phone-audio', result)
})

test('audio that is not addressed to Neo is reported as heard, and silence as nothing', async () => {
  const unaddressed = await setup('ราคาทองวันนี้เท่าไหร่')
  expect((await unaddressed.daemon.upload('POST /phone/audio', speechWav())).outcome).toEqual({ outcome: 'heard', armed: false })
  const silent = await setup('')
  const result = await silent.daemon.upload('POST /phone/audio', speechWav())
  expect(result).toEqual({ transcripts: [], outcome: { outcome: 'nothing' } })
  await golden('phone-audio-nothing', result)
})

test('an STT failure comes back as stterr', async () => {
  const { daemon } = await setup()
  const { dir, cleanup } = await tempHome()
  cleanups.push(cleanup)
  const core = await createCore({ home: dir, clock: new FakeClock(), pid: 1, audioDir: dir, stt: { transcribe: async () => { throw new Error('neo-stt หยุดทำงานกลางคัน') } } })
  const server = await startCommandServer({ core, clock: new FakeClock(), home: dir })
  cleanups.push(() => server.stop())
  const result = await connect(dir).upload('POST /phone/audio', speechWav())
  expect(result.outcome).toEqual({ outcome: 'stterr', error: 'neo-stt หยุดทำงานกลางคัน' })
  await golden('phone-audio-stterr', result)
  void daemon
})

test('a file that is not 16 kHz mono 16-bit WAV is a 400 that says how to convert it', async () => {
  const { daemon } = await setup()
  await expect(daemon.upload('POST /phone/audio', new Uint8Array([1, 2, 3]))).rejects.toThrow(CommandFailed)
  await expect(daemon.upload('POST /phone/audio', new Uint8Array([1, 2, 3]))).rejects.toThrow('ffmpeg')
})

test('GET /doctor lists the stt row; POST /doctor/fix stt asks for the permission', async () => {
  const { daemon } = await setup('x', { check: async () => ({ status: 'notDetermined', onDevice: true }), authorize: async () => ({ status: 'authorized', onDevice: true }) })
  const rows = await daemon.call('GET /doctor')
  expect(rows.find(row => row.id === 'stt')).toEqual({ id: 'stt', ok: false, label: expect.any(String), detail: expect.any(String), fix: 'neo doctor --fix stt' })
  await golden('doctor-stt-row', rows.find(row => row.id === 'stt'))
  const fixed = await daemon.call('POST /doctor/fix', { id: 'stt' })
  expect(fixed.ok).toBe(true)
  await golden('doctor-fix', fixed)
  await expect(daemon.call('POST /doctor/fix', { id: 'nope' })).rejects.toThrow(CommandFailed)
})
