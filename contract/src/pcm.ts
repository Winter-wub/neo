/** Raw PCM the way NeoApp sends it: signed 16-bit little-endian, 16 kHz, mono, 100 ms (1600 samples) per frame. */
export const FRAME = 1600
export const FRAME_BYTES = FRAME * 2

const toBytes = (samples: Int16Array) => Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength)

const frames = (count: number, sample: (i: number) => number) =>
  Array.from({ length: count }, (_, f) => toBytes(Int16Array.from({ length: FRAME }, (_, i) => sample(f * FRAME + i))))

/** Speech-like: a 440 Hz tone, well above the noise floor but not a spike. */
export const voiced = (count: number, amplitude = 6000) =>
  frames(count, (i) => Math.round(amplitude * Math.sin((2 * Math.PI * 440 * i) / 16000)))

/** Room noise: tiny non-zero samples (an all-zero frame would mean "muted"). */
export const quiet = (count: number) =>
  frames(count, (i) => ((i * 7919) % 9) - 4 || 1)

/** All-zero frames: NeoApp's "I am playing a sound" mute marker. */
export const muted = (count: number) => frames(count, () => 0)

/** A spike: a full-scale square wave. */
export const loud = (count: number) => frames(count, (i) => (Math.floor(i / 20) % 2 ? 30000 : -30000))

export const join = (...parts: Buffer[][]) => parts.flat()

/** Re-chop frames into chunks of an arbitrary size, to prove the backend re-frames across chunk boundaries. */
export function rechunk(parts: Buffer[], size: number) {
  const all = Buffer.concat(parts)
  const out: Buffer[] = []
  for (let at = 0; at < all.length; at += size) out.push(all.subarray(at, at + size))
  return out
}

/** One spoken phrase: some voiced frames then enough quiet to end the segment (0.9 s). */
export const phrase = (voicedFrames = 6, quietFrames = 11) => [...voiced(voicedFrames), ...quiet(quietFrames)]

export interface WavInfo {
  riff: boolean
  channels: number
  sampleRate: number
  bitsPerSample: number
  dataBytes: number
}

export function readWav(wav: Uint8Array): WavInfo {
  const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength)
  const tag = (at: number) => String.fromCharCode(...wav.subarray(at, at + 4))
  return {
    riff: tag(0) === 'RIFF' && tag(8) === 'WAVE',
    channels: view.getUint16(22, true),
    sampleRate: view.getUint32(24, true),
    bitsPerSample: view.getUint16(34, true),
    dataBytes: view.getUint32(40, true),
  }
}
