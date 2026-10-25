// Ticket 04 end to end: neo say / neo cancel / neo events against a real daemon core, a real socket and the fake `claude`.
import { afterEach, expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
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

async function running(env: Record<string, string> = {}) {
  const { dir, cleanup } = await tempHome()
  cleanups.push(cleanup)
  const clock = new FakeClock()
  const core = await createCore({
    home: dir, clock, pid: 1,
    env: { PATH: `${FAKE_BIN}:${process.env.PATH}`, FAKE_CLAUDE_LOG: join(dir, 'calls.jsonl'), FAKE_CLAUDE_PIDS: join(dir, 'pids'), ...env },
  })
  const server = await startCommandServer({ core, clock, home: dir })
  cleanups.unshift(() => server.stop())
  return { dir, core }
}

async function neo(dir: string, args: string[], signal?: AbortSignal) {
  const out: string[] = []
  const err: string[] = []
  const code = await runCli([...args, '--home', dir], { out: t => void out.push(t), err: t => void err.push(t), env: {}, signal })
  return { code, stdout: out.join(''), stderr: err.join('') }
}

/** `neo events --json` running in the background; `lines` fills as events arrive. */
function watch(dir: string) {
  const abort = new AbortController()
  const lines: any[] = []
  const done = runCli(['events', '--json', '--home', dir], {
    out: t => void lines.push(...t.split('\n').filter(Boolean).map(l => JSON.parse(l))), err() {}, env: {}, signal: abort.signal,
  })
  const poll = async (match: (e: any) => boolean) => {
    for (let i = 0; i < 200; i++) {
      const hit = lines.find(match)
      if (hit) return hit
      await Bun.sleep(20)
    }
    throw new Error('event never arrived')
  }
  return { abort, done, lines, poll }
}

const SETTLE_MS = 150

async function eventsOf(dir: string, run: () => Promise<unknown>) {
  const watcher = watch(dir)
  await Bun.sleep(SETTLE_MS) // let the stream attach
  await run()
  await Bun.sleep(SETTLE_MS) // and deliver the last event
  watcher.abort.abort()
  await watcher.done
  return watcher.lines
}

test('neo say prints a humanized card; neo events shows thinking → tool → card', async () => {
  const { dir } = await running()
  let said!: Awaited<ReturnType<typeof neo>>
  const events = await eventsOf(dir, async () => { said = await neo(dir, ['say', 'นีโอ ข่าววันนี้มีอะไร']) })
  expect(said.code).toBe(0)
  expect(said.stderr).toBe('')
  expect(said.stdout).toContain('# คำตอบ') // "**คำตอบ**" with its markdown stripped
  expect(said.stdout).toContain('ตอบ: ข่าววันนี้มีอะไร')
  expect(said.stdout).toContain('ที่มา BBC') // the link became its text
  expect(said.stdout).not.toContain('https://')

  const types = events.map(e => e.type).filter(t => t !== 'status' && t !== 'changed')
  expect(types).toEqual(['heard', 'thinking', 'session', 'tool', 'card'])
  expect(events.find(e => e.type === 'tool')).toMatchObject({ name: 'WebSearch' })
  expect(events.find(e => e.type === 'card').card).toMatchObject({ title: 'คำตอบ', icon: 'search' })
})

test('neo say --json prints the SayResult; golden fixtures for the Swift/Kotlin decoders', async () => {
  const { dir } = await running()
  let said!: Awaited<ReturnType<typeof neo>>
  const events = await eventsOf(dir, async () => { said = await neo(dir, ['say', 'นีโอ ข่าววันนี้มีอะไร', '--json']) })
  const result = JSON.parse(said.stdout)
  expect(result).toMatchObject({ outcome: 'card', card: { title: 'คำตอบ' } })
  await golden('say-card', result)
  for (const type of ['heard', 'thinking', 'session', 'tool', 'card']) await golden(`event-${type}`, events.find(e => e.type === type))
})

test('a skill intent prints the confirm question and exits 0; "ตกลง" runs it', async () => {
  const { dir } = await running()
  const ask = await neo(dir, ['say', 'นีโอ @skill เช็ค jenkins'])
  expect(ask.code).toBe(0)
  expect(ask.stdout).toContain('# ใช้ jenkins?')
  expect(ask.stdout).toContain('พูด “ตกลง” เพื่อทำ หรือ “ยกเลิก”')
  const run = await neo(dir, ['say', 'ตกลง'])
  expect(run.code).toBe(0)
  expect(run.stdout).toContain('# ทำเสร็จแล้ว')
  expect(run.stdout).toContain('build ล่าสุดผ่านหมด')
  const calls = (await readFile(join(dir, 'calls.jsonl'), 'utf8')).split('\n').filter(Boolean).map(l => JSON.parse(l))
  expect(calls.at(-1).args).toContain('sonnet')
})

test('--no-wait returns at once; the card still arrives as an event', async () => {
  const { dir } = await running()
  const watcher = watch(dir)
  await Bun.sleep(100)
  const said = await neo(dir, ['say', 'นีโอ ข่าววันนี้', '--no-wait', '--json'])
  expect(JSON.parse(said.stdout)).toEqual({ outcome: 'accepted' })
  expect((await watcher.poll(e => e.type === 'card')).card.title).toBe('คำตอบ')
  watcher.abort.abort()
  await watcher.done
})

const alive = (pid: number) => {
  try { process.kill(pid, 0); return true } catch { return false }
}

test('neo cancel during a run emits cancelled, unblocks neo say, and kills the claude process group', async () => {
  const { dir, core } = await running()
  const watcher = watch(dir)
  await Bun.sleep(100)
  const said = neo(dir, ['say', 'นีโอ @hang รอหน่อย'])
  await watcher.poll(e => e.type === 'thinking')
  expect(core.status().thinking).toBe(true)
  let written = ''
  for (let i = 0; i < 100 && !written.includes(' '); i++) {
    await Bun.sleep(50)
    written = await readFile(join(dir, 'pids'), 'utf8').catch(() => '')
  }
  const pids = written.split(' ').map(Number) as [number, number]
  expect(pids.every(alive)).toBe(true)

  const cancelled = await neo(dir, ['cancel'])
  expect(cancelled.code).toBe(0)
  expect(cancelled.stdout).toContain('ยกเลิกแล้ว')
  await watcher.poll(e => e.type === 'cancelled')
  const result = await said
  expect(result.code).toBe(1)
  expect(result.stderr).toContain('ยกเลิกแล้ว')
  expect(core.status().thinking).toBe(false)
  for (let i = 0; i < 60 && pids.some(alive); i++) await Bun.sleep(50)
  expect(pids.some(alive)).toBe(false)
  await golden('event-cancelled', await watcher.poll(e => e.type === 'cancelled'))
  watcher.abort.abort()
  await watcher.done
})

test('neo cancel with nothing running says so and exits 0', async () => {
  const { dir } = await running()
  const result = await neo(dir, ['cancel', '--json'])
  expect(result.code).toBe(0)
  expect(JSON.parse(result.stdout)).toEqual({ cancelled: false })
})

test('a failing claude is reported on stderr with exit 1 and as an askerr event', async () => {
  const { dir } = await running()
  const events = await eventsOf(dir, async () => {
    const said = await neo(dir, ['say', 'นีโอ @crash'])
    expect(said.code).toBe(1)
    expect(said.stderr).toContain('Neo ตอบไม่ได้: no result')
    const json = await neo(dir, ['say', 'นีโอ @crash', '--json'])
    expect(JSON.parse(json.stdout)).toEqual({ error: 'Neo ตอบไม่ได้: no result', code: 1 })
  })
  expect(events.find(e => e.type === 'askerr')).toMatchObject({ error: 'no result' })
  await golden('event-askerr', events.find(e => e.type === 'askerr'))
})

test('speech without the name is heard but not answered (same rules as the microphone)', async () => {
  const { dir } = await running()
  const said = await neo(dir, ['say', 'ข่าววันนี้มีอะไร'])
  expect(said.code).toBe(1)
  expect(said.stderr).toContain('requireName')
  const armed = await neo(dir, ['say', 'นีโอ'])
  expect(armed.code).toBe(0)
  expect(armed.stdout).toContain('พร้อมฟัง')
})

test('usage: neo say needs text', async () => {
  const { dir } = await running()
  expect((await neo(dir, ['say'])).code).toBe(2)
})
