// Cuts the phone's endless PCM into spoken segments (ported from app/voice.js Segmenter). No I/O.

export const RATE = 16_000
/** 100 ms of PCM s16le mono. */
export const FRAME = 1600
export const FRAME_BYTES = FRAME * 2
const PRE_ROLL = 6
const QUIET_END = 9
const MAX_FRAMES = 120
const MIN_VOICED = 3
const FLOOR_MIN = 0.0003
const FLOOR_START = 0.002
/** After the name or a tap: a pause of 3 s ends the command, at most 2 minutes. */
const LISTEN_QUIET = 30
const LISTEN_MAX = 1200
const PAUSE_FRAMES = 8
const LOUD_DELTA = 0.35
const LOUD_COOLDOWN_MS = 3000

export type SegmenterEvent =
  | { type: 'rec' }
  | { type: 'short' }
  | { type: 'loud' }
  | { type: 'segment'; frames: Int16Array[]; startedAt: number; listened: boolean; floor: number }

export function rms(frame: Int16Array) {
  let sum = 0
  for (const sample of frame) {
    const x = sample / 32768
    sum += x * x
  }
  return frame.length ? Math.sqrt(sum / frame.length) : 0
}

const isMuted = (frame: Int16Array) => frame.every(sample => sample === 0)

/** Thresholds follow the room's noise floor (the A7's raw mic has no AGC; speech can be as quiet as 0.005). */
export class Segmenter {
  floor = FLOOR_START
  listening = false
  #pre: Int16Array[] = []
  #seg: Int16Array[] | null = null
  #quiet = 0
  #voiced = 0
  #startedAt = 0
  #lastLoud = -1e12

  get recording() {
    return this.#seg !== null
  }

  /** Listen mode: the sentence in progress (or the next one) ends after 3 s of quiet instead of 0.9 s. */
  listen(on = true) {
    this.listening = on
  }

  feed(frame: Int16Array, now: number): SegmenterEvent[] {
    if (isMuted(frame)) { // the phone muted itself while Neo makes a sound
      this.#seg = null
      this.#pre = []
      this.#quiet = 0
      return []
    }
    const level = rms(frame)
    const events: SegmenterEvent[] = []
    if (level < this.floor * 2 + 0.0005) this.floor = Math.max(FLOOR_MIN, this.floor + (level - this.floor) * 0.05)
    if (level - this.floor > LOUD_DELTA && now - this.#lastLoud > LOUD_COOLDOWN_MS) {
      this.#lastLoud = now
      events.push({ type: 'loud' })
    }
    if (!this.#seg) {
      this.#pre.push(frame)
      if (this.#pre.length > PRE_ROLL) this.#pre.shift()
      if (level > this.floor * 3 + 0.002) {
        this.#seg = this.#pre
        this.#pre = []
        this.#quiet = 0
        this.#voiced = 1
        this.#startedAt = now
        events.push({ type: 'rec' })
      }
      return events
    }
    this.#seg.push(frame)
    if (level > this.floor * 2 + 0.001) {
      this.#quiet = 0
      this.#voiced++
    } else {
      this.#quiet++
    }
    const listened = this.listening
    if (this.#seg.length >= (listened ? LISTEN_MAX : MAX_FRAMES) || this.#quiet >= (listened ? LISTEN_QUIET : QUIET_END)) {
      const frames = listened ? this.#seg.slice(0, this.#seg.length - this.#quiet + QUIET_END) : this.#seg // trailing silence beyond 0.9 s is dropped
      const voiced = this.#voiced >= MIN_VOICED
      this.#seg = null
      this.#quiet = 0
      if (voiced) this.listening = false
      events.push(voiced ? { type: 'segment', frames, startedAt: this.#startedAt, listened, floor: this.floor } : { type: 'short' })
    }
    return events
  }
}

/** Splits a long command at pauses of 0.8 s or more (Apple's recogniser only returns the last part of a file with a long gap). */
export function splitPauses(frames: Int16Array[], floor: number) {
  const parts: Int16Array[][] = []
  let current: Int16Array[] = []
  let quiet = 0
  let voiced = 0
  const flush = () => {
    if (voiced >= MIN_VOICED) parts.push(current.slice(0, current.length - Math.max(0, quiet - 3)))
    current = []
    quiet = 0
    voiced = 0
  }
  for (const frame of frames) {
    const loud = rms(frame) > floor * 2 + 0.001
    if (loud && quiet >= PAUSE_FRAMES && current.length) flush()
    if (!loud && !current.length) continue // skip leading silence
    current.push(frame)
    if (loud) {
      quiet = 0
      voiced++
    } else {
      quiet++
    }
  }
  if (current.length) flush()
  return parts.length ? parts : [frames]
}

/** A 44-byte-header WAV of 16 kHz mono s16le. */
export function toWav(frames: Int16Array[]) {
  const samples = frames.reduce((n, f) => n + f.length, 0)
  const out = Buffer.alloc(44 + samples * 2)
  out.write('RIFF', 0)
  out.writeUInt32LE(36 + samples * 2, 4)
  out.write('WAVEfmt ', 8)
  out.writeUInt32LE(16, 16)
  out.writeUInt16LE(1, 20)
  out.writeUInt16LE(1, 22)
  out.writeUInt32LE(RATE, 24)
  out.writeUInt32LE(RATE * 2, 28)
  out.writeUInt16LE(2, 32)
  out.writeUInt16LE(16, 34)
  out.write('data', 36)
  out.writeUInt32LE(samples * 2, 40)
  let offset = 44
  for (const frame of frames) {
    for (const sample of frame) {
      out.writeInt16LE(sample, offset)
      offset += 2
    }
  }
  return new Uint8Array(out.buffer, out.byteOffset, out.length)
}
