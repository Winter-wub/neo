import { format } from 'node:util'
import type { Clock } from '../core/clock'
import { DAEMON_LOG } from './lifecycle'
import { RotatingLog } from './rotating-log'
import { join } from 'node:path'

export interface TeeOptions {
  logDir: string
  clock: Clock
  /** Echo to stderr as well: for a foreground run. Under launchd stderr is the crash log, so it stays off. */
  passThrough: boolean
  stderr(text: string): void
}

/** Sends console.log/warn/error to `daemon.log` (5 MB × 3 rotation). */
export function teeConsoleToLog({ logDir, clock, passThrough, stderr }: TeeOptions) {
  const log = new RotatingLog({ file: join(logDir, DAEMON_LOG) })
  const originals = { log: console.log, warn: console.warn, error: console.error }
  let pending: Promise<unknown> = Promise.resolve()
  const write = (...args: unknown[]) => {
    const text = format(...args)
    pending = log.append(`${new Date(clock.now()).toISOString()} ${text}\n`).catch(() => {})
    if (passThrough) stderr(text + '\n')
  }
  console.log = console.warn = console.error = write
  return {
    flush: () => pending,
    restore() {
      Object.assign(console, originals)
    },
  }
}
