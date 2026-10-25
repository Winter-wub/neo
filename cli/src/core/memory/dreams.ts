// Dreams: while the user is away Neo reorganises memory.md from the journal and researches old requests further, through the
// Brain. Each dream is its own file in dreams/ (grammar: dream-doc.ts). Ported from app/dream.js.
//
// When it dreams by itself (the 5-minute check, `why`): enabled, not already dreaming, Neo not answering, ≥6 h since the last dream
// started, the user quiet for ≥45 min, the journal has new turns, and then either it is an hour the user is normally away
// ("quiet", learned in activity.ts) or the user has been away for ≥3 h. A failed dream is not retried for an hour (the old Neo
// retried every 5 minutes). `dream now` and the 15-minute deep-sleep dream skip the timing rules; the deep-sleep one still obeys
// the `dream` setting. Entries older than the last dream are not read again; the old 2000-turn trim of the journal is not rebuilt
// (journal days are separate files, `neo journal clear` exists, and a dream reads at most the newest 120 turns).
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type { Card, DreamDoc, DreamInfo, DreamStatus } from '../../protocol'
import type { Brain } from '../brain/brain'
import { humanize } from '../cards/cards'
import type { Clock } from '../clock'
import type { Events } from '../events/events'
import { HOUR_MS, type Activity } from './activity'
import { dreamId, isDreamId, parseDream, renderDream, type DreamParts } from './dream-doc'
import { MemoryConflict, MemoryError, MemoryNotFound, readText, versionOf, writeAtomic } from './files'

export const DEEP_IDLE_MS = 45 * 60_000
export const LONG_IDLE_MS = 3 * HOUR_MS
export const DREAM_GAP_MS = 6 * HOUR_MS
export const RETRY_AFTER_FAILURE_MS = HOUR_MS
export const CHECK_EVERY_MS = 5 * 60_000
/** A dream rewrites memory.md to this many characters at most. */
const MEMORY_DREAM_MAX = 3000
const MEMORY_MIN = 20
const ENTRIES_MAX = 120
const CARD_LINE_MAX = 32
const CARD_ROWS_MAX = 12
const FACTS_MAX = 40
const OUT_OF_SYNC = 'ความจำถูกแก้ระหว่างฝัน จึงไม่ได้เขียนทับ'

export interface DreamEntry {
  at: number
  q: string
  a: string
  ok: boolean
}

export interface DreamingDeps {
  /** The Brain to dream with (looked up each time: the provider can change). */
  brain: () => Brain
  petName: () => string
  /** Neo is answering the user: do not dream over it. */
  busy: () => boolean
  /** The `dream` setting. */
  enabled: () => boolean
}

/** Bullet items of memory.md as a set of texts: what "added" and "removed" are measured on. */
export const factsOf = (items: Array<{ text: string }>) => new Set(items.map(i => i.text))

/** The card Neo tells on waking: the dream first, then what it found. */
export function wakeCardParts(result: { dream: string; insights: Array<{ finding: string }>; card: DreamParts['card'] }): DreamParts['card'] {
  const lines = result.card.lines.slice(0, CARD_ROWS_MAX).map(l => l.slice(0, CARD_LINE_MAX))
  const items = result.card.items.slice(0, CARD_ROWS_MAX)
  if (!lines.length && !items.length) for (const i of result.insights.slice(0, 3)) lines.push(i.finding.slice(0, CARD_LINE_MAX))
  if (result.dream) lines.unshift(result.dream.slice(0, CARD_LINE_MAX))
  return { title: (result.card.title || 'เมื่อกี้ฝันว่า…').slice(0, 16), lines, items }
}

/** The card the phone gets, from the card part of a dream file. */
export function cardOf(parts: DreamParts['card']): Card {
  const rows = parts.lines.length + parts.items.length
  return humanize({
    kind: 'text', layout: parts.items.length ? 'list' : 'text', icon: 'text', title: parts.title, lines: parts.lines, items: parts.items,
    emotion: 'love', sounds: ['love', 'happy'], seconds: Math.min(90, 20 + 4 * rows), dream: true,
  })
}

const plural = (minutes: number) => (minutes >= 120 ? `${Math.round(minutes / 60)} ชั่วโมง` : `${Math.round(minutes)} นาที`)

export function createDreams({ dir, clock, events, activity, deps, memory, journal, announce }: {
  dir: string
  clock: Clock
  events: Events
  activity: Activity
  deps?: DreamingDeps
  memory: { text(): string; items(): Array<{ text: string }>; write(text: string): void }
  journal: { since(ms: number): DreamEntry[] }
  /** A dream file was written or removed by us. */
  announce: (id: string) => void
}) {
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const file = (id: string) => join(dir, `${id}.md`)
  let running = false
  let failedAt: number | null = null
  let stopTimer: (() => void) | null = null
  const abort = new AbortController()

  const ids = () => readdirSync(dir).filter(n => n.endsWith('.md') && isDreamId(n.slice(0, -3))).map(n => n.slice(0, -3)).sort().reverse()
  const infoOf = (id: string, parts: DreamParts): DreamInfo => ({
    id, at: parts.at, reason: parts.reason, took: parts.took, entries: parts.entries, dream: parts.dream, insights: parts.insights.length, undelivered: parts.undelivered,
  })
  const docOf = (id: string): DreamDoc => {
    const text = readText(file(id))
    const parts = parseDream(text)
    const { insights, ...rest } = parts
    return { ...rest, insights, id, text, version: versionOf(text) }
  }
  const all = () => ids().map(id => ({ id, parts: parseDream(readText(file(id))) }))
  const list = (): DreamInfo[] => all().map(({ id, parts }) => infoOf(id, parts))

  function resolve(id: string): string {
    const found = id === 'last' ? ids()[0] : id
    if (!found || !isDreamId(found) || !existsSync(file(found))) throw new MemoryNotFound(id === 'last' ? 'ยังไม่เคยฝัน' : `ไม่พบความฝัน ${id} (ดู neo dream list)`)
    return found
  }

  // ---- when ----

  /** `why`: the reason a dream starts now; otherwise `blocked`: why not. */
  function check(t = clock.now()): { why: string | null; blocked: string | null } {
    const no = (blocked: string) => ({ why: null, blocked })
    if (!deps?.enabled()) return no('ปิดการฝันอยู่ (เปิดด้วย neo dream on)')
    if (running) return no('กำลังฝันอยู่')
    if (deps.busy()) return no('Neo กำลังตอบผู้ใช้อยู่ (ไม่ฝันแทรก)')
    if (failedAt !== null && t - failedAt < RETRY_AFTER_FAILURE_MS) return no(`ฝันครั้งล่าสุดล้มเหลวเมื่อ ${plural((t - failedAt) / 60_000)}ที่แล้ว รอครบ 1 ชั่วโมงก่อนลองใหม่`)
    const last = activity.lastDream()
    if (last && t - last < DREAM_GAP_MS) return no(`ฝันครั้งก่อนเมื่อ ${plural((t - last) / 60_000)}ที่แล้ว ต้องห่างกันอย่างน้อย 6 ชั่วโมง (อีก ${plural((DREAM_GAP_MS - (t - last)) / 60_000)})`)
    const idle = t - activity.lastActive()
    if (idle < DEEP_IDLE_MS) return no(`ผู้ใช้เพิ่งอยู่เมื่อ ${plural(idle / 60_000)}ที่แล้ว ต้องเงียบอย่างน้อย 45 นาที`)
    if (!journal.since(last).length) return no('ไม่มีเรื่องใหม่ใน journal ตั้งแต่ฝันครั้งก่อน')
    if (activity.quiet(t)) return { why: 'ช่วงที่ปกติคุณไม่อยู่', blocked: null }
    if (idle >= LONG_IDLE_MS) return { why: 'คุณไม่อยู่นานแล้ว', blocked: null }
    return no('ตอนนี้เป็นช่วงที่ปกติคุณอยู่ (จะฝันเมื่อเงียบครบ 3 ชั่วโมง หรือถึงช่วงที่คุณมักไม่อยู่)')
  }

  function status(): DreamStatus {
    const t = clock.now()
    const { why, blocked } = check(t)
    const last = list()[0] ?? null
    return {
      enabled: deps?.enabled() ?? false,
      running,
      last,
      why,
      blocked,
      newEntries: journal.since(activity.lastDream()).length,
      idleMinutes: Math.floor((t - activity.lastActive()) / 60_000),
      quietNow: activity.quiet(t),
      quietHours: activity.quietHours(),
      activity: activity.profile(),
    }
  }

  // ---- dreaming ----

  async function dream(reason: string): Promise<DreamDoc> {
    if (!deps) throw new MemoryError('ฝันไม่ได้ในตอนนี้')
    if (running) throw new MemoryConflict('กำลังฝันอยู่')
    running = true
    const started = clock.now()
    try {
      const entries = journal.since(activity.lastDream()).slice(-ENTRIES_MAX)
      events.publish({ type: 'dreaming', reason, entries: entries.length })
      const before = memory.text()
      const brain = deps.brain()
      const result = brain.dream
        ? await brain.dream({ petName: deps.petName(), memory: before, entries, quietHours: activity.quietHours(), signal: abort.signal, onTool: (name, input) => events.publish({ type: 'tool', name, input }) })
        : { type: 'error' as const, error: `${brain.label} ฝันไม่ได้ (ต้องใช้ Claude Code ที่ค้นข้อมูลเองได้)` }
      if (result.type === 'error') throw new MemoryError(result.error)

      const patterns = result.patterns.slice(0, 5)
      let added: string[] = []
      let removed: string[] = []
      const rewrite = result.memory.trim()
      if (rewrite.length > MEMORY_MIN) {
        if (memory.text() !== before) {
          patterns.push(OUT_OF_SYNC)
        } else {
          const was = factsOf(memory.items())
          memory.write(rewrite.slice(0, MEMORY_DREAM_MAX) + '\n')
          const now = factsOf(memory.items())
          added = [...now].filter(x => !was.has(x)).slice(0, FACTS_MAX)
          removed = [...was].filter(x => !now.has(x)).slice(0, FACTS_MAX)
        }
      }
      const parts: DreamParts = {
        at: started, reason, took: clock.now() - started, entries: entries.length, undelivered: true,
        dream: result.dream.replace(/\s+/g, ' ').trim().slice(0, 120),
        insights: result.insights, patterns, added, removed, card: wakeCardParts(result),
      }
      const id = dreamId(started, taken => existsSync(file(taken)))
      writeAtomic(file(id), renderDream(parts))
      activity.setLastDream(started)
      failedAt = null
      announce(id)
      events.publish({ type: 'dream_done', dream: parts.dream, insights: parts.insights.length, card: cardOf(parts.card) })
      return docOf(id)
    } catch (e) {
      failedAt = clock.now()
      events.publish({ type: 'dream_fail', error: (e as Error).message })
      throw e
    } finally {
      running = false
    }
  }

  /** Dreams if the dream setting allows and none is running. Null when it did not. */
  async function dreamIfAllowed(reason: string): Promise<DreamDoc | null> {
    if (!deps?.enabled() || running) return null
    return dream(reason)
  }

  /** The 5-minute check. */
  const maybe = () => {
    const { why } = check()
    if (why) dream(why).catch(e => console.error('dream failed:', (e as Error).message))
  }
  if (deps) stopTimer = clock.every(CHECK_EVERY_MS, maybe)

  // ---- the card for the phone ----

  /** The newest dream whose card the phone has not shown yet. */
  function pending(): { at: number; card: Card } | null {
    const newest = all().find(d => d.parts.undelivered)
    return newest ? { at: newest.parts.at, card: cardOf(newest.parts.card) } : null
  }
  /** The phone showed it: no dream is undelivered any more. */
  function seen() {
    for (const { id, parts } of all()) {
      if (!parts.undelivered) continue
      const lines = readText(file(id)).split('\n')
      const end = lines.indexOf('---', 1) // the front matter's closing line
      const at = lines.findIndex((line, i) => i < end && /^undelivered:/.test(line))
      if (at >= 0) lines.splice(at, 1)
      writeAtomic(file(id), lines.join('\n'))
      announce(id)
    }
  }

  return {
    status,
    dream,
    dreamIfAllowed,
    list,
    show: (id: string) => docOf(resolve(id)),
    remove(id: string): DreamInfo {
      const found = resolve(id)
      const info = infoOf(found, parseDream(readText(file(found))))
      rmSync(file(found), { force: true })
      announce(found)
      return info
    },
    clear(): number {
      const found = ids()
      for (const id of found) rmSync(file(id), { force: true })
      for (const id of found) announce(id)
      return found.length
    },
    /** For each memory item a dream added: the newest dream that did. */
    origins(): Map<string, { id: string; at: number; dream: string }> {
      const found = new Map<string, { id: string; at: number; dream: string }>()
      for (const { id, parts } of all()) for (const text of parts.added) if (!found.has(text)) found.set(text, { id, at: parts.at, dream: parts.dream })
      return found
    },
    pending,
    seen,
    close() {
      stopTimer?.()
      abort.abort()
    },
  }
}

export type Dreams = ReturnType<typeof createDreams>
