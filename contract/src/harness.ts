import { afterAll, beforeAll, describe as bunDescribe, setDefaultTimeout, test as bunTest } from 'bun:test'
import { oldBackend } from './drivers/old-backend.ts'
import { neoCli } from './drivers/neocli.ts'
import { pair, Phone } from './phone.ts'
import type { Backend, Divergence, Driver } from './types.ts'

setDefaultTimeout(30000)

const drivers: Record<string, Driver> = { old: oldBackend, neocli: neoCli }
const choice = process.env.CONTRACT_BACKEND ?? 'old'
export const driver = drivers[choice] ?? (() => { throw new Error(`unknown CONTRACT_BACKEND "${choice}" (old | neocli)`) })()

const names: string[] = []
const pendingNames: string[] = []

// bun only prints a count for todo tests: list them, so the pending part of the scoreboard is readable
process.on('exit', () => {
  if (pendingNames.length) console.log(`\n${pendingNames.length} pending on ${driver.name}:\n  ${pendingNames.sort().join('\n  ')}`)
})

/** `describe` that remembers its name, so `test` can hand the driver the full name. */
export const describe = (name: string, fn: () => void) =>
  bunDescribe(name, () => {
    names.push(name)
    try {
      fn()
    } finally {
      names.pop()
    }
  })

type Body = () => Promise<void> | void
const TIMEOUT = 30000

/** A test the driver says is not deliverable yet (its ticket hasn't landed) is reported as todo, labelled with the ticket. */
function register(kind: 'plain' | 'failing', name: string, fn: Body, timeout = TIMEOUT) {
  const ticket = driver.pending?.([...names, name].join(' > '))
  if (ticket) {
    pendingNames.push(`${ticket}: ${[...names, name].join(' > ')}`)
    return bunTest.todo(`[pending:${ticket}] ${name}`, fn, timeout)
  }
  return (kind === 'failing' ? bunTest.failing : bunTest)(name, fn, timeout)
}

export const test = (name: string, fn: Body, timeout?: number) => register('plain', name, fn, timeout)

/** A test of the amended contract. Expected to fail on a backend that lists the divergence, to pass on one that does not. */
export function divergent(tag: Divergence, name: string, fn: Body, timeout?: number) {
  // CONTRACT_STRICT=1 runs divergent tests as plain tests, to see how each one fails on this backend.
  const expectFail = driver.divergences.has(tag) && !process.env.CONTRACT_STRICT
  register(expectFail ? 'failing' : 'plain', `[divergent:${tag}] ${name}`, fn, timeout)
}

export interface Session {
  backend: Backend
  /** Not paired. */
  anon: Phone
  /** Pair another phone. */
  pair(name?: string): Promise<Phone>
  /** A phone paired in beforeAll. */
  phone: Phone
}

/** Start one backend for the enclosing describe/file and pair one phone with it. */
export function useBackend(): Session {
  const session = {} as Session
  beforeAll(async () => {
    session.backend = await driver.start()
    session.anon = new Phone(session.backend)
    session.pair = (name) => pair(session.backend, name)
    session.phone = await session.pair()
  }, 60000)
  afterAll(async () => {
    await session.backend?.stop()
  })
  return session
}

/** What a phone user says to wake Neo with a directive for the fake claude (see bin/claude). Thai dominates the text so any Thai-only filter keeps it. */
export const ask = (directive = '') => `นีโอ ทดสอบระบบการ์ดสำหรับสัญญาหลังบ้านเรียบร้อย ${directive}`.trim()
