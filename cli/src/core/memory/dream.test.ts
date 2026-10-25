import { afterEach, expect, test } from 'bun:test'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { FakeClock, tempHome } from '../../../test/helpers'
import type { NeoEvent } from '../../protocol'
import type { Brain, DreamRequest, DreamResult } from '../brain/brain'
import { createEvents } from '../events/events'
import { MemoryConflict, MemoryNotFound, createMemory } from './memory'

const cleanups: Array<() => Promise<unknown>> = []
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map(c => c()))
})

const at = (day: number, hour: number, minute = 0) => new Date(2026, 9, day, hour, minute).getTime()
const GOOD: DreamResult = {
  type: 'dream',
  memory: '## ผู้ใช้\n- ชอบแมวทดสอบระบบ\n- ทำงานด้านสัญญาหลังบ้าน',
  insights: [{ q: 'ตั๋ว', finding: 'ถูกสุดวันอังคาร' }],
  patterns: ['ถามอากาศตอนเช้า'],
  dream: 'ฝันถึงปลาทอง',
  card: { title: 'ฝันแล้ว', lines: ['ตั๋วถูกวันอังคาร'], items: [] },
}

async function setup(start = at(25, 22, 0)) {
  const { dir, cleanup } = await tempHome()
  const clock = new FakeClock(start)
  const events = createEvents({ clock })
  const log: NeoEvent[] = []
  events.subscribe(e => void log.push(e))
  const state = { result: GOOD as DreamResult | (() => Promise<DreamResult>), busy: false, enabled: true, name: 'จอห์น', requests: [] as DreamRequest[], hasDream: true }
  const brain: Brain = {
    label: 'Fake',
    ask: () => { throw new Error('no ask') },
    runSkill: () => { throw new Error('no skill') },
    get dream() {
      return state.hasDream
        ? async (request: DreamRequest) => {
          state.requests.push(request)
          return typeof state.result === 'function' ? state.result() : state.result
        }
        : undefined
    },
  }
  const memory = createMemory({
    home: dir, clock, events, watchFiles: false,
    dreaming: { brain: () => brain, petName: () => state.name, busy: () => state.busy, enabled: () => state.enabled },
  })
  cleanups.push(async () => {
    memory.close()
    await cleanup()
  })
  /** The user said something (what Conversation does): counts as activity, and the turn is journaled. */
  const chat = (q: string, a = 'ตอบแล้ว', ok = true) => {
    events.publish({ type: 'thinking', text: q })
    memory.record({ q, a, ok })
  }
  const dreamFiles = async () => (await readdir(join(dir, 'dreams')).catch(() => [])).sort()
  const until = async (check: () => boolean | Promise<boolean>) => {
    for (let i = 0; i < 200 && !(await check()); i++) await Bun.sleep(10)
    expect(await check()).toBe(true)
  }
  return { dir, clock, events, memory, log, state, chat, dreamFiles, until }
}

test('dream now writes a dream file and rewrites memory.md as the dream said, with a +/− section', async () => {
  const s = await setup()
  s.memory.add('ชอบกาแฟ', 'ผู้ใช้')
  s.memory.add('ทำงานด้านสัญญาหลังบ้าน', 'ผู้ใช้')
  s.chat('ฝนตกไหม', 'ตก')
  s.clock.advance(60 * 60_000)
  const doc = await s.memory.dream('สั่งให้ฝัน')

  expect(await s.dreamFiles()).toEqual(['2026-10-25-2300.md'])
  expect(doc.id).toBe('2026-10-25-2300')
  expect(s.memory.doc().text).toBe(GOOD.memory + '\n')
  expect(doc).toMatchObject({ added: ['ชอบแมวทดสอบระบบ'], removed: ['ชอบกาแฟ'], reason: 'สั่งให้ฝัน', entries: 1, undelivered: true, dream: 'ฝันถึงปลาทอง' })
  const file = await readFile(join(s.dir, 'dreams', '2026-10-25-2300.md'), 'utf8')
  expect(file).toContain('## Memory changes\n- + ชอบแมวทดสอบระบบ\n- − ชอบกาแฟ')
  expect(((await Bun.file(join(s.dir, 'dreams', '2026-10-25-2300.md')).stat()).mode & 0o777).toString(8)).toBe('600')
  expect(s.memory.dreams.list().map(d => d.id)).toEqual(['2026-10-25-2300'])
})

test('the brain gets the pet name, the memory, the journal since the last dream and the quiet hours', async () => {
  const s = await setup()
  s.memory.add('ชอบกาแฟ')
  s.chat('ฝนตกไหม', 'ตก')
  s.clock.advance(5 * 60_000)
  s.chat('ซื้อตั๋ว', 'ไม่สำเร็จ', false)
  await s.memory.dream('x')
  const [request] = s.state.requests
  expect(request).toMatchObject({
    petName: 'จอห์น',
    memory: expect.stringContaining('- ชอบกาแฟ'),
    quietHours: [1, 2, 3, 4, 5],
    entries: [
      { at: at(25, 22, 0), q: 'ฝนตกไหม', a: 'ตก', ok: true },
      { at: at(25, 22, 5), q: 'ซื้อตั๋ว', a: 'ไม่สำเร็จ', ok: false },
    ],
  })
  // the second dream only sees what came after the first
  s.clock.advance(60 * 60_000)
  s.chat('ข่าววันนี้')
  await s.memory.dream('y')
  expect(s.state.requests[1]!.entries.map(e => e.q)).toEqual(['ข่าววันนี้'])
})

test('events: dreaming, then dream_done with the dream card (humanized, dream:true) and what changed', async () => {
  const s = await setup()
  s.chat('a')
  await s.memory.dream('สั่งให้ฝัน')
  const types = s.log.map(e => e.type).filter(t => t === 'dreaming' || t === 'dream_done')
  expect(types).toEqual(['dreaming', 'dream_done'])
  expect(s.log.find(e => e.type === 'dreaming')).toMatchObject({ reason: 'สั่งให้ฝัน', entries: 1 })
  const done = s.log.find(e => e.type === 'dream_done')!
  expect(done).toMatchObject({ dream: 'ฝันถึงปลาทอง', insights: 1, card: { dream: true, title: 'ฝันแล้ว', lines: ['ฝันถึงปลาทอง', 'ตั๋วถูกวันอังคาร'], emotion: 'love' } })
})

test('a dream that fails leaves memory and files alone, says dream_fail, and is not retried for an hour', async () => {
  const s = await setup()
  s.memory.add('เดิม')
  s.state.result = { type: 'error', error: 'Credit balance is too low' }
  s.chat('a')
  s.clock.advance(60 * 60_000)
  await expect(s.memory.dream('x')).rejects.toThrow('Credit balance is too low')
  expect(s.log.find(e => e.type === 'dream_fail')).toMatchObject({ error: 'Credit balance is too low' })
  expect(s.memory.doc().text).toContain('เดิม')
  expect(await s.dreamFiles()).toEqual([])
  expect(s.memory.dreams.status().blocked).toContain('ล้มเหลว')
  expect(s.memory.dreams.status().running).toBe(false)
})

test('a provider that cannot dream says so', async () => {
  const s = await setup()
  s.state.hasDream = false
  await expect(s.memory.dream('x')).rejects.toThrow('ฝันไม่ได้')
})

test('memory.md edited while the dream ran is not overwritten', async () => {
  const s = await setup()
  s.memory.add('เดิม')
  s.state.result = async () => {
    await writeFile(join(s.dir, 'memory.md'), '## ฉัน\n- แก้ระหว่างฝัน\n')
    return GOOD
  }
  const doc = await s.memory.dream('x')
  expect(s.memory.doc().text).toBe('## ฉัน\n- แก้ระหว่างฝัน\n')
  expect(doc.added).toEqual([])
  expect(doc.patterns).toContain('ความจำถูกแก้ระหว่างฝัน จึงไม่ได้เขียนทับ')
})

test('only one dream at a time', async () => {
  const s = await setup()
  let release!: () => void
  s.state.result = () => new Promise<DreamResult>(resolve => { release = () => resolve(GOOD) })
  const first = s.memory.dream('x')
  expect(s.memory.dreams.status().running).toBe(true)
  await expect(s.memory.dream('y')).rejects.toThrow(MemoryConflict)
  release()
  await first
  expect(s.memory.dreams.status().running).toBe(false)
})

// ---- when it dreams by itself ----

test('idle ≥ 45 min in a quiet hour with new journal entries starts a dream (5-minute check)', async () => {
  const s = await setup(at(25, 22, 0))
  s.chat('ฝนตกไหม')
  s.clock.advance(2 * 60 * 60_000) // 00:00 — not quiet yet (quiet is 01–05)
  expect(await s.dreamFiles()).toEqual([])
  expect(s.memory.dreams.status()).toMatchObject({ why: null, quietNow: false })
  s.clock.advance(65 * 60_000) // 01:05
  await s.until(async () => (await s.dreamFiles()).length === 1)
  expect(s.log.find(e => e.type === 'dreaming')).toMatchObject({ reason: 'ช่วงที่ปกติคุณไม่อยู่' })
  expect(s.state.requests[0]!.entries.map(e => e.q)).toEqual(['ฝนตกไหม'])
})

test('without new journal entries nothing is dreamed', async () => {
  const s = await setup(at(25, 22, 0))
  s.clock.advance(5 * 60 * 60_000)
  expect(await s.dreamFiles()).toEqual([])
  expect(s.memory.dreams.status().blocked).toContain('ไม่มีเรื่องใหม่')
})

test('being around keeps it awake: a chat 20 minutes ago blocks the dream even in a quiet hour', async () => {
  const s = await setup(at(26, 1, 0))
  s.chat('a')
  s.clock.advance(20 * 60_000)
  expect(s.memory.dreams.status()).toMatchObject({ why: null, idleMinutes: 20 })
  expect(s.memory.dreams.status().blocked).toContain('45')
  expect(await s.dreamFiles()).toEqual([])
})

test('away for 3 hours counts as away at any hour', async () => {
  const s = await setup(at(25, 12, 0))
  s.chat('a')
  s.clock.advance(2 * 60 * 60_000 + 55 * 60_000)
  expect(s.memory.dreams.status().why).toBeNull()
  s.clock.advance(10 * 60_000)
  await s.until(async () => (await s.dreamFiles()).length === 1)
  expect(s.log.find(e => e.type === 'dreaming')).toMatchObject({ reason: 'คุณไม่อยู่นานแล้ว' })
})

test('at least 6 hours between dreams', async () => {
  const s = await setup(at(25, 22, 0))
  s.chat('a')
  s.clock.advance(3 * 60 * 60_000 + 5 * 60_000) // 01:05 → dreams
  await s.until(async () => (await s.dreamFiles()).length === 1)
  s.chat('b') // 01:05
  s.clock.advance(4 * 60 * 60_000) // 05:05, quiet hour 5, idle 4 h, new entry — but only 4 h since the dream
  expect(s.memory.dreams.status().blocked).toContain('6')
  await Bun.sleep(30)
  expect(await s.dreamFiles()).toHaveLength(1)
  s.clock.advance(3 * 60 * 60_000) // 08:05 — 7 h since, idle 7 h
  await s.until(async () => (await s.dreamFiles()).length === 2)
})

test('the dream setting off stops automatic dreams but not `dream now`; busy Neo does not dream', async () => {
  const s = await setup(at(26, 1, 0))
  s.chat('a')
  s.state.enabled = false
  s.clock.advance(60 * 60_000)
  expect(s.memory.dreams.status()).toMatchObject({ enabled: false, why: null })
  await Bun.sleep(30)
  expect(await s.dreamFiles()).toEqual([])
  s.state.enabled = true
  s.state.busy = true
  expect(s.memory.dreams.status().blocked).toContain('กำลังตอบ')
  s.state.busy = false
  expect(s.memory.dreams.status().why).toBe('ช่วงที่ปกติคุณไม่อยู่')
  await s.memory.dream('สั่งให้ฝัน')
  expect(await s.dreamFiles()).toHaveLength(1)
})

test('the deep-sleep dream respects the dream setting', async () => {
  const s = await setup()
  s.state.enabled = false
  expect(await s.memory.dreamIfAllowed('สั่งให้นอนครบ 15 นาที')).toBeNull()
  s.state.enabled = true
  expect(await s.memory.dreamIfAllowed('สั่งให้นอนครบ 15 นาที')).toMatchObject({ reason: 'สั่งให้นอนครบ 15 นาที' })
})

// ---- the card for the phone ----

test('the dream card is pending until seen, then never again; seen clears undelivered in the file', async () => {
  const s = await setup()
  expect(s.memory.dreams.pending()).toBeNull()
  s.chat('a')
  await s.memory.dream('x')
  const pending = s.memory.dreams.pending()
  expect(pending).toMatchObject({ card: { dream: true, title: 'ฝันแล้ว' }, at: expect.any(Number) })
  expect(s.memory.dreams.pending()).not.toBeNull() // asking again does not consume it
  s.memory.dreams.seen()
  expect(s.memory.dreams.pending()).toBeNull()
  expect(await readFile(join(s.dir, 'dreams', (await s.dreamFiles())[0]!), 'utf8')).not.toContain('undelivered')
  expect(s.memory.dreams.list()[0]!.undelivered).toBe(false)
})

test('a pending card survives a restart', async () => {
  const s = await setup()
  await s.memory.dream('x')
  s.memory.close()
  const again = createMemory({ home: s.dir, clock: s.clock, events: s.events, watchFiles: false })
  cleanups.push(async () => again.close())
  expect(again.dreams.pending()).toMatchObject({ card: { title: 'ฝันแล้ว' } })
})

// ---- files and commands ----

test('list, show, rm and clear work on the dream files', async () => {
  const s = await setup()
  s.chat('a')
  await s.memory.dream('x')
  s.clock.advance(7 * 3600_000)
  s.chat('b')
  await s.memory.dream('y')
  expect(s.memory.dreams.list().map(d => d.id)).toEqual(['2026-10-26-0500', '2026-10-25-2200'])
  expect(s.memory.dreams.show('2026-10-25-2200')).toMatchObject({ id: '2026-10-25-2200', dream: 'ฝันถึงปลาทอง', text: expect.stringContaining('# ฝันถึงปลาทอง'), version: expect.any(String) })
  expect(s.memory.dreams.show('last').id).toBe('2026-10-26-0500')
  expect(() => s.memory.dreams.show('2020-01-01-0000')).toThrow(MemoryNotFound)
  expect(() => s.memory.dreams.show('../memory')).toThrow(MemoryNotFound)
  expect(s.memory.dreams.remove('2026-10-25-2200')).toMatchObject({ id: '2026-10-25-2200' })
  expect(await s.dreamFiles()).toEqual(['2026-10-26-0500.md'])
  expect(s.memory.dreams.clear()).toBe(1)
  expect(s.memory.dreams.pending()).toBeNull()
  expect(await s.dreamFiles()).toEqual([])
})

test('memory items that a dream added are marked with the dream they came from', async () => {
  const s = await setup()
  s.memory.add('ชอบกาแฟ', 'ผู้ใช้')
  s.memory.add('ทำงานด้านสัญญาหลังบ้าน', 'ผู้ใช้')
  await s.memory.dream('x')
  const items = s.memory.doc().items
  expect(items.find(i => i.text === 'ชอบแมวทดสอบระบบ')).toMatchObject({ from: { id: '2026-10-25-2200', dream: 'ฝันถึงปลาทอง', at: at(25, 22, 0) } })
  expect(items.find(i => i.text === 'ทำงานด้านสัญญาหลังบ้าน')?.from).toBeUndefined()
})

test('status explains the state in words', async () => {
  const s = await setup(at(26, 1, 0))
  expect(s.memory.dreams.status()).toMatchObject({ enabled: true, running: false, last: null, why: null, newEntries: 0, quietNow: true, quietHours: [1, 2, 3, 4, 5], activity: expect.any(Array) })
  expect(s.memory.dreams.status().activity).toHaveLength(24)
  s.chat('a')
  s.state.busy = true // keeps the 5-minute check from starting the dream under us
  s.clock.advance(50 * 60_000)
  s.state.busy = false
  expect(s.memory.dreams.status()).toMatchObject({ why: 'ช่วงที่ปกติคุณไม่อยู่', blocked: null, newEntries: 1, idleMinutes: 50 })
})

test('a dream edited in an editor is announced as changed', async () => {
  const { dir, cleanup } = await tempHome()
  const clock = new FakeClock(at(26, 9))
  const events = createEvents({ clock })
  const log: NeoEvent[] = []
  events.subscribe(e => void log.push(e))
  const memory = createMemory({ home: dir, clock, events })
  cleanups.push(async () => {
    memory.close()
    await cleanup()
  })
  await writeFile(join(dir, 'dreams', '2026-10-26-0100.md'), '# แก้เอง\n')
  for (let i = 0; i < 100 && !log.some(e => e.type === 'changed'); i++) await Bun.sleep(20)
  expect(log.find(e => e.type === 'changed')).toMatchObject({ file: 'dream', id: '2026-10-26-0100' })
})
