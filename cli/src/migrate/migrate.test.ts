import { afterEach, expect, test } from 'bun:test'
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tempHome } from '../../test/helpers'
import { parseJobs } from '../core/jobs/markdown'
import { parseDream } from '../core/memory/dream-doc'
import { parseJournal } from '../core/memory/journal-doc'
import { migrateHome } from './migrate'

const cleanups: Array<() => Promise<unknown>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

/** An old NEO_HOME inside a temp dir, next to a fake `~/.config/neo`. */
async function oldHome(files: Record<string, string> = {}) {
  const { dir, cleanup } = await tempHome()
  cleanups.push(cleanup)
  const home = join(dir, 'Neo')
  const legacyConfig = join(dir, 'config-neo')
  await mkdir(home, { recursive: true })
  await mkdir(legacyConfig, { recursive: true })
  for (const [name, text] of Object.entries(files)) await writeFile(join(home, name), text, { mode: 0o600 })
  return { dir, home, legacyConfig, options: { home, legacyConfigDir: legacyConfig, claudeConfigDir: '/Users/x/.ccs/instances/personal' } }
}
const jsonl = (rows: unknown[]) => rows.map(r => JSON.stringify(r)).join('\n') + '\n'
const at = (y: number, mo: number, d: number, h: number, mi: number) => new Date(y, mo - 1, d, h, mi).getTime()
const exists = (path: string) => stat(path).then(() => true, () => false)

test('journal.jsonl becomes one file per local day, in time order, and the original moves to legacy/', async () => {
  const rows = [
    { at: at(2026, 10, 25, 23, 58), q: 'ถามคืนวันที่ 25', a: 'ตอบ', ok: true },
    { at: at(2026, 10, 26, 9, 41), q: 'เช้า', a: 'สวัสดี', ok: true },
    { at: at(2026, 10, 26, 10, 2), q: 'พัง\nสองบรรทัด', a: 'error: no result', ok: false },
  ]
  const { home, options } = await oldHome({ 'journal.jsonl': jsonl(rows) })

  const result = await migrateHome(options)

  expect(result.ran).toBe(true)
  expect(result.journal).toEqual({ entries: 3, days: 2, skipped: 0 })
  expect(await readdir(join(home, 'journal'))).toEqual(['2026-10-25.md', '2026-10-26.md'])
  expect(parseJournal(await readFile(join(home, 'journal', '2026-10-26.md'), 'utf8'))).toEqual([
    { time: '09:41', q: 'เช้า', a: 'สวัสดี', ok: true },
    { time: '10:02', q: 'พัง สองบรรทัด', a: 'error: no result', ok: false },
  ])
  expect(await exists(join(home, 'journal.jsonl'))).toBe(false)
  expect(await readFile(join(home, 'legacy', 'journal.jsonl'), 'utf8')).toBe(jsonl(rows))
})

test('dreams.jsonl becomes one dream file per line, with the +/− memory changes and the undelivered flag', async () => {
  const first = at(2026, 10, 20, 4, 30)
  const rows = [
    {
      at: first, reason: 'ช่วงที่ปกติคุณไม่อยู่', took: 12_345, entries: 5, dream: 'ฝันถึงปลาทอง',
      insights: [{ q: 'หาที่เที่ยว', finding: 'ลอยกระทงเชียงใหม่' }], patterns: ['ใช้ช่วงตี 4'],
      added: ['ชอบกาแฟ'], removed: ['ไม่ชอบชา'],
      card: { kind: 'text', layout: 'list', icon: 'moon', title: 'Neo ฝันมาบอก', lines: ['บรรทัด 1'], items: [{ t: 'หัวข้อ', v: 'ค่า' }], emotion: 'happy', sounds: [], seconds: 15 },
      undelivered: true,
    },
    { at: first + 30_000, reason: 'อีกครั้ง', took: 1, entries: 1, dream: 'นาทีเดียวกัน', insights: [], patterns: [], card: { title: '', lines: [], items: [] } },
    'not an object',
  ]
  const { home, options } = await oldHome({ 'dreams.jsonl': jsonl(rows) })

  const result = await migrateHome(options)

  expect(result.dreams).toEqual({ count: 2, skipped: 1 })
  expect((await readdir(join(home, 'dreams'))).sort()).toEqual(['2026-10-20-0430-2.md', '2026-10-20-0430.md'])
  expect(parseDream(await readFile(join(home, 'dreams', '2026-10-20-0430.md'), 'utf8'))).toEqual({
    at: first, reason: 'ช่วงที่ปกติคุณไม่อยู่', took: 12_345, entries: 5, undelivered: true, dream: 'ฝันถึงปลาทอง',
    insights: [{ q: 'หาที่เที่ยว', finding: 'ลอยกระทงเชียงใหม่' }], patterns: ['ใช้ช่วงตี 4'], added: ['ชอบกาแฟ'], removed: ['ไม่ชอบชา'],
    card: { title: 'Neo ฝันมาบอก', lines: ['บรรทัด 1'], items: [{ t: 'หัวข้อ', v: 'ค่า' }] },
  })
  expect(parseDream(await readFile(join(home, 'dreams', '2026-10-20-0430-2.md'), 'utf8')).undelivered).toBe(false)
  expect(await exists(join(home, 'legacy', 'dreams.jsonl'))).toBe(true)
})

test('schedule.json becomes jobs.md: alarms and tasks, one-off and repeating, last fired kept', async () => {
  const alarm = at(2026, 10, 27, 5, 30)
  const old = [
    { id: 'a1b2c3d4', kind: 'alarm', title: 'ปลุกไปทำงาน', enabled: true, at: alarm },
    { id: 'e5f6g7h8', kind: 'task', title: 'สรุปข่าว', enabled: false, prompt: 'สรุปข่าววันนี้\nเน้นเศรษฐกิจ', cron: '30 7 * * 1-5', last: at(2026, 10, 26, 7, 30) },
    { id: 'bad00001', kind: 'task', title: 'cron พัง', enabled: true, prompt: 'x', cron: 'not a cron' },
    { id: 'bad00002', kind: 'alarm', title: 'ไม่มีเวลา', enabled: true },
    { id: 'a1b2c3d4', kind: 'alarm', title: 'id ซ้ำ', enabled: true, at: alarm },
  ]
  const { home, options } = await oldHome({ 'schedule.json': JSON.stringify(old, null, 1) })

  const result = await migrateHome(options)

  expect(result.jobs).toEqual({ count: 2, skipped: 3 })
  const parsed = parseJobs(await readFile(join(home, 'jobs.md'), 'utf8'))
  expect(parsed.problems).toEqual([])
  expect(parsed.jobs).toEqual([
    { id: 'a1b2c3d4', kind: 'alarm', title: 'ปลุกไปทำงาน', enabled: true, at: alarm, notes: [] },
    { id: 'e5f6g7h8', kind: 'task', title: 'สรุปข่าว', enabled: false, prompt: 'สรุปข่าววันนี้\nเน้นเศรษฐกิจ', cron: '30 7 * * 1-5', last: at(2026, 10, 26, 7, 30), notes: [] },
  ])
  expect(await exists(join(home, 'legacy', 'schedule.json'))).toBe(true)
})

test('an empty schedule.json writes no jobs.md but still moves to legacy/', async () => {
  const { home, options } = await oldHome({ 'schedule.json': '[]' })
  await migrateHome(options)
  expect(await exists(join(home, 'jobs.md'))).toBe(false)
  expect(await exists(join(home, 'legacy', 'schedule.json'))).toBe(true)
})

test('the legacy OpenRouter key is copied into NEO_HOME at 0600, apiKeyFile is rewritten, and the original stays', async () => {
  const { home, legacyConfig, options } = await oldHome({ 'schedule.json': '[]' })
  await writeFile(join(legacyConfig, 'openrouter.key'), 'sk-or-secret\n', { mode: 0o600 })
  await writeFile(join(home, 'providers.json'), JSON.stringify({
    default: 'claude',
    providers: {
      openrouter: { type: 'openai', apiKeyEnv: 'OPENROUTER_API_KEY', apiKeyFile: join(legacyConfig, 'openrouter.key') },
      other: { type: 'openai', apiKeyFile: '/somewhere/else.key' },
      claude: { command: 'claude' },
    },
  }, null, 2), { mode: 0o644 })

  const result = await migrateHome(options)

  expect(result.keys).toEqual(['openrouter.key'])
  const copy = join(home, 'openrouter.key')
  expect(await readFile(copy, 'utf8')).toBe('sk-or-secret\n')
  expect((await stat(copy)).mode & 0o777).toBe(0o600)
  expect(await readFile(join(legacyConfig, 'openrouter.key'), 'utf8')).toBe('sk-or-secret\n')
  const providers = JSON.parse(await readFile(join(home, 'providers.json'), 'utf8'))
  expect(providers.providers.openrouter).toEqual({ type: 'openai', apiKeyEnv: 'OPENROUTER_API_KEY', apiKeyFile: copy })
  expect(providers.providers.other.apiKeyFile).toBe('/somewhere/else.key')
  expect(providers.default).toBe('claude')
  expect((await stat(join(home, 'providers.json'))).mode & 0o777).toBe(0o644)
})

test('a key file that is missing leaves providers.json as it was', async () => {
  const { home, legacyConfig, options } = await oldHome({ 'schedule.json': '[]' })
  const text = JSON.stringify({ providers: { openrouter: { apiKeyFile: join(legacyConfig, 'openrouter.key') } } })
  await writeFile(join(home, 'providers.json'), text)
  const result = await migrateHome(options)
  expect(result.keys).toEqual([])
  expect(await readFile(join(home, 'providers.json'), 'utf8')).toBe(text)
})

test('claudeConfigDir is set to this Mac\'s path, other settings kept, and a dir already chosen is not replaced', async () => {
  const fresh = await oldHome({ 'schedule.json': '[]', 'state.json': JSON.stringify({ onboarded: true, pet: { hunger: 3 } }) })
  const result = await migrateHome(fresh.options)
  expect(result.claudeConfigDir).toBe('/Users/x/.ccs/instances/personal')
  expect(JSON.parse(await readFile(join(fresh.home, 'state.json'), 'utf8'))).toEqual({ onboarded: true, pet: { hunger: 3 }, claudeConfigDir: '/Users/x/.ccs/instances/personal' })
  expect((await stat(join(fresh.home, 'state.json'))).mode & 0o777).toBe(0o600)

  const chosen = await oldHome({ 'schedule.json': '[]', 'state.json': JSON.stringify({ claudeConfigDir: '/mine' }) })
  expect((await migrateHome(chosen.options)).claudeConfigDir).toBeNull()
  expect(JSON.parse(await readFile(join(chosen.home, 'state.json'), 'utf8')).claudeConfigDir).toBe('/mine')

  const none = await oldHome({ 'schedule.json': '[]' })
  await migrateHome(none.options)
  expect(JSON.parse(await readFile(join(none.home, 'state.json'), 'utf8'))).toEqual({ claudeConfigDir: '/Users/x/.ccs/instances/personal' })
})

test('a second run does nothing, and a home that was never old is left alone', async () => {
  const { home, options } = await oldHome({ 'journal.jsonl': jsonl([{ at: at(2026, 10, 26, 9, 0), q: 'q', a: 'a', ok: true }]), 'devices.json': '{"abc":{}}' })
  await migrateHome(options)
  const after = await Promise.all(['journal/2026-10-26.md', 'state.json', 'devices.json'].map(f => readFile(join(home, f), 'utf8')))
  const again = await migrateHome(options)
  expect(again.ran).toBe(false)
  expect(await Promise.all(['journal/2026-10-26.md', 'state.json', 'devices.json'].map(f => readFile(join(home, f), 'utf8')))).toEqual(after)
  expect(await readdir(join(home, 'legacy'))).toEqual(['journal.jsonl'])

  const modern = await oldHome({ 'devices.json': '{}' })
  expect((await migrateHome(modern.options)).ran).toBe(false)
  expect(await readdir(modern.home)).toEqual(['devices.json'])
})
