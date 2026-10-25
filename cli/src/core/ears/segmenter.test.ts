import { expect, test } from 'bun:test'
import { FRAME, Segmenter, splitPauses, toWav, type SegmenterEvent } from './segmenter'

/** One 100 ms frame of a constant-ish tone at roughly the given RMS (alternating sign keeps it non-zero). */
const tone = (rms: number) => Int16Array.from({ length: FRAME }, (_, i) => Math.round((i % 2 ? 1 : -1) * rms * 32768))
const QUIET = tone(0.0005)
const VOICE = tone(0.05)
const LOUD = tone(0.6)

function feedAll(seg: Segmenter, frames: Int16Array[], start = 0) {
  const events: SegmenterEvent[] = []
  frames.forEach((f, i) => events.push(...seg.feed(f, start + i * 100)))
  return events
}
const types = (events: SegmenterEvent[]) => events.map(e => e.type)
const repeat = (frame: Int16Array, n: number) => Array.from({ length: n }, () => frame)

test('speech then 0.9 s of quiet is one segment: rec, then segment with the quiet before it as pre-roll', () => {
  const seg = new Segmenter()
  const events = feedAll(seg, [...repeat(QUIET, 10), ...repeat(VOICE, 8), ...repeat(QUIET, 9)])
  expect(types(events)).toEqual(['rec', 'segment'])
  const segment = events[1] as Extract<SegmenterEvent, { type: 'segment' }>
  expect(segment.frames.length).toBe(5 + 8 + 9)
  expect(segment.listened).toBe(false)
})

test('under 0.3 s of voice is `short`, not a segment', () => {
  const seg = new Segmenter()
  const events = feedAll(seg, [...repeat(QUIET, 8), ...repeat(VOICE, 2), ...repeat(QUIET, 9)])
  expect(types(events)).toEqual(['rec', 'short'])
})

test('an all-zero frame (the phone is muted) throws away the segment in progress', () => {
  const seg = new Segmenter()
  const zero = new Int16Array(FRAME)
  const events = feedAll(seg, [...repeat(QUIET, 8), ...repeat(VOICE, 5), zero, ...repeat(QUIET, 12)])
  expect(types(events)).toEqual(['rec'])
  expect(seg.recording).toBe(false)
})

test('a segment is cut at 12 s even if the voice never stops', () => {
  const seg = new Segmenter()
  const events = feedAll(seg, [...repeat(QUIET, 8), ...repeat(VOICE, 130)])
  expect(types(events).slice(0, 2)).toEqual(['rec', 'segment'])
})

test('loud spikes emit `loud` at most once per 3 s', () => {
  const seg = new Segmenter()
  const events = feedAll(seg, [QUIET, LOUD, LOUD, ...repeat(QUIET, 3), LOUD])
  expect(types(events).filter(t => t === 'loud')).toHaveLength(1)
  expect(types(feedAll(new Segmenter(), [QUIET, LOUD, ...repeat(QUIET, 40), LOUD])).filter(t => t === 'loud')).toHaveLength(2)
})

test('listen mode waits 3 s of quiet, trims the tail to 0.9 s, and ends listen mode', () => {
  const seg = new Segmenter()
  seg.listen()
  const events = feedAll(seg, [...repeat(QUIET, 8), ...repeat(VOICE, 5), ...repeat(QUIET, 12), ...repeat(VOICE, 5), ...repeat(QUIET, 30)])
  expect(types(events)).toEqual(['rec', 'segment'])
  const segment = events[1] as Extract<SegmenterEvent, { type: 'segment' }>
  expect(segment.listened).toBe(true)
  expect(segment.frames.length).toBe(5 + 5 + 12 + 5 + 9)
  expect(seg.listening).toBe(false)
})

test('splitPauses splits a long command at pauses of 0.8 s or more', () => {
  const frames = [...repeat(VOICE, 5), ...repeat(QUIET, 10), ...repeat(VOICE, 5)]
  const parts = splitPauses(frames, 0.002)
  expect(parts).toHaveLength(2)
  expect(parts.every(p => p.length >= 5)).toBe(true)
  expect(splitPauses(repeat(VOICE, 6), 0.002)).toHaveLength(1)
})

test('toWav writes a 44-byte header for 16 kHz mono s16le', () => {
  const wav = toWav([Int16Array.from([1, -2, 3])])
  expect(wav.length).toBe(44 + 6)
  expect(Buffer.from(wav.subarray(0, 4)).toString()).toBe('RIFF')
  expect(Buffer.from(wav).readUInt32LE(24)).toBe(16000)
  expect(Buffer.from(wav).readInt16LE(48)).toBe(3)
})
