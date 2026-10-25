// Ticket 12 end to end: neo dream … against a real core, a real socket, the phone port and the fake `claude`; the clock is fake.
import { afterEach, expect, test } from 'bun:test'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { runCli } from '../src/adapters/command/cli'
import { startCommandServer } from '../src/adapters/command/server'
import { startPhoneServer } from '../src/adapters/phone/server'
import { createCore } from '../src/core/core'
import type { StreamLine } from '../src/protocol'
import { FakeClock, golden, tempHome } from './helpers'

const FAKE_BIN = join(import.meta.dir, 'fake-bin')
const cleanups: Array<() => Promise<unknown>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

async function running() {
  const { dir, cleanup } = await tempHome()
  // 2026-10-25 22:00 local
  const clock = new FakeClock(new Date(2026, 9, 25, 22, 0, 0).getTime())
  const core = await createCore({
    home: dir, clock, pid: 1,
    env: { HOME: dir, PATH: `${FAKE_BIN}:${process.env.PATH}`, FAKE_CLAUDE_LOG: join(dir, 'calls.jsonl') },
  })
  const server = await startCommandServer({ core, clock, home: dir })
  const phone = await startPhoneServer({ core, clock, port: 0, apkPath: join(dir, 'neo.apk'), networks: () => [], tailscale: async () => null })
  cleanups.push(cleanup, () => core.stop(), () => server.stop(), () => phone.stop(), () => core.devices.flush())
  const base = `http://127.0.0.1:${phone.port}`
  const { code } = core.devices.startPairing()
  const { token } = (await (await fetch(`${base}/api/pair`, { method: 'POST', body: JSON.stringify({ code, name: 'A7' }) })).json()) as { token: string }
  const auth = { authorization: `Bearer ${token}` }

  /** A phone connecting to /api/events: the lines until `count` have arrived (or 300 ms of quiet), then hangs up. */
  async function connect(): Promise<StreamLine[]> {
    const abort = new AbortController()
    const res = await fetch(`${base}/api/events`, { headers: auth, signal: abort.signal })
    const reader = res.body!.getReader()
    const decoder = new TextDecoder()
    const lines: StreamLine[] = []
    let buffer = ''
    const deadline = Date.now() + 300
    while (Date.now() < deadline) {
      const chunk = await Promise.race([reader.read(), Bun.sleep(100).then(() => null)])
      if (!chunk) continue
      if (chunk.done) break
      buffer += decoder.decode(chunk.value, { stream: true })
      for (let nl = buffer.indexOf('\n'); nl >= 0; nl = buffer.indexOf('\n')) {
        lines.push(JSON.parse(buffer.slice(0, nl)))
        buffer = buffer.slice(nl + 1)
      }
    }
    abort.abort()
    return lines
  }
  const seen = () => fetch(`${base}/api/dream/seen`, { method: 'POST', headers: auth, body: '{}' })
  return { dir, core, clock, connect, seen }
}

async function neo(dir: string, args: string[]) {
  const out: string[] = []
  const err: string[] = []
  const code = await runCli([...args, '--home', dir], { out: t => void out.push(t), err: t => void err.push(t), env: {} })
  return { code, stdout: out.join(''), stderr: err.join('') }
}

const dreamFiles = async (dir: string) => (await readdir(join(dir, 'dreams')).catch(() => [])).sort()

test('neo dream now writes a dream file and changes memory.md as the dream said', async () => {
  const { dir } = await running()
  await neo(dir, ['memory', 'add', 'ชอบกาแฟ', '--section', 'ผู้ใช้'])
  expect((await neo(dir, ['say', 'นีโอ ฝนตกไหม'])).code).toBe(0)

  const done = await neo(dir, ['dream', 'now'])
  expect(done.code).toBe(0)
  expect(done.stdout).toContain('ฝันถึงปลาทอง')
  expect(await dreamFiles(dir)).toEqual(['2026-10-25-2200.md'])
  expect(await readFile(join(dir, 'memory.md'), 'utf8')).toBe('## ผู้ใช้\n- ชอบแมวทดสอบระบบ\n- ทำงานด้านสัญญาหลังบ้าน\n')
  const file = await readFile(join(dir, 'dreams', '2026-10-25-2200.md'), 'utf8')
  expect(file).toContain('- + ชอบแมวทดสอบระบบ')
  expect(file).toContain('- − ชอบกาแฟ')

  // the dream's prompt carried the memory and the journal turn
  const calls = (await readFile(join(dir, 'calls.jsonl'), 'utf8')).split('\n').filter(Boolean).map(l => JSON.parse(l).prompt as string)
  const prompt = calls.find(p => p.includes('memory defragmentation'))!
  expect(prompt).toContain('- ชอบกาแฟ')
  expect(prompt).toContain('ฝนตกไหม')

  const list = await neo(dir, ['dream', 'list'])
  expect(list.stdout).toContain('2026-10-25-2200')
  expect(list.stdout).toContain('ยังไม่ได้เล่าให้มือถือ')
  expect((await neo(dir, ['dream', 'show'])).stdout).toContain('## Memory changes')
  expect((await neo(dir, ['dream', 'show', '2026-10-25-2200'])).stdout).toContain('# ฝันถึงปลาทอง')
})

test('neo memory show marks the items a dream added', async () => {
  const { dir } = await running()
  await neo(dir, ['say', 'นีโอ ฝนตกไหม'])
  await neo(dir, ['dream', 'now'])
  const shown = await neo(dir, ['memory', 'show'])
  expect(shown.stdout).toContain('- ชอบแมวทดสอบระบบ  ← ฝัน 2026-10-25-2200')
  const json = JSON.parse((await neo(dir, ['memory', 'show', '--json'])).stdout)
  expect(json.items[0]).toMatchObject({ text: 'ชอบแมวทดสอบระบบ', from: { id: '2026-10-25-2200', dream: 'ฝันถึงปลาทอง' } })
})

test('a dream nobody has seen is re-sent after hello on every connect until dream/seen, then never again', async () => {
  const { dir, connect, seen } = await running()
  await neo(dir, ['say', 'นีโอ ฝนตกไหม'])
  await neo(dir, ['dream', 'now'])
  for (let i = 0; i < 2; i++) {
    const lines = await connect()
    expect(lines.slice(0, 2).map(l => l.type)).toEqual(['hello', 'dream_done'])
    expect(lines[1]).toMatchObject({ card: { dream: true, title: 'ฝันแล้ว', lines: expect.arrayContaining(['ฝันถึงปลาทอง']) }, at: expect.any(Number) })
  }
  const response = await seen()
  expect(await response.json()).toEqual({ ok: true })
  expect((await connect()).map(l => l.type)).not.toContain('dream_done')
  expect(await readFile(join(dir, 'dreams', '2026-10-25-2200.md'), 'utf8')).not.toContain('undelivered')
  expect((await neo(dir, ['dream', 'list'])).stdout).not.toContain('ยังไม่ได้เล่า')
})

test('seen with nothing to see is still {ok:true}', async () => {
  const { seen } = await running()
  expect(await (await seen()).json()).toEqual({ ok: true })
})

test('with a fake Clock: quiet hour, idle ≥ 45 min and new journal turns start a dream by themselves; 6 h apart', async () => {
  const { dir, core, clock } = await running()
  await neo(dir, ['say', 'นีโอ ฝนตกไหม']) // 22:00
  clock.advance(3 * 3600_000 + 5 * 60_000) // 01:05
  for (let i = 0; i < 100 && !(await dreamFiles(dir)).length; i++) await Bun.sleep(20)
  expect(await dreamFiles(dir)).toEqual(['2026-10-26-0100.md'])
  expect(await readFile(join(dir, 'dreams', '2026-10-26-0100.md'), 'utf8')).toContain('reason: ช่วงที่ปกติคุณไม่อยู่')

  await neo(dir, ['say', 'นีโอ ข่าววันนี้'])
  clock.advance(3 * 3600_000) // 04:05, quiet, but only 3 h after the dream
  await Bun.sleep(50)
  expect(await dreamFiles(dir)).toHaveLength(1)
  const status = core.memory.dreams.status()
  expect(status.blocked).toContain('6 ชั่วโมง')
})

test('neo dream status says why a dream would or would not run now', async () => {
  const { dir, clock } = await running()
  const fresh = await neo(dir, ['dream', 'status'])
  expect(fresh.stdout).toContain('ฝันครั้งล่าสุด:** ยังไม่เคย')
  expect(fresh.stdout).toContain('เรื่องใหม่ใน journal:** 0 รายการ')
  expect(fresh.stdout).toContain('ชั่วโมงที่ปกติไม่อยู่:** 01 02 03 04 05')

  await neo(dir, ['say', 'นีโอ ฝนตกไหม'])
  expect((await neo(dir, ['dream', 'status'])).stdout).toContain('ต้องเงียบอย่างน้อย 45 นาที')

  await neo(dir, ['dream', 'off'])
  expect((await neo(dir, ['dream', 'status'])).stdout).toContain('ฝันเองตอนไม่อยู่:** ปิด')
  clock.advance(60 * 60_000)
  const off = await neo(dir, ['dream', 'status'])
  expect(off.stdout).toContain('ปิดการฝันอยู่')
  await neo(dir, ['dream', 'on'])
  const on = await neo(dir, ['dream', 'status'])
  expect(on.stdout).toContain('ยังไม่ฝัน — ตอนนี้เป็นช่วงที่ปกติคุณอยู่')
  expect(JSON.parse((await neo(dir, ['dream', 'status', '--json'])).stdout)).toMatchObject({ enabled: true, why: null, newEntries: 1, idleMinutes: 60 })
})

test('deep sleep dreams after 15 minutes (the dream setting on), and not when it is off or the phone wakes first', async () => {
  const { dir, core, clock } = await running()
  await neo(dir, ['say', 'นีโอ ฝนตกไหม'])
  core.pet.sleep()
  clock.advance(14 * 60_000)
  expect(await dreamFiles(dir)).toEqual([])
  clock.advance(60_000)
  for (let i = 0; i < 100 && !(await dreamFiles(dir)).length; i++) await Bun.sleep(20)
  expect(await dreamFiles(dir)).toHaveLength(1)
  expect(await readFile(join(dir, 'dreams', (await dreamFiles(dir))[0]!), 'utf8')).toContain('reason: สั่งให้นอนครบ 15 นาที')

  await neo(dir, ['dream', 'clear'])
  await neo(dir, ['dream', 'off'])
  core.pet.sleep()
  clock.advance(16 * 60_000)
  await Bun.sleep(50)
  expect(await dreamFiles(dir)).toEqual([])
})

test('rm and clear; unknown ids and bad usage', async () => {
  const { dir } = await running()
  await neo(dir, ['say', 'นีโอ ฝนตกไหม'])
  await neo(dir, ['dream', 'now'])
  expect((await neo(dir, ['dream', 'show', '2020-01-01-0000'])).code).toBe(1)
  expect((await neo(dir, ['dream', 'show', '../memory'])).code).toBe(1)
  expect((await neo(dir, ['dream', 'rm'])).code).toBe(2)
  expect((await neo(dir, ['dream', 'wat'])).code).toBe(2)
  const removed = await neo(dir, ['dream', 'rm', '2026-10-25-2200'])
  expect(removed.code).toBe(0)
  expect(await dreamFiles(dir)).toEqual([])
  await neo(dir, ['dream', 'now'])
  expect((await neo(dir, ['dream', 'clear'])).stdout).toContain('1 ไฟล์')
  expect((await neo(dir, ['dream', 'list'])).stdout).toContain('ยังไม่เคยฝัน')
})

test('a dream the model cannot finish is a plain failure: exit 1, a Thai message, nothing written', async () => {
  const { dir } = await running()
  await writeFile(join(dir, 'memory.md'), '## ผู้ใช้\n- @dreambad\n')
  const failed = await neo(dir, ['dream', 'now'])
  expect(failed.code).toBe(1)
  expect(failed.stderr).toContain('ฝันแล้วจำไม่ได้')
  expect(await dreamFiles(dir)).toEqual([])
  expect(await readFile(join(dir, 'memory.md'), 'utf8')).toContain('@dreambad')
})

test('golden fixtures: every --json output and event of the dream commands', async () => {
  const { dir, core, connect } = await running()
  const events: Array<{ type: string }> = []
  core.events.subscribe(e => void events.push(e))
  const fixed = <T extends object>(value: T) => ({ ...value, at: 0 })
  await neo(dir, ['say', 'นีโอ ฝนตกไหม'])
  const now = JSON.parse((await neo(dir, ['dream', 'now', '--json'])).stdout)
  await golden('dream-now', fixed(now))
  const list = JSON.parse((await neo(dir, ['dream', 'list', '--json'])).stdout)
  await golden('dream-list', list.map(fixed))
  await golden('dream-show', fixed(JSON.parse((await neo(dir, ['dream', 'show', '--json'])).stdout)))
  const status = JSON.parse((await neo(dir, ['dream', 'status', '--json'])).stdout)
  await golden('dream-status', { ...status, last: fixed(status.last) })
  const memory = JSON.parse((await neo(dir, ['memory', 'show', '--json'])).stdout)
  await golden('memory-show-with-dream', { ...memory, items: memory.items.map((i: { from?: object }) => (i.from ? { ...i, from: fixed(i.from) } : i)) })

  // events, as the console and the phone see them
  for (const type of ['dreaming', 'dream_done', 'changed'] as const) await golden(`event-${type === 'changed' ? 'changed-dream' : type}`, fixed(events.find(e => e.type === type && (type !== 'changed' || (e as { file?: string }).file === 'dream'))!))
  const onConnect = (await connect()).find(l => l.type === 'dream_done')!
  await golden('event-dream_done-on-connect', fixed(onConnect))

  const removed = JSON.parse((await neo(dir, ['dream', 'rm', now.id, '--json'])).stdout)
  await golden('dream-rm', { removed: fixed(removed.removed) })
  await neo(dir, ['dream', 'now'])
  await golden('dream-clear', JSON.parse((await neo(dir, ['dream', 'clear', '--json'])).stdout))
  await writeFile(join(dir, 'memory.md'), '## ผู้ใช้\n- @dreambad\n')
  expect((await neo(dir, ['dream', 'now'])).code).toBe(1)
  await golden('event-dream_fail', fixed(events.find(e => e.type === 'dream_fail')!))
  const failed = await neo(dir, ['dream', 'now', '--json'])
  await golden('dream-now-failed', JSON.parse(failed.stdout))
})
