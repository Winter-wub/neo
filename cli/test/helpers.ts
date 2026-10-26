import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import type { Clock } from '../src/core/clock'

export class FakeClock implements Clock {
  #now: number
  #timers = new Map<number, { every: number; next: number; fn: () => void }>()
  #seq = 0
  constructor(start = 1_700_000_000_000) {
    this.#now = start
  }
  now() {
    return this.#now
  }
  every(ms: number, fn: () => void) {
    const id = this.#seq++
    this.#timers.set(id, { every: ms, next: this.#now + ms, fn })
    return () => void this.#timers.delete(id)
  }
  advance(ms: number) {
    const target = this.#now + ms
    for (;;) {
      const due = [...this.#timers.values()].filter(t => t.next <= target).sort((a, b) => a.next - b.next)[0]
      if (!due) break
      this.#now = due.next
      due.next += due.every
      due.fn()
    }
    this.#now = target
  }
}

/** Short path: unix socket paths are limited to ~104 bytes on macOS. */
export async function tempHome() {
  const dir = await mkdtemp(join(tmpdir(), 'neo-'))
  return { dir, cleanup: () => rm(dir, { recursive: true, force: true }) }
}

const FIXTURES = join(import.meta.dir, 'fixtures')

/** Golden fixtures: every --json output and event gets written here for the Swift/Kotlin decoders. */
export async function golden(name: string, value: unknown) {
  const file = join(FIXTURES, `${name}.json`)
  await mkdir(dirname(file), { recursive: true })
  // fixtures are committed: the machine's home directory reads as ~
  await writeFile(file, JSON.stringify(value, null, 2).replaceAll(homedir(), '~') + '\n')
}

export async function nextOf<T>(it: AsyncIterator<T>, timeoutMs = 3000): Promise<T> {
  const timer = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout waiting for next item')), timeoutMs))
  const r = await Promise.race([it.next(), timer])
  if (r.done) throw new Error('stream ended')
  return r.value
}
