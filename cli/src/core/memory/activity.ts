// activity.json: when the user is around. Counts activity per (weekday, hour) slot so Neo can tell which hours are normally quiet.
//   {hours:[168 ints, weekday*24+hour], since, last, lastDream, lastCount}      (ms since epoch; same shape as the old Neo)
// A voice or typed turn, a thinking event or a tap on the face counts. The same slot is counted at most once per 10 minutes.
import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import type { Clock } from '../clock'

export const HOUR_MS = 3_600_000
export const DAY_MS = 24 * HOUR_MS
const COUNT_GAP_MS = 10 * 60_000
/** Before this much history, or this many counts, the default quiet hours are used. */
const LEARN_MIN_AGE_MS = 3 * DAY_MS
const LEARN_MIN_COUNTS = 10
const DEFAULT_QUIET = { from: 1, to: 6 } as const // 01:00–05:59
const QUIET_SELF = 0.1
const QUIET_NEIGHBOUR = 0.25
const HOURS_IN_WEEK = 168

interface Saved {
  hours: number[]
  since: number
  last: number
  lastDream: number
  lastCount: number
}

export function createActivity({ file, clock }: { file: string; clock: Clock }) {
  const state: Saved = { hours: new Array(HOURS_IN_WEEK).fill(0), since: clock.now(), last: clock.now(), lastDream: 0, lastCount: 0 }
  try {
    const saved = JSON.parse(readFileSync(file, 'utf8')) as Partial<Saved>
    if (Array.isArray(saved.hours) && saved.hours.length === HOURS_IN_WEEK) state.hours = saved.hours.map(n => Number(n) || 0)
    for (const key of ['since', 'last', 'lastDream', 'lastCount'] as const) if (typeof saved[key] === 'number') state[key] = saved[key]
  } catch {
    // missing or damaged: start fresh
  }
  const save = () => {
    const tmp = `${file}.tmp`
    writeFileSync(tmp, JSON.stringify(state), { mode: 0o600 })
    renameSync(tmp, file)
  }

  /** Per hour of day, 0..1 relative to the busiest hour (all weekdays together). */
  function profile(): number[] {
    const hours = new Array<number>(24).fill(0)
    state.hours.forEach((n, i) => { hours[i % 24]! += n })
    const max = Math.max(...hours)
    return hours.map(n => (max ? Math.round((n / max) * 1000) / 1000 : 0))
  }
  const total = () => state.hours.reduce((a, b) => a + b, 0)

  /** Is this hour normally one where the user is away? */
  function quiet(t = clock.now()): boolean {
    const h = new Date(t).getHours()
    if (t - state.since < LEARN_MIN_AGE_MS || total() < LEARN_MIN_COUNTS) return h >= DEFAULT_QUIET.from && h < DEFAULT_QUIET.to
    const p = profile()
    return p[h]! <= QUIET_SELF && p[(h + 23) % 24]! <= QUIET_NEIGHBOUR && p[(h + 1) % 24]! <= QUIET_NEIGHBOUR
  }

  return {
    /** The user did something (cheap to call often). */
    touch(t = clock.now()) {
      const d = new Date(t)
      if (t - state.lastCount > COUNT_GAP_MS) {
        state.hours[d.getDay() * 24 + d.getHours()]! += 1
        state.lastCount = t
      }
      state.last = t
      save()
    },
    lastActive: () => state.last,
    lastDream: () => state.lastDream,
    setLastDream(t: number) {
      state.lastDream = t
      save()
    },
    profile,
    quiet,
    quietHours(): number[] {
      const d = new Date(clock.now())
      d.setMinutes(0, 0, 0)
      return Array.from({ length: 24 }, (_, h) => h).filter(h => quiet(new Date(d.getFullYear(), d.getMonth(), d.getDate(), h).getTime()))
    },
  }
}

export type Activity = ReturnType<typeof createActivity>
