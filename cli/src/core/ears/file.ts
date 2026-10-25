import { FRAME_BYTES, RATE } from './segmenter'
import type { Ears } from './ears'

export class WavError extends Error {}

const HOW = 'แปลงด้วย: ffmpeg -i เข้า.m4a -ar 16000 -ac 1 -c:a pcm_s16le ออก.wav'
/** The room tone after the words: long enough to end a sentence even in listen mode (3 s). */
const TAIL_FRAMES = 35

/** The PCM bytes of a 16 kHz mono 16-bit WAV. */
export function parseWav(wav: Uint8Array): Uint8Array {
  const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength)
  const tag = (at: number) => String.fromCharCode(...wav.subarray(at, at + 4))
  if (wav.length < 12 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new WavError(`ไม่ใช่ไฟล์ WAV\n${HOW}`)
  let format: { channels: number; rate: number; bits: number; pcm: boolean } | null = null
  for (let at = 12; at + 8 <= wav.length;) {
    const size = view.getUint32(at + 4, true)
    const body = at + 8
    if (tag(at) === 'fmt ') {
      format = { pcm: view.getUint16(body, true) === 1, channels: view.getUint16(body + 2, true), rate: view.getUint32(body + 4, true), bits: view.getUint16(body + 14, true) }
    } else if (tag(at) === 'data') {
      if (!format) throw new WavError('WAV ไม่มี fmt ก่อน data')
      if (!format.pcm || format.bits !== 16 || format.channels !== 1) throw new WavError(`ต้องเป็น WAV mono 16-bit PCM\n${HOW}`)
      if (format.rate !== RATE) throw new WavError(`ต้องเป็น ${RATE} Hz (ไฟล์นี้ ${format.rate})\n${HOW}`)
      return wav.subarray(body, Math.min(body + size, wav.length))
    }
    at = body + size + (size % 2)
  }
  throw new WavError('WAV ไม่มีข้อมูลเสียง')
}

/** Plays a WAV into Ears as if a phone had spoken it, then waits for everything it said to be handled. */
export async function listenToWav(ears: Ears, wav: Uint8Array) {
  const pcm = parseWav(wav)
  const stream = ears.open()
  stream.push(pcm)
  // a real mic never stops: the file's end is followed by room tone (never all-zero, which means "muted")
  const tail = new Uint8Array(TAIL_FRAMES * FRAME_BYTES)
  const view = new DataView(tail.buffer)
  for (let i = 0; i < tail.length / 2; i++) view.setInt16(i * 2, i % 2 ? 1 : -1, true)
  stream.push(tail)
  stream.close()
  return stream.finished()
}
