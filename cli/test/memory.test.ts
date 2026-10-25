// Ticket 11 end to end: neo memory / neo journal against a real daemon core, a real socket and the fake `claude`.
import { afterEach, expect, test } from 'bun:test'
import { chmod, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { runCli } from '../src/adapters/command/cli'
import { startCommandServer } from '../src/adapters/command/server'
import { createCore } from '../src/core/core'
import { FakeClock, golden, tempHome } from './helpers'

const FAKE_BIN = join(import.meta.dir, 'fake-bin')
const cleanups: Array<() => Promise<unknown>> = []
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map(c => c()))
})

async function running() {
  const { dir, cleanup } = await tempHome()
  cleanups.push(cleanup)
  // 2026-10-26 09:41 local, so journal file names are known
  const clock = new FakeClock(new Date(2026, 9, 26, 9, 41, 0).getTime())
  const core = await createCore({
    home: dir, clock, pid: 1,
    env: { PATH: `${FAKE_BIN}:${process.env.PATH}`, FAKE_CLAUDE_LOG: join(dir, 'calls.jsonl') },
  })
  const server = await startCommandServer({ core, clock, home: dir })
  cleanups.unshift(async () => {
    core.memory.close()
    await server.stop()
  })
  return { dir, core, clock }
}

async function neo(dir: string, args: string[], env: Record<string, string> = {}) {
  const out: string[] = []
  const err: string[] = []
  const code = await runCli([...args, '--home', dir], { out: t => void out.push(t), err: t => void err.push(t), env })
  return { code, stdout: out.join(''), stderr: err.join('') }
}

/** An $EDITOR that runs a shell snippet on the file ($1). */
async function editor(dir: string, body: string) {
  const file = join(dir, `editor-${Math.random().toString(36).slice(2, 7)}.sh`)
  await writeFile(file, `#!/bin/sh\n${body}\n`)
  await chmod(file, 0o755)
  return file
}

const prompts = async (dir: string) => (await readFile(join(dir, 'calls.jsonl'), 'utf8')).split('\n').filter(Boolean).map(l => JSON.parse(l).prompt as string)

test('an item added with neo memory add is in the context of the next ask, and the answered turn lands in today\'s journal', async () => {
  const { dir } = await running()
  const added = await neo(dir, ['memory', 'add', 'ชอบกาแฟดำ', '--section', 'ชอบ'])
  expect(added.code).toBe(0)
  expect(added.stdout).toContain('ชอบกาแฟดำ')

  const said = await neo(dir, ['say', 'นีโอ ข่าววันนี้มีอะไร'])
  expect(said.code).toBe(0)
  const [prompt] = await prompts(dir)
  expect(prompt).toContain('สิ่งที่คุณจำได้เกี่ยวกับผู้ใช้')
  expect(prompt).toContain('## ชอบ\n- ชอบกาแฟดำ')

  const journal = await readFile(join(dir, 'journal', '2026-10-26.md'), 'utf8')
  expect(journal).toStartWith('# 2026-10-26\n\n## 09:41\n- Q: ข่าววันนี้มีอะไร\n- A: คำตอบ')
  const shown = await neo(dir, ['journal', 'show'])
  expect(shown.stdout).toContain('- Q: ข่าววันนี้มีอะไร')
  const listed = await neo(dir, ['journal', 'list'])
  expect(listed.stdout).toContain('2026-10-26')
  expect(listed.stdout).toContain('1 รายการ')
})

test('a failed ask is journaled with ✗', async () => {
  const { dir } = await running()
  expect((await neo(dir, ['say', 'นีโอ @crash'])).code).toBe(1)
  expect(await readFile(join(dir, 'journal', '2026-10-26.md'), 'utf8')).toContain('## 09:41 ✗\n- Q: @crash')
})

test('memory show: markdown, --json, and an empty hint', async () => {
  const { dir } = await running()
  expect((await neo(dir, ['memory', 'show'])).stdout).toContain('ยังไม่มีความจำ')
  await neo(dir, ['memory', 'add', 'ใช้ Jira', '--section', 'งาน'])
  expect((await neo(dir, ['memory', 'show'])).stdout).toBe('## งาน\n- ใช้ Jira\n\n')
  const json = JSON.parse((await neo(dir, ['memory', 'show', '--json'])).stdout)
  expect(json).toMatchObject({ text: '## งาน\n- ใช้ Jira\n', items: [{ section: 'งาน', text: 'ใช้ Jira' }] })
  await golden('memory-doc', json)
})

test('memory forget: one match goes; several are listed with exit 1 unless --all; none exits 1', async () => {
  const { dir } = await running()
  for (const item of ['ชาเขียว', 'ชานม', 'กาแฟ']) await neo(dir, ['memory', 'add', item])
  const many = await neo(dir, ['memory', 'forget', 'ชา'])
  expect(many.code).toBe(1)
  expect(many.stderr).toContain('ชาเขียว')
  expect(many.stderr).toContain('ชานม')
  expect(many.stderr).not.toContain('กาแฟ')
  expect(many.stderr).toContain('--all')
  expect(JSON.parse((await neo(dir, ['memory', 'show', '--json'])).stdout).items).toHaveLength(3)

  const one = await neo(dir, ['memory', 'forget', 'กาแฟ', '--json'])
  expect(one.code).toBe(0)
  const removed = JSON.parse(one.stdout)
  expect(removed).toEqual({ removed: [{ section: 'อื่น ๆ', text: 'กาแฟ' }] })
  await golden('memory-forget', removed)

  expect((await neo(dir, ['memory', 'forget', 'ชา', '--all'])).code).toBe(0)
  expect(JSON.parse((await neo(dir, ['memory', 'show', '--json'])).stdout).items).toEqual([])
  expect((await neo(dir, ['memory', 'forget', 'ไม่มีแน่'])).code).toBe(1)
})

test('memory clear empties it', async () => {
  const { dir } = await running()
  await neo(dir, ['memory', 'add', 'a'])
  const cleared = await neo(dir, ['memory', 'clear', '--json'])
  expect(JSON.parse(cleared.stdout)).toEqual({ removed: 1 })
  expect(await readFile(join(dir, 'memory.md'), 'utf8')).toBe('')
})

test('memory edit opens $EDITOR on a copy and saves what you wrote', async () => {
  const { dir } = await running()
  await neo(dir, ['memory', 'add', 'เดิม', '--section', 'a'])
  const ed = await editor(dir, `printf -- '- เพิ่มใน editor\\n' >> "$1"`)
  const edited = await neo(dir, ['memory', 'edit'], { EDITOR: ed })
  expect(edited.code).toBe(0)
  expect(await readFile(join(dir, 'memory.md'), 'utf8')).toBe('## a\n- เดิม\n- เพิ่มใน editor\n')
  const same = await neo(dir, ['memory', 'edit'], { EDITOR: 'true' })
  expect(same.code).toBe(0)
  expect(same.stdout).toContain('ไม่มีการเปลี่ยนแปลง')
})

test('memory edit refuses to save when the file changed meanwhile, and keeps your edit on disk', async () => {
  const { dir } = await running()
  await neo(dir, ['memory', 'add', 'เดิม', '--section', 'a'])
  const ed = await editor(dir, `printf -- '- ของฉัน\\n' >> "$1"\nprintf '## a\\n- คนอื่นแก้\\n' > "${join(dir, 'memory.md')}"`)
  const edited = await neo(dir, ['memory', 'edit'], { EDITOR: ed })
  expect(edited.code).toBe(1)
  expect(edited.stderr).toContain('ถูกแก้ไประหว่างที่คุณแก้')
  expect(await readFile(join(dir, 'memory.md'), 'utf8')).toBe('## a\n- คนอื่นแก้\n')
  const kept = /(\/\S+memory\.md)/.exec(edited.stderr)?.[1]
  expect(kept).toBeDefined()
  expect(await readFile(kept!, 'utf8')).toContain('- ของฉัน')
})

test('a failing editor saves nothing', async () => {
  const { dir } = await running()
  await neo(dir, ['memory', 'add', 'เดิม'])
  const ed = await editor(dir, `echo junk >> "$1"\nexit 3`)
  const edited = await neo(dir, ['memory', 'edit'], { EDITOR: ed })
  expect(edited.code).toBe(1)
  expect(await readFile(join(dir, 'memory.md'), 'utf8')).toBe('## อื่น ๆ\n- เดิม\n')
})

test('journal: list, show a day, edit, forget, clear', async () => {
  const { dir, clock } = await running()
  await neo(dir, ['say', 'นีโอ ราคาทอง'])
  clock.advance(24 * 3600_000)
  await neo(dir, ['say', 'นีโอ ราคาน้ำมัน'])
  await neo(dir, ['say', 'นีโอ ฝนตกไหม'])

  const list = await neo(dir, ['journal', 'list', '--json'])
  const days = JSON.parse(list.stdout)
  expect(days).toEqual([{ day: '2026-10-27', entries: 2 }, { day: '2026-10-26', entries: 1 }])
  await golden('journal-list', days)

  const day = await neo(dir, ['journal', 'show', '2026-10-26', '--json'])
  const doc = JSON.parse(day.stdout)
  expect(doc).toMatchObject({ day: '2026-10-26', entries: [{ time: '09:41', q: 'ราคาทอง', ok: true }] })
  await golden('journal-doc', doc)
  expect((await neo(dir, ['journal', 'show', 'yesterday'])).stdout).toContain('ราคาทอง')
  expect((await neo(dir, ['journal', 'show', '2020-01-01'])).stdout).toContain('ไม่มีบันทึก')
  expect((await neo(dir, ['journal', 'show', 'วันนั้น'])).code).toBe(1)

  const ed = await editor(dir, `sed -i.bak 's/ราคาทอง/ราคาทองคำ/' "$1"`)
  expect((await neo(dir, ['journal', 'edit', '2026-10-26'], { EDITOR: ed })).code).toBe(0)
  expect(await readFile(join(dir, 'journal', '2026-10-26.md'), 'utf8')).toContain('- Q: ราคาทองคำ')
  expect((await neo(dir, ['journal', 'edit', '2020-01-01'], { EDITOR: 'true' })).code).toBe(1)

  const many = await neo(dir, ['journal', 'forget', 'ราคา'])
  expect(many.code).toBe(1)
  expect(many.stderr).toContain('ราคาทองคำ')
  expect(many.stderr).toContain('ราคาน้ำมัน')
  const one = await neo(dir, ['journal', 'forget', 'ฝนตก', '--json'])
  expect(one.code).toBe(0)
  expect(JSON.parse(one.stdout)).toMatchObject({ removed: [{ day: '2026-10-27', q: 'ฝนตกไหม' }] })
  await golden('journal-forget', JSON.parse(one.stdout))
  expect(JSON.parse((await neo(dir, ['journal', 'forget', 'ราคา', '--all', '--json'])).stdout).removed).toHaveLength(2)

  await neo(dir, ['say', 'นีโอ อีกครั้ง'])
  expect(JSON.parse((await neo(dir, ['journal', 'clear', '--json'])).stdout)).toEqual({ removed: 1 })
  expect(JSON.parse((await neo(dir, ['journal', 'list', '--json'])).stdout)).toEqual([])
})

test('neo events reports a changed file, including an edit made outside neo', async () => {
  const { dir } = await running()
  const abort = new AbortController()
  const lines: any[] = []
  const done = runCli(['events', '--json', '--home', dir], {
    out: t => void lines.push(...t.split('\n').filter(Boolean).map(l => JSON.parse(l))), err() {}, env: {}, signal: abort.signal,
  })
  await Bun.sleep(150)
  await writeFile(join(dir, 'memory.md'), '## x\n- edited in an editor\n')
  for (let i = 0; i < 100 && !lines.some(e => e.type === 'changed'); i++) await Bun.sleep(20)
  const changed = lines.find(e => e.type === 'changed')
  expect(changed).toMatchObject({ type: 'changed', file: 'memory' })
  await golden('event-changed', changed)
  expect((await neo(dir, ['say', 'นีโอ ข่าว'])).code).toBe(0)
  const journaled = () => lines.some(e => e.type === 'changed' && e.file === 'journal' && e.day === '2026-10-26')
  for (let i = 0; i < 100 && !journaled(); i++) await Bun.sleep(20)
  expect(journaled()).toBe(true)
  // the edit is in the next ask's context
  expect((await prompts(dir)).at(-1)).toContain('edited in an editor')
  abort.abort()
  await done
})

test('usage', async () => {
  const { dir } = await running()
  expect((await neo(dir, ['memory'])).code).toBe(2)
  expect((await neo(dir, ['memory', 'add'])).code).toBe(2)
  expect((await neo(dir, ['memory', 'forget'])).code).toBe(2)
  expect((await neo(dir, ['memory', 'show', '--all'])).code).toBe(2)
  expect((await neo(dir, ['memory', 'add', 'x', '--all'])).code).toBe(2)
  expect((await neo(dir, ['journal', 'edit'])).code).toBe(2)
  expect((await neo(dir, ['journal', 'bogus'])).code).toBe(2)
})
