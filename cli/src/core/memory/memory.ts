// Memory: what Neo keeps about the user, as markdown files in NEO_HOME that an editor can open.
//
//   memory.md                 ## Section + "- item" lines          grammar and edits: memory-doc.ts
//   journal/YYYY-MM-DD.md     one block per turn (time, Q, A)      grammar: journal-doc.ts (top of file)
//   dreams/YYYY-MM-DD-HHmm.md one dream per file, with its +/− memory changes   grammar: dream-doc.ts; behaviour: dreams.ts
//   activity.json             when the user is around (away-hours learning)       activity.ts
//
// Files are read from disk every time, so an edit made in an editor takes effect on the next ask. The module also
// watches the files and publishes a `changed` event (for Neo Console) when one differs from what we last saw.
// Saves that could race with an editor are conflict-checked: the caller sends the `version` it read, and a file that
// has changed since is refused. Everything here is synchronous on purpose: the files are small, and a read-check-write
// cannot be interleaved with another request in this process.
import { existsSync, mkdirSync, readdirSync, rmSync, watch, type FSWatcher } from 'node:fs'
import { join } from 'node:path'
import type { JournalDay, JournalDoc, JournalEntry, MemoryDoc, MemoryItem } from '../../protocol'
import type { Clock } from '../clock'
import type { Events } from '../events/events'
import { MemoryConflict, MemoryError, MemoryNotFound, dayOf, pad, readText, versionOf, writeAtomic } from './files'
import { createActivity } from './activity'
import { createDreams, type DreamEntry, type DreamingDeps } from './dreams'
import { isDreamId } from './dream-doc'
import { appendEntry, parseJournal, removeEntries } from './journal-doc'
import { addItem, parseMemory, removeItems } from './memory-doc'

/** What a user may write; ask prompts cut this at 3000 anyway. */
export const MEMORY_MAX = 6000
const DAY = /^(\d{4})-(\d{2})-(\d{2})$/
const WATCH_DEBOUNCE_MS = 50

export { MemoryConflict, MemoryError, MemoryNotFound }

export function createMemory({ home, clock, events, watchFiles = true, dreaming }: {
  home: string
  clock: Clock
  events: Events
  /** What dreaming needs from the rest of the core. Without it nothing dreams (the files can still be read and removed). */
  dreaming?: DreamingDeps
  /** Tests that don't care about outside edits can turn the watchers off. */
  watchFiles?: boolean
}) {
  const memoryFile = join(home, 'memory.md')
  const journalDir = join(home, 'journal')
  const dreamDir = join(home, 'dreams')
  mkdirSync(journalDir, { recursive: true, mode: 0o700 })
  mkdirSync(dreamDir, { recursive: true, mode: 0o700 })
  const dayFile = (day: string) => join(journalDir, `${day}.md`)

  // ---- change notification ----
  const seen = new Map<string, string>() // 'memory' | 'journal/<day>' | 'dream/<id>' → version last seen
  const memoryKey = 'memory'
  const journalKey = (day: string) => `journal/${day}`
  const dreamKey = (id: string) => `dream/${id}`
  const dreamFile = (id: string) => join(dreamDir, `${id}.md`)
  const current = (key: string) =>
    versionOf(readText(key === memoryKey ? memoryFile : key.startsWith('dream/') ? dreamFile(key.slice('dream/'.length)) : dayFile(key.slice('journal/'.length))))
  const announce = (key: string) => {
    seen.set(key, current(key))
    events.publish(
      key === memoryKey ? { type: 'changed', file: 'memory' }
        : key.startsWith('dream/') ? { type: 'changed', file: 'dream', id: key.slice('dream/'.length) }
        : { type: 'changed', file: 'journal', day: key.slice('journal/'.length) },
    )
  }
  const check = (key: string) => {
    if (seen.get(key) !== current(key)) announce(key)
  }
  seen.set(memoryKey, current(memoryKey))
  for (const name of readdirSync(journalDir)) {
    if (name.endsWith('.md')) seen.set(journalKey(name.slice(0, -3)), current(journalKey(name.slice(0, -3))))
  }
  for (const name of readdirSync(dreamDir)) {
    if (name.endsWith('.md') && isDreamId(name.slice(0, -3))) seen.set(dreamKey(name.slice(0, -3)), current(dreamKey(name.slice(0, -3))))
  }

  const watchers: FSWatcher[] = []
  const pending = new Set<string>()
  let timer: ReturnType<typeof setTimeout> | null = null
  const later = (key: string) => {
    pending.add(key)
    timer ??= setTimeout(() => {
      timer = null
      const keys = [...pending]
      pending.clear()
      for (const k of keys) check(k)
    }, WATCH_DEBOUNCE_MS)
  }
  if (watchFiles) {
    watchers.push(watch(home, (_, name) => {
      if (name === 'memory.md' || name === null) later(memoryKey)
    }))
    watchers.push(watch(journalDir, (_, name) => {
      if (name === null) {
        for (const key of seen.keys()) if (key.startsWith('journal/')) later(key)
      } else if (name.endsWith('.md')) {
        later(journalKey(name.slice(0, -3)))
      }
    }))
    watchers.push(watch(dreamDir, (_, name) => {
      if (name === null) {
        for (const key of seen.keys()) if (key.startsWith('dream/')) later(key)
      } else if (name.endsWith('.md') && isDreamId(name.slice(0, -3))) {
        later(dreamKey(name.slice(0, -3)))
      }
    }))
    for (const w of watchers) {
      w.on('error', () => {}) // a removed directory must not crash the daemon
      w.unref?.()
    }
  }

  // ---- memory.md ----
  const doc = (): MemoryDoc => {
    const text = readText(memoryFile)
    const origins = dreams.origins()
    return { text, version: versionOf(text), items: parseMemory(text).map(item => (origins.has(item.text) ? { ...item, from: origins.get(item.text)! } : item)) }
  }
  function write(text: string): MemoryDoc {
    if (text.length > MEMORY_MAX) throw new MemoryError(`ความจำยาวเกิน ${MEMORY_MAX} ตัวอักษร`)
    writeAtomic(memoryFile, text)
    announce(memoryKey)
    return doc()
  }
  const listing = (rows: string[], query: string) =>
    `เจอ ${rows.length} รายการที่ตรงกับ “${query}”:\n${rows.map(r => '  - ' + r).join('\n')}\nพิมพ์ให้เฉพาะเจาะจงขึ้น หรือใช้ --all เพื่อลบทั้งหมด`

  // ---- journal ----
  function resolveDay(day?: string) {
    const now = new Date(clock.now())
    if (!day || day === 'today') return dayOf(now)
    if (day === 'yesterday') return dayOf(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1))
    const m = DAY.exec(day)
    const real = m && new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
    if (!real || dayOf(real) !== day) throw new MemoryError(`วันที่ต้องเป็น YYYY-MM-DD, today หรือ yesterday (ได้ “${day}”)`)
    return day
  }
  const dayNames = () => readdirSync(journalDir).filter(n => n.endsWith('.md') && DAY.test(n.slice(0, -3))).map(n => n.slice(0, -3)).sort().reverse()
  const entriesOf = (day: string, text: string): JournalEntry[] => parseJournal(text).map(e => ({ day, ...e }))
  function showDay(day: string): JournalDoc {
    const text = readText(dayFile(day))
    return { day, text, version: versionOf(text), entries: entriesOf(day, text) }
  }
  function writeDay(day: string, text: string | null) {
    if (text === null || text.trim() === '') rmSync(dayFile(day), { force: true })
    else writeAtomic(dayFile(day), text)
    announce(journalKey(day))
  }
  const stamp = (day: string, time: string) => {
    const [y, m, d] = day.split('-').map(Number)
    const [h, min] = time.split(':').map(Number)
    return new Date(y!, m! - 1, d!, h, min).getTime()
  }
  /** The turns after the minute `since` (a turn only has a minute on it), oldest first. */
  function entriesSince(since: number): DreamEntry[] {
    const floor = Math.floor(since / 60_000) * 60_000
    const first = dayOf(new Date(since))
    return dayNames().filter(day => day >= first).reverse()
      .flatMap(day => parseJournal(readText(dayFile(day))).map(e => ({ at: stamp(day, e.time), q: e.q, a: e.a, ok: e.ok })))
      .filter(e => e.at > floor)
  }
  const entryLabel = (e: JournalEntry) => `${e.day} ${e.time} ${e.q}`
  const entryKey = (e: { time: string; q: string; a: string }) => `${e.time}\n${e.q}\n${e.a}`

  // ---- dreams and away-hours ----
  const activity = createActivity({ file: join(home, 'activity.json'), clock })
  // the user is around when they talk (a thinking event carries the question) or tap the face
  const stopWatching = events.watch(event => {
    if (event.type === 'armed' || (event.type === 'thinking' && event.text)) activity.touch()
  })
  const dreams = createDreams({
    dir: dreamDir, clock, events, activity, deps: dreaming,
    memory: { text: () => readText(memoryFile), items: () => parseMemory(readText(memoryFile)), write },
    journal: { since: entriesSince },
    announce: id => announce(dreamKey(id)),
  })

  return {
    doc,
    dreams,
    /** Dream now, whatever the timing rules say. Resolves when the dream is over. */
    dream: dreams.dream,
    /** The deep-sleep dream: only if the `dream` setting is on and none is running. Null when it did not dream. */
    dreamIfAllowed: dreams.dreamIfAllowed,
    /** The text every ask gets as context. */
    context: () => readText(memoryFile),
    /** Replace the whole document, if it is still the version the caller read. */
    save(text: string, since: string): MemoryDoc {
      if (doc().version !== since) throw new MemoryConflict('memory.md ถูกแก้ไประหว่างที่คุณแก้ ไม่ได้บันทึก (ดูของล่าสุดด้วย neo memory show แล้วแก้ใหม่)')
      return write(text)
    },
    add(text: string, section?: string): MemoryDoc {
      let next: ReturnType<typeof addItem>
      try {
        next = addItem(readText(memoryFile), text, section)
      } catch (e) {
        throw new MemoryError((e as Error).message)
      }
      return next.added ? write(next.text) : doc()
    },
    /** Removes what `text` matches. Several matches are refused (with the list) unless `all`. */
    forget(text: string, { all = false } = {}): MemoryItem[] {
      if (!text.trim()) throw new MemoryError('ไม่มีข้อความ')
      const { text: next, matches } = removeItems(readText(memoryFile), text, { all })
      if (!matches.length) throw new MemoryNotFound(`ไม่พบ “${text}” ในความจำ`)
      if (matches.length > 1 && !all) throw new MemoryConflict(listing(matches.map(m => `[${m.section || '-'}] ${m.text}`), text))
      write(next)
      return matches
    },
    clear(): number {
      const count = doc().items.length
      if (existsSync(memoryFile)) write('')
      return count
    },

    /** One finished turn. Nothing is recorded for an empty question. */
    record({ q, a, ok }: { q: string; a: string; ok: boolean }) {
      if (!q.trim()) return
      const now = new Date(clock.now())
      const day = dayOf(now)
      writeDay(day, appendEntry(readText(dayFile(day)), day, { time: `${pad(now.getHours())}:${pad(now.getMinutes())}`, q, a, ok }))
    },
    days(): JournalDay[] {
      return dayNames().map(day => ({ day, entries: parseJournal(readText(dayFile(day))).length }))
    },
    show: (day?: string): JournalDoc => showDay(resolveDay(day)),
    /** Replace a day's markdown, if it is still the version the caller read. Empty text deletes the day. */
    saveDay(day: string, text: string, since: string): JournalDoc {
      const d = resolveDay(day)
      if (showDay(d).version !== since) throw new MemoryConflict(`journal ของ ${d} ถูกแก้ไประหว่างที่คุณแก้ ไม่ได้บันทึก`)
      writeDay(d, text)
      return showDay(d)
    },
    /** Removes the turns whose question or answer contains `text`. Several matches are refused unless `all`. */
    forgetEntries(text: string, { all = false } = {}): JournalEntry[] {
      const needle = text.replace(/\s+/g, ' ').trim().toLowerCase()
      if (!needle) throw new MemoryError('ไม่มีข้อความ')
      const hits = dayNames().flatMap(day => entriesOf(day, readText(dayFile(day))).filter(e => `${e.q}\n${e.a}`.toLowerCase().includes(needle)))
      if (!hits.length) throw new MemoryNotFound(`ไม่พบ “${text}” ใน journal`)
      const exact = hits.filter(e => e.q.toLowerCase() === needle)
      const matches = !all && exact.length === 1 ? exact : hits
      if (matches.length > 1 && !all) throw new MemoryConflict(listing(matches.map(entryLabel), text))
      for (const day of new Set(matches.map(e => e.day))) {
        const mine = new Set(matches.filter(e => e.day === day).map(entryKey))
        writeDay(day, removeEntries(readText(dayFile(day)), e => mine.has(entryKey(e))))
      }
      return matches
    },
    clearJournal(): number {
      const days = dayNames()
      for (const day of days) writeDay(day, null)
      return days.length
    },

    close() {
      stopWatching()
      dreams.close()
      for (const w of watchers) w.close()
      if (timer) clearTimeout(timer)
    },
  }
}

export type Memory = ReturnType<typeof createMemory>
