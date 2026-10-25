import { afterEach, expect, test } from 'bun:test'
import { FakeClock, tempHome } from '../../../test/helpers'
import { createEvents } from '../events/events'
import { createEars } from './ears'
import { WavError, listenToWav, parseWav } from './file'
import { FRAME, toWav } from './segmenter'

const cleanups: Array<() => Promise<unknown>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

const tone = (rms: number) => Int16Array.from({ length: FRAME }, (_, i) => Math.round((i % 2 ? 1 : -1) * rms * 32768))
const repeat = (frame: Int16Array, n: number) => Array.from({ length: n }, () => frame)

test('parseWav returns the PCM of a 16 kHz mono 16-bit file and skips extra chunks', () => {
  const plain = toWav([Int16Array.from([5, -6])])
  expect(Array.from(parseWav(plain))).toEqual([5, 0, 250, 255]) // 5, -6 little endian
  const withList = Buffer.concat([plain.subarray(0, 36), Buffer.from('LIST\x04\x00\x00\x00abcd', 'latin1'), plain.subarray(36)])
  expect(parseWav(new Uint8Array(withList)).length).toBe(4)
})

test('anything else is refused with a Thai message that says how to convert', () => {
  expect(() => parseWav(new Uint8Array([1, 2, 3]))).toThrow(WavError)
  const stereo = Buffer.from(toWav([Int16Array.from([1, 2])]))
  stereo.writeUInt16LE(2, 22)
  expect(() => parseWav(new Uint8Array(stereo))).toThrow('ffmpeg')
  const rate = Buffer.from(toWav([Int16Array.from([1, 2])]))
  rate.writeUInt32LE(44100, 24)
  expect(() => parseWav(new Uint8Array(rate))).toThrow('16000')
})

test('a file that ends right after the speech still yields a finished sentence', async () => {
  const { dir, cleanup } = await tempHome()
  cleanups.push(cleanup)
  const clock = new FakeClock()
  const events = createEvents({ clock })
  const types: string[] = []
  events.subscribe(e => types.push(e.type))
  const ears = createEars({
    events, clock, audioDir: dir, hints: () => [], busy: () => false,
    stt: { transcribe: async () => 'นีโอ ทดสอบ' },
    hear: async () => ({ outcome: 'heard', armed: false }),
  })
  const wav = toWav([...repeat(tone(0.0005), 3), ...repeat(tone(0.05), 8)]) // no quiet at the end
  const report = await listenToWav(ears, wav)
  expect(report.transcripts).toEqual(['นีโอ ทดสอบ'])
  expect(types).toEqual(['rec', 'stt'])
})
