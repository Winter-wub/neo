import { afterEach, expect, test } from 'bun:test'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { FakeClock, tempHome } from '../../../test/helpers'
import type { NeoEvent } from '../../protocol'
import { createEvents } from '../events/events'
import { MemoryConflict, MemoryError, MemoryNotFound, createMemory } from './memory'

const cleanups: Array<() => Promise<unknown>> = []
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map(c => c()))
})

async function setup() {
  const { dir, cleanup } = await tempHome()
  const clock = new FakeClock(new Date(2026, 9, 26, 9, 41, 0).getTime())
  const events = createEvents({ clock })
  const log: NeoEvent[] = []
  events.subscribe(e => void log.push(e))
  const memory = createMemory({ home: dir, clock, events })
  cleanups.push(async () => {
    memory.close()
    await cleanup()
  })
  return { dir, clock, memory, log }
}

const until = async (check: () => boolean) => {
  for (let i = 0; i < 100 && !check(); i++) await Bun.sleep(20)
  expect(check()).toBe(true)
}

test('no file yet: empty memory, and the context is empty text', async () => {
  const { memory } = await setup()
  expect(memory.doc()).toMatchObject({ text: '', items: [] })
  expect(memory.context()).toBe('')
})

test('add appends an item, the context sees it at once, and the file is 0600 markdown', async () => {
  const { memory, dir } = await setup()
  memory.add('ชอบกาแฟดำ', 'ชอบ')
  expect(memory.context()).toBe('## ชอบ\n- ชอบกาแฟดำ\n')
  expect(await readFile(join(dir, 'memory.md'), 'utf8')).toBe('## ชอบ\n- ชอบกาแฟดำ\n')
  expect(((await Bun.file(join(dir, 'memory.md')).stat()).mode & 0o777).toString(8)).toBe('600')
  expect(memory.doc().items).toEqual([{ section: 'ชอบ', text: 'ชอบกาแฟดำ' }])
})

test('an edit made in an editor takes effect on the next read', async () => {
  const { memory, dir } = await setup()
  await writeFile(join(dir, 'memory.md'), '## งาน\n- ใช้ Jira\n')
  expect(memory.context()).toContain('ใช้ Jira')
})

test('save is conflict-checked: a stale version is refused and the file is untouched', async () => {
  const { memory, dir } = await setup()
  memory.add('a')
  const seen = memory.doc().version
  await writeFile(join(dir, 'memory.md'), '## x\n- changed outside\n')
  expect(() => memory.save('## mine\n- mine\n', seen)).toThrow(MemoryConflict)
  expect(await readFile(join(dir, 'memory.md'), 'utf8')).toBe('## x\n- changed outside\n')
  const saved = memory.save('## mine\n- mine\n', memory.doc().version)
  expect(saved.items).toEqual([{ section: 'mine', text: 'mine' }])
})

test('save refuses a document over 6000 characters', async () => {
  const { memory } = await setup()
  expect(() => memory.save('x'.repeat(6001), memory.doc().version)).toThrow(MemoryError)
})

test('forget: one match is removed; several are listed and refused unless all; none is not-found', async () => {
  const { memory } = await setup()
  memory.save('## a\n- ชาเขียว\n- ชานม\n- กาแฟ\n', memory.doc().version)
  expect(() => memory.forget('กาแฟร้อน')).toThrow(MemoryNotFound)
  try {
    memory.forget('ชา')
    throw new Error('should have thrown')
  } catch (e) {
    expect(e).toBeInstanceOf(MemoryConflict)
    expect((e as Error).message).toContain('ชาเขียว')
    expect((e as Error).message).toContain('ชานม')
    expect((e as Error).message).toContain('--all')
  }
  expect(memory.doc().items).toHaveLength(3)
  expect(memory.forget('กาแฟ')).toEqual([{ section: 'a', text: 'กาแฟ' }])
  expect(memory.forget('ชา', { all: true })).toHaveLength(2)
  expect(memory.doc().items).toEqual([])
})

test('clear empties memory', async () => {
  const { memory } = await setup()
  memory.add('a')
  memory.add('b')
  expect(memory.clear()).toBe(2)
  expect(memory.doc().text).toBe('')
})

test('record appends to today\'s journal file, creating it; a failed turn is marked', async () => {
  const { memory, dir, clock } = await setup()
  memory.record({ q: 'ข่าววันนี้', a: 'มีข่าวดี', ok: true })
  clock.advance(60_000)
  memory.record({ q: 'ฝนตกไหม', a: 'ขัดข้อง', ok: false })
  const file = await readFile(join(dir, 'journal', '2026-10-26.md'), 'utf8')
  expect(file).toBe('# 2026-10-26\n\n## 09:41\n- Q: ข่าววันนี้\n- A: มีข่าวดี\n\n## 09:42 ✗\n- Q: ฝนตกไหม\n- A: ขัดข้อง\n')
  expect(memory.days()).toEqual([{ day: '2026-10-26', entries: 2 }])
  expect(memory.show()).toMatchObject({ day: '2026-10-26', entries: [
    { day: '2026-10-26', time: '09:41', q: 'ข่าววันนี้', a: 'มีข่าวดี', ok: true },
    { day: '2026-10-26', time: '09:42', ok: false },
  ] })
})

test('a question with no text is not recorded', async () => {
  const { memory } = await setup()
  memory.record({ q: '  ', a: 'x', ok: true })
  expect(memory.days()).toEqual([])
})

test('days lists newest first; show takes a day, today or yesterday; bad days are errors', async () => {
  const { memory, dir } = await setup()
  await mkdir(join(dir, 'journal'), { recursive: true })
  await writeFile(join(dir, 'journal', '2026-10-25.md'), '# 2026-10-25\n\n## 20:00\n- Q: เมื่อวาน\n- A: ok\n')
  memory.record({ q: 'วันนี้', a: 'ok', ok: true })
  expect(memory.days().map(d => d.day)).toEqual(['2026-10-26', '2026-10-25'])
  expect(memory.show('yesterday').entries[0]!.q).toBe('เมื่อวาน')
  expect(memory.show('2026-10-25').day).toBe('2026-10-25')
  expect(memory.show('2020-01-01')).toMatchObject({ text: '', entries: [] })
  expect(() => memory.show('26/10/2026')).toThrow(MemoryError)
  expect(() => memory.show('2026-13-45')).toThrow(MemoryError)
})

test('saving a journal day is conflict-checked, and an empty text deletes the day', async () => {
  const { memory, dir } = await setup()
  memory.record({ q: 'a', a: 'b', ok: true })
  const seen = memory.show('today').version
  memory.record({ q: 'c', a: 'd', ok: true }) // changed meanwhile
  expect(() => memory.saveDay('2026-10-26', '# x\n', seen)).toThrow(MemoryConflict)
  const now = memory.show('today')
  expect(memory.saveDay('2026-10-26', '', now.version)).toMatchObject({ entries: [] })
  expect(await readdir(join(dir, 'journal'))).toEqual([])
})

test('journal forget: by text in the question or the answer, across days; several need all', async () => {
  const { memory, clock } = await setup()
  memory.record({ q: 'ราคาทอง', a: 'x', ok: true })
  clock.advance(24 * 3600_000)
  memory.record({ q: 'ราคาน้ำมัน', a: 'ทองคำ', ok: true })
  memory.record({ q: 'ฝนตกไหม', a: 'ไม่ตก', ok: true })
  expect(() => memory.forgetEntries('ทอง')).toThrow(MemoryConflict)
  expect(() => memory.forgetEntries('ไม่มีแน่')).toThrow(MemoryNotFound)
  expect(memory.forgetEntries('ฝนตก').map(e => e.q)).toEqual(['ฝนตกไหม'])
  expect(memory.forgetEntries('ทอง', { all: true })).toHaveLength(2)
  expect(memory.days()).toEqual([]) // both day files had nothing left
})

test('journal clear removes every day', async () => {
  const { memory, clock } = await setup()
  memory.record({ q: 'a', a: 'b', ok: true })
  clock.advance(24 * 3600_000)
  memory.record({ q: 'c', a: 'd', ok: true })
  expect(memory.clearJournal()).toBe(2)
  expect(memory.days()).toEqual([])
})

test('our own writes publish a changed event; an outside edit publishes one too, once', async () => {
  const { memory, dir, log } = await setup()
  memory.add('a')
  memory.record({ q: 'q', a: 'a', ok: true })
  const mine = () => log.filter(e => e.type === 'changed')
  expect(mine()).toMatchObject([{ file: 'memory' }, { file: 'journal', day: '2026-10-26' }])
  await Bun.sleep(150) // the watcher sees our writes and stays quiet
  expect(mine()).toHaveLength(2)

  await writeFile(join(dir, 'memory.md'), '## x\n- edited\n')
  await until(() => mine().length === 3)
  await writeFile(join(dir, 'journal', '2026-10-26.md'), '# 2026-10-26\n')
  await until(() => mine().length === 4)
  expect(mine().at(-1)).toMatchObject({ file: 'journal', day: '2026-10-26' })
  await Bun.sleep(150)
  expect(mine()).toHaveLength(4)
})
