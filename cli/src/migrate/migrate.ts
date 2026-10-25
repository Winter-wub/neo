// The one-time conversion of an old NEO_HOME (the Node backend's) into the layout NeoCli keeps. The daemon runs it at start,
// before anything opens the files, so it only ever touches files. An "old" home is one that still has journal.jsonl,
// dreams.jsonl or schedule.json; once they have moved to legacy/ a second start finds nothing to do.
//
//   journal.jsonl  → journal/YYYY-MM-DD.md     through journal-doc's serializer
//   dreams.jsonl   → dreams/YYYY-MM-DD-HHmm.md through dream-doc's
//   schedule.json  → jobs.md                   through jobs' markdown
//   the originals  → legacy/                   moved last, so a crash before that just redoes the (overwriting) conversion
//   providers.json → a provider's apiKeyFile inside the old config dir (~/.config/neo) is copied into NEO_HOME (0600) and
//                    rewritten; the file in ~/.config/neo stays
//   state.json     → claudeConfigDir set to this Mac's Claude config dir, unless the home already names one
// Everything else (devices.json, memory.md, activity.json, tasks/) carries over untouched, so paired phones stay paired.
import { existsSync } from 'node:fs'
import { chmod, copyFile, mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { parseCron } from '../core/jobs/cron'
import { parseJobs, serializeJobs, type StoredJob } from '../core/jobs/markdown'
import { expandHome } from '../core/brain/api-key'
import { dreamId, renderDream, type DreamParts } from '../core/memory/dream-doc'
import { appendEntry } from '../core/memory/journal-doc'
import { dayOf, pad } from '../core/memory/files'

export interface MigrateOptions {
  home: string
  /** Where the old backend kept its data by default, and its API key: `~/.config/neo`. */
  legacyConfigDir?: string
  /** What `claudeConfigDir` becomes. Default: `$CLAUDE_CONFIG_DIR`, else `~/.ccs/instances/personal` (the old backend's default). */
  claudeConfigDir?: string
}

export interface MigrationResult {
  /** False when the home had nothing old in it. */
  ran: boolean
  journal: { entries: number; days: number; skipped: number }
  dreams: { count: number; skipped: number }
  jobs: { count: number; skipped: number }
  /** Key files copied into NEO_HOME. */
  keys: string[]
  claudeConfigDir: string | null
}

const OLD_FILES = ['journal.jsonl', 'dreams.jsonl', 'schedule.json'] as const

const readOptional = (file: string) => readFile(file, 'utf8').catch(() => null)
const record = (value: unknown): Record<string, unknown> | null => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null)
const clean = (text: unknown) => (typeof text === 'string' ? text : String(text ?? '')).toWellFormed()

function jsonLines(text: string | null): { rows: Array<Record<string, unknown>>; skipped: number } {
  const rows: Array<Record<string, unknown>> = []
  let skipped = 0
  for (const line of (text ?? '').split('\n')) {
    if (!line.trim()) continue
    try {
      const row = record(JSON.parse(line))
      if (row) rows.push(row)
      else skipped++
    } catch {
      skipped++
    }
  }
  return { rows, skipped }
}

async function writePrivate(file: string, text: string) {
  await mkdir(dirname(file), { recursive: true, mode: 0o700 })
  await writeFile(file, text, { mode: 0o600 })
}

async function convertJournal(home: string, text: string | null): Promise<MigrationResult['journal']> {
  const { rows, skipped: unreadable } = jsonLines(text)
  const turns = rows
    .filter(r => typeof r.at === 'number' && Number.isFinite(r.at))
    .map(r => ({ at: r.at as number, q: clean(r.q), a: clean(r.a), ok: r.ok !== false }))
    .sort((a, b) => a.at - b.at)
  const days = new Map<string, string>()
  for (const turn of turns) {
    const d = new Date(turn.at)
    const day = dayOf(d)
    days.set(day, appendEntry(days.get(day) ?? '', day, { time: `${pad(d.getHours())}:${pad(d.getMinutes())}`, q: turn.q, a: turn.a, ok: turn.ok }))
  }
  for (const [day, file] of days) await writePrivate(join(home, 'journal', `${day}.md`), file)
  return { entries: turns.length, days: days.size, skipped: unreadable + rows.length - turns.length }
}

const strings = (value: unknown) => (Array.isArray(value) ? value.map(clean).filter(Boolean) : [])
const count = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : 0)

function dreamOf(row: Record<string, unknown>): DreamParts | null {
  if (typeof row.at !== 'number' || !Number.isFinite(row.at)) return null
  const card = record(row.card) ?? {}
  return {
    at: row.at, reason: clean(row.reason), took: count(row.took), entries: count(row.entries), undelivered: row.undelivered === true, dream: clean(row.dream),
    insights: (Array.isArray(row.insights) ? row.insights : []).flatMap(i => {
      const insight = record(i)
      return insight ? [{ q: clean(insight.q), finding: clean(insight.finding) }] : []
    }),
    patterns: strings(row.patterns), added: strings(row.added), removed: strings(row.removed),
    card: {
      title: clean(card.title), lines: strings(card.lines),
      items: (Array.isArray(card.items) ? card.items : []).flatMap(i => {
        const item = record(i)
        return item ? [{ t: clean(item.t), v: clean(item.v) }] : []
      }),
    },
  }
}

async function convertDreams(home: string, text: string | null): Promise<MigrationResult['dreams']> {
  const { rows, skipped: unreadable } = jsonLines(text)
  const dreams = rows.flatMap(r => dreamOf(r) ?? []).sort((a, b) => a.at - b.at)
  // ids come from this run alone, so redoing a half-finished conversion writes the same files again
  const taken = new Set<string>()
  for (const dream of dreams) {
    const id = dreamId(dream.at, candidate => taken.has(candidate))
    taken.add(id)
    await writePrivate(join(home, 'dreams', `${id}.md`), renderDream(dream))
  }
  return { count: dreams.length, skipped: unreadable + rows.length - dreams.length }
}

const TITLE_MAX = 80

function jobOf(value: unknown): StoredJob | null {
  const row = record(value)
  if (!row || typeof row.id !== 'string' || !/^[A-Za-z0-9_-]{1,32}$/.test(row.id)) return null
  if (row.kind !== 'alarm' && row.kind !== 'task') return null
  const hasAt = typeof row.at === 'number' && Number.isFinite(row.at)
  const hasCron = typeof row.cron === 'string'
  if (hasAt === hasCron) return null
  if (hasCron) {
    try { parseCron(row.cron as string) } catch { return null }
  }
  const prompt = typeof row.prompt === 'string' ? row.prompt.toWellFormed().trim() : ''
  if (row.kind === 'task' && !prompt) return null
  const title = clean(row.title).replace(/\s+/g, ' ').trim().slice(0, TITLE_MAX)
  return {
    id: row.id, kind: row.kind, title, enabled: row.enabled !== false, notes: [],
    ...(row.kind === 'task' ? { prompt } : {}),
    ...(hasAt ? { at: row.at as number } : { cron: row.cron as string }),
    ...(typeof row.last === 'number' && Number.isFinite(row.last) ? { last: row.last } : {}),
  }
}

async function convertJobs(home: string, text: string | null): Promise<MigrationResult['jobs']> {
  let list: unknown[] = []
  try {
    const parsed = JSON.parse(text ?? '[]')
    if (Array.isArray(parsed)) list = parsed
  } catch {
    // unreadable: nothing to carry over; the original still moves to legacy/ for a person to look at
  }
  const file = join(home, 'jobs.md')
  const existing = parseJobs((await readOptional(file)) ?? '')
  const ids = new Set(existing.jobs.map(j => j.id))
  const added: StoredJob[] = []
  for (const value of list) {
    const job = jobOf(value)
    if (!job || ids.has(job.id)) continue
    ids.add(job.id)
    added.push(job)
  }
  if (added.length) await writePrivate(file, serializeJobs([...existing.jobs, ...added], existing.preamble || undefined))
  return { count: added.length, skipped: list.length - added.length }
}

/** Copies each legacy key file a provider names into NEO_HOME and points the provider at the copy. */
async function moveKeys(home: string, legacyConfigDir: string): Promise<string[]> {
  const file = join(home, 'providers.json')
  const text = await readOptional(file)
  if (text === null) return []
  let config: Record<string, unknown> | null
  try { config = record(JSON.parse(text)) } catch { return [] }
  const providers = record(config?.providers)
  if (!config || !providers) return []
  const legacy = resolve(legacyConfigDir)
  const copied: string[] = []
  for (const provider of Object.values(providers)) {
    const entry = record(provider)
    if (!entry || typeof entry.apiKeyFile !== 'string') continue
    const source = resolve(expandHome(entry.apiKeyFile))
    if (dirname(source) !== legacy || !existsSync(source)) continue
    const target = join(home, basename(source))
    if (source !== target) {
      if (!existsSync(target)) await copyFile(source, target)
      await chmod(target, 0o600)
    }
    const fromHome = relative(homedir(), target)
    entry.apiKeyFile = fromHome.startsWith('..') ? target : `~/${fromHome}`
    if (!copied.includes(basename(target))) copied.push(basename(target))
  }
  if (copied.length) await writeFile(file, JSON.stringify(config, null, 2) + '\n', { mode: (await stat(file)).mode & 0o777 })
  return copied
}

/** Sets `claudeConfigDir` in state.json unless the home already names one; returns what it set, or null. */
async function setClaudeConfigDir(home: string, dir: string): Promise<string | null> {
  const file = join(home, 'state.json')
  let state: Record<string, unknown> = {}
  try { state = record(JSON.parse((await readOptional(file)) ?? '{}')) ?? {} } catch { return null } // unreadable: not ours to overwrite
  if (typeof state.claudeConfigDir === 'string' && state.claudeConfigDir) return null
  const tmp = `${file}.tmp`
  await writeFile(tmp, JSON.stringify({ ...state, claudeConfigDir: dir }, null, 1), { mode: 0o600 })
  await rename(tmp, file)
  return dir
}

export async function migrateHome({ home, legacyConfigDir = join(homedir(), '.config', 'neo'), claudeConfigDir = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.ccs', 'instances', 'personal') }: MigrateOptions): Promise<MigrationResult> {
  const sources = Object.fromEntries(await Promise.all(OLD_FILES.map(async name => [name, await readOptional(join(home, name))]))) as Record<(typeof OLD_FILES)[number], string | null>
  const ran = OLD_FILES.some(name => sources[name] !== null)
  const result: MigrationResult = { ran, journal: { entries: 0, days: 0, skipped: 0 }, dreams: { count: 0, skipped: 0 }, jobs: { count: 0, skipped: 0 }, keys: [], claudeConfigDir: null }
  if (!ran) return result
  result.journal = await convertJournal(home, sources['journal.jsonl'])
  result.dreams = await convertDreams(home, sources['dreams.jsonl'])
  result.jobs = await convertJobs(home, sources['schedule.json'])
  result.keys = await moveKeys(home, legacyConfigDir)
  result.claudeConfigDir = await setClaudeConfigDir(home, claudeConfigDir)
  await mkdir(join(home, 'legacy'), { recursive: true, mode: 0o700 })
  for (const name of OLD_FILES) if (sources[name] !== null) await rename(join(home, name), join(home, 'legacy', name))
  return result
}

/** One line for the daemon log. */
export function summarize({ journal, dreams, jobs, keys, claudeConfigDir }: MigrationResult): string {
  const skipped = journal.skipped + dreams.skipped + jobs.skipped
  return `แปลงข้อมูล Neo รุ่นเก่าแล้ว: journal ${journal.entries} รายการ (${journal.days} วัน) · ความฝัน ${dreams.count} · งาน ${jobs.count}`
    + (skipped ? ` · ข้าม ${skipped} รายการที่อ่านไม่ได้` : '')
    + (keys.length ? ` · คัดลอกกุญแจ ${keys.join(', ')}` : '')
    + (claudeConfigDir ? ` · claudeConfigDir=${claudeConfigDir}` : '')
    + ' · ไฟล์เดิมอยู่ใน legacy/'
}
