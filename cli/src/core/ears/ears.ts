import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Clock } from '../clock'
import type { Outcome } from '../conversation/conversation'
import type { Events } from '../events/events'
import { FRAME, FRAME_BYTES, Segmenter, splitPauses, toWav } from './segmenter'
import type { Stt } from './stt'

/** After the name or a tap the phone has this long to start speaking. */
export const LISTEN_WINDOW_MS = 15_000
/** Debug WAVs kept on disk. */
const KEEP_WAVS = 10
const MIN_TEXT_CHARS = 2

export interface EarsDeps {
  events: Events
  clock: Clock
  stt: Stt
  /** Where the segments' WAV files go (rotating). */
  audioDir: string
  /** Words the recogniser should favour: the pet's name and its spellings. */
  hints(): string[]
  /** What was said. Resolves when that turn is over. */
  hear(text: string, startedAt: number): Promise<Outcome>
  /** True while Neo is thinking: no `listen_end` then. */
  busy(): boolean
  /** Number of open audio streams, each time it changes. */
  onStreams?(count: number): void
}

/** What one stream's audio turned into, once everything it produced was processed. */
export interface StreamReport {
  /** One entry per segment that had words. */
  transcripts: string[]
  /** How the last transcript was handled, or why there was none. */
  outcome: Outcome | { outcome: 'nothing' } | { outcome: 'stterr'; error: string } | null
}

interface Job {
  frames: Int16Array[]
  startedAt: number
  /** Set when the segment was spoken in listen mode: it is split at pauses before transcribing. */
  floor: number | null
  report: StreamReport
  /** Called once the segment is dropped or its turn is over. */
  done(): void
}

const readFrame = (bytes: Uint8Array) => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, FRAME_BYTES)
  return Int16Array.from({ length: FRAME }, (_, i) => view.getInt16(i * 2, true))
}

/** The phone's microphone: PCM in, events and transcripts out. */
export function createEars(deps: EarsDeps) {
  const { events, clock, stt } = deps
  const live = new Set<Segmenter>()
  let working = false
  let waiting: Job | null = null
  let wavCounter = 0
  let cancelListenTimer: (() => void) | null = null

  const stopListenTimer = () => {
    cancelListenTimer?.()
    cancelListenTimer = null
  }

  /** After the name alone or a tap: sentences end after 3 s of quiet; nothing said within the window ends it. */
  function listen() {
    for (const seg of live) seg.listen(true)
    stopListenTimer()
    cancelListenTimer = clock.every(LISTEN_WINDOW_MS, () => {
      stopListenTimer()
      for (const seg of live) if (!seg.recording) seg.listen(false)
      if (!deps.busy()) events.publish({ type: 'listen_end' })
    })
  }

  async function transcribePart(frames: Int16Array[]) {
    const file = join(deps.audioDir, `seg${wavCounter++ % KEEP_WAVS}.wav`)
    await mkdir(deps.audioDir, { recursive: true })
    await writeFile(file, toWav(frames))
    return stt.transcribe(file, deps.hints())
  }

  /** Transcribes one segment. Returns the Conversation turn it started, if any; the queue does not wait for it. */
  async function transcribe(job: Job): Promise<{ turn: Promise<unknown> | null }> {
    events.publish({ type: 'stt' })
    try {
      const parts = job.floor == null ? [job.frames] : splitPauses(job.frames, job.floor)
      const texts: string[] = []
      for (const part of parts) texts.push((await transcribePart(part)).trim())
      const text = texts.filter(Boolean).join(' ')
      if (text.length < MIN_TEXT_CHARS) {
        events.publish({ type: 'nothing' })
        job.report.outcome = { outcome: 'nothing' }
        return { turn: null }
      }
      job.report.transcripts.push(text)
      const turn = deps.hear(text, job.startedAt).then(
        outcome => void (job.report.outcome = outcome),
        e => void console.error('hear failed:', e),
      )
      return { turn }
    } catch (e) {
      const error = (e as Error).message ?? String(e)
      events.publish({ type: 'stterr', error })
      job.report.outcome = { outcome: 'stterr', error }
      return { turn: null }
    }
  }

  async function run(job: Job) {
    working = true
    const { turn } = await transcribe(job)
    working = false
    const next = waiting
    waiting = null
    if (next) void run(next)
    void (turn ?? Promise.resolve()).finally(job.done)
  }

  /** One at a time; while busy only the latest waiting segment is kept. */
  function enqueue(job: Job) {
    if (!working) return void run(job)
    waiting?.done()
    waiting = job
  }

  return {
    listen,
    streams: () => live.size,
    /** One audio upload (a phone's endless POST body, or a file fed by `neo phone audio`). */
    open() {
      const seg = new Segmenter()
      const report: StreamReport = { transcripts: [], outcome: null }
      let rest: Uint8Array = new Uint8Array(0)
      let inflight = 0
      let closed = false
      let waiters: Array<(report: StreamReport) => void> = []
      live.add(seg)
      deps.onStreams?.(live.size)

      const settle = () => {
        if (!closed || inflight > 0) return
        for (const resolve of waiters.splice(0)) resolve(report)
      }

      return {
        push(chunk: Uint8Array) {
          if (closed) return
          if (rest.length) {
            const joined = new Uint8Array(rest.length + chunk.length)
            joined.set(rest)
            joined.set(chunk, rest.length)
            rest = joined
          } else {
            rest = chunk
          }
          while (rest.length >= FRAME_BYTES) {
            const frame = readFrame(rest)
            rest = rest.subarray(FRAME_BYTES)
            for (const event of seg.feed(frame, clock.now())) {
              if (event.type !== 'segment') {
                events.publish({ type: event.type })
                continue
              }
              if (event.listened) stopListenTimer()
              inflight++
              enqueue({
                frames: event.frames,
                startedAt: event.startedAt,
                floor: event.listened ? event.floor : null,
                report,
                done: () => {
                  inflight--
                  settle()
                },
              })
            }
          }
        },
        close() {
          if (closed) return
          closed = true
          live.delete(seg)
          deps.onStreams?.(live.size)
          settle()
        },
        /** Resolves once the stream is closed and everything it said has been processed. */
        finished: () => new Promise<StreamReport>(resolve => {
          waiters.push(resolve)
          settle()
        }),
      }
    },
  }
}

export type Ears = ReturnType<typeof createEars>
