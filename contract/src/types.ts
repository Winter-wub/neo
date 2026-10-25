/** One speech-to-text request the backend made (what the fake STT saw). */
export interface SttCall {
  wav: Uint8Array
  hints: string[]
}

/** Test-side control of speech-to-text. The driver wires it to however the backend reaches STT. */
export interface SttControl {
  readonly calls: SttCall[]
  /** The next unanswered STT request gets this text. Queued in order; once the queue is empty the answer is ''. */
  reply(text: string): void
  /** The next unanswered STT request fails with this message. */
  fail(message: string): void
  /** Hold every STT answer until the returned function is called. */
  hold(): () => void
}

export interface ClaudeCall {
  event: 'call'
  pid: number
  argv: string[]
  prompt: string
  session: string
}

export interface ClaudeLogEntry {
  event: 'call' | 'sigterm'
  pid: number
  argv?: string[]
  prompt?: string
  session?: string
}

/** A backend that is up and listening on the phone port. */
export interface Backend {
  readonly baseUrl: string
  /** NEO_HOME of this backend (a temp dir). */
  readonly home: string
  /** Headers every phone request carries besides the Authorization header. */
  readonly phoneHeaders: Record<string, string>
  /** Bytes served at /neo.apk, when the driver planted a known APK. */
  readonly apk?: Uint8Array
  readonly stt: SttControl
  /** A fresh 6-digit pairing code (old backend: POST /api/pair/start; NeoCli: `neo devices pair --json`). */
  getPairingCode(): Promise<string>
  /** Type a sentence to Neo on the Mac instead of speaking it into a phone (NeoCli: `neo say`), when the backend has such a path. */
  say?(text: string): Promise<void>
  /** Make an alarm ring right now (old backend: add one-off job + fire it). */
  ringAlarm(): Promise<{ id: string; title: string }>
  /** Run one dream to completion with the fake claude, leaving its card undelivered. */
  makeDream(): Promise<void>
  /** Every call the fake claude received (and SIGTERMs it got). */
  claudeLog(): Promise<ClaudeLogEntry[]>
  stop(): Promise<void>
}

/**
 * Places where the amended contract (spec §4.1) differs from this backend. A test tagged with one of
 * these is expected to fail on a driver that lists it, and to pass on a driver that does not.
 */
export type Divergence =
  /** Localhost has special rights: no token needed for phone routes (amended: token on every route but hello/pair/apk). */
  | 'localhost-needs-token'
  /** /api/ask and /api/cancel exist on the phone port; unknown paths answer 403/401 instead of 404. */
  | 'phone-port-only-neoapp-routes'
  /** A "ping" string token inside an event payload is not escaped. */
  | 'ping-token-escaped'
  /**
   * Old-backend bug, not an amendment: when STT fails it falls back to whisper-cli, and on Node 24 that call
   * throws (non-integer execFile timeout) and kills the whole process instead of emitting `stterr`.
   */
  | 'stt-failure-is-stterr'

export interface Driver {
  readonly name: string
  readonly divergences: ReadonlySet<Divergence>
  /**
   * The ticket that will deliver the feature a test covers, or undefined when the test must pass today.
   * `fullName` is the describe names and the test name joined with " > ". A pending test is reported as `todo`
   * (never silently skipped); `bun test --todo` runs them anyway, to see which ones already pass.
   */
  pending?(fullName: string): string | undefined
  start(): Promise<Backend>
}
