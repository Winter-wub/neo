import { afterEach, expect, test } from 'bun:test'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { FakeClock, tempHome } from '../../../test/helpers'
import type { NeoEvent } from '../../protocol'
import type { AskRequest, Brain, Reply } from '../brain/brain'
import { createEvents } from '../events/events'
import { createAnimations, toolKey } from './animations'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c()
})

/** A pixel card the way a Brain answers a drawing request. */
const drawing = (over: Record<string, unknown> = {}): Reply => ({
  session: null,
  answer: {
    type: 'card',
    card: {
      kind: 'text', layout: 'pixel', icon: 'text', title: 't', lines: [], items: [], emotion: 'happy', sounds: [], seconds: 10,
      w: 24, h: 24, palette: { a: '#ff0000', b: '#00ff00' }, fps: 4,
      frames: [0, 1, 2].map(n => Array.from({ length: 24 }, (_, row) => ('a'.repeat(6) + (row % 3 === n ? 'b' : 'a').repeat(12)).padEnd(24, '.'))),
      ...over,
    } as never,
  },
})

async function setup(draw: (request: AskRequest, n: number) => Promise<Reply> | Reply = () => drawing()) {
  const { dir, cleanup } = await tempHome()
  cleanups.push(cleanup)
  const clock = new FakeClock()
  const events = createEvents({ clock })
  const log: NeoEvent[] = []
  events.subscribe(e => log.push(e))
  const asks: AskRequest[] = []
  const brain: Brain = {
    label: 'Fake',
    ask: async request => { asks.push(request); return draw(request, asks.length) },
    runSkill: async () => ({ answer: { type: 'error', error: 'no' }, session: null }),
  }
  let busy = false
  const logs: string[] = []
  const animations = createAnimations({ home: dir, clock, events, brain, createdBy: () => 'fake / m1', busy: () => busy, log: m => logs.push(m) })
  return { animations, asks, log, logs, dir, clock, setBusy: (on: boolean) => { busy = on }, files: () => readdir(join(dir, 'animations')).catch(() => []) }
}

test('the key is the exact tool name; for Skill it is the skill name', () => {
  expect(toolKey('Bash', '{"command":"ls"}')).toBe('Bash')
  expect(toolKey('mcp__MCP_DOCKER__jira_search', '{}')).toBe('mcp__MCP_DOCKER__jira_search')
  expect(toolKey('Skill', '{"skill":"mappedin-cms"}')).toBe('Skill:mappedin-cms')
  expect(toolKey('Skill', 'not json')).toBe('Skill')
})

test('first use: no animation yet, one gets drawn in the background and kept in a readable file; second use carries it', async () => {
  const t = await setup()
  expect(t.animations.onTool('WebSearch', '{}')).toEqual({ key: 'WebSearch', animation: null })
  await t.animations.settled()
  expect(t.asks).toHaveLength(1)
  expect(t.asks[0]).toMatchObject({ resume: null, bypass: false })
  expect(t.asks[0]!.text).toContain('WebSearch')
  expect(await t.files()).toEqual(['WebSearch.json'])
  const file = JSON.parse(await readFile(join(t.dir, 'animations', 'WebSearch.json'), 'utf8'))
  expect(file).toMatchObject({ tool: 'WebSearch', label: 'WebSearch', w: 24, h: 24, fps: 4, createdBy: 'fake / m1', at: 1_700_000_000_000 })
  expect(file.frames).toHaveLength(3)
  expect(t.log.map(e => e.type)).toEqual(['animation'])
  const again = t.animations.onTool('WebSearch', '{}')
  expect(again.animation).toMatchObject({ tool: 'WebSearch', w: 24 })
  await t.animations.settled()
  expect(t.asks).toHaveLength(1)
})

test('generation is single-flight and queued', async () => {
  let inFlight = 0
  let most = 0
  const t = await setup(async () => {
    most = Math.max(most, ++inFlight)
    await Bun.sleep(5)
    inFlight--
    return drawing()
  })
  t.animations.onTool('A', '{}')
  t.animations.onTool('B', '{}')
  t.animations.onTool('C', '{}')
  t.animations.onTool('A', '{}')
  await t.animations.settled()
  expect(most).toBe(1)
  expect((await t.files()).sort()).toEqual(['A.json', 'B.json', 'C.json'])
  expect(t.asks).toHaveLength(3)
})

test('nothing is drawn while the user\'s own ask is running; it starts when Neo is idle, and a running drawing gives way to a new ask', async () => {
  let release!: () => void
  const t = await setup((request, n) => (n === 1
    ? new Promise<Reply>(resolve => {
      release = () => resolve(drawing())
      request.signal.addEventListener('abort', () => resolve({ answer: { type: 'error', error: 'interrupted' }, session: null }))
    })
    : drawing()))
  t.setBusy(true)
  t.animations.onTool('Bash', '{}')
  await t.animations.settled()
  expect(t.asks).toHaveLength(0)
  t.setBusy(false)
  t.animations.onBusy(false)
  await Bun.sleep(0)
  expect(t.asks).toHaveLength(1) // drawing now
  t.setBusy(true)
  t.animations.onBusy(true) // the user asks something: the drawing is dropped and waits
  await Bun.sleep(0)
  expect(await t.files()).toEqual([])
  t.setBusy(false)
  t.animations.onBusy(false)
  await t.animations.settled()
  expect(t.asks).toHaveLength(2)
  expect(await t.files()).toEqual(['Bash.json'])
  expect(t.logs).toEqual([]) // an interrupted drawing is not a failure
  release()
})

test('unreadable drawings are rejected; a failure is logged and retried once, later', async () => {
  const blank = drawing({ frames: [Array.from({ length: 24 }, () => '.'.repeat(24))] })
  const t = await setup((_, n) => (n <= 2 ? blank : drawing()))
  t.animations.onTool('Bash', '{}')
  await t.animations.settled()
  expect(await t.files()).toEqual([])
  expect(t.logs).toHaveLength(1)
  t.animations.onTool('Bash', '{}') // too soon to retry
  await t.animations.settled()
  expect(t.asks).toHaveLength(1)
  t.clock.advance(11 * 60_000)
  t.animations.onTool('Bash', '{}')
  await t.animations.settled()
  expect(t.asks).toHaveLength(2)
  expect(t.logs).toHaveLength(2)
  t.clock.advance(60 * 60_000)
  t.animations.onTool('Bash', '{}') // retried at most once
  await t.animations.settled()
  expect(t.asks).toHaveLength(2)
  expect(await t.files()).toEqual([])
  await t.animations.redo('Bash') // the user asking again always works
  await t.animations.settled()
  expect(await t.files()).toEqual(['Bash.json'])
})

test('validation: size, palette, frames and a single still frame', async () => {
  for (const bad of [{ w: 12, h: 12 }, { palette: Object.fromEntries('abcdefghijklm'.split('').map(c => [c, '#ffffff'])) }, { frames: [drawing().answer.type === 'card' ? ((drawing().answer as { card: { frames: string[][] } }).card.frames[0]!) : []] }]) {
    const t = await setup(() => drawing(bad))
    t.animations.onTool('X', '{}')
    await t.animations.settled()
    expect(await t.files()).toEqual([])
  }
})

test('list, show, redo and rm by tool name or a unique part of it', async () => {
  const t = await setup()
  t.animations.onTool('mcp__MCP_DOCKER__jira_search', '{}')
  t.animations.onTool('Skill', '{"skill":"mappedin-cms"}')
  await t.animations.settled()
  expect(t.animations.list().map(a => a.tool)).toEqual(['mcp__MCP_DOCKER__jira_search', 'Skill:mappedin-cms'])
  expect(t.animations.list()[0]).toMatchObject({ w: 24, h: 24, frames: 3, fps: 4 })
  expect(t.animations.show('jira').tool).toBe('mcp__MCP_DOCKER__jira_search')
  expect(() => t.animations.show('m')).toThrow('หลายอัน')
  expect(() => t.animations.show('nope')).toThrow('ไม่พบ')
  t.log.length = 0
  const removed = await t.animations.rm('mappedin')
  expect(removed.tool).toBe('Skill:mappedin-cms')
  expect(t.log).toMatchObject([{ type: 'animation', tool: 'Skill:mappedin-cms', animation: null }])
  expect(await t.files()).toHaveLength(1)
  t.log.length = 0
  await t.animations.redo('jira')
  await t.animations.settled()
  expect(t.asks).toHaveLength(3)
  expect(t.log).toMatchObject([{ type: 'animation', tool: 'mcp__MCP_DOCKER__jira_search', animation: { w: 24 } }])
})

test('"วาดท่าใหม่" redoes the animation of the most recent tool and says so', async () => {
  const t = await setup()
  expect(t.animations.understand('วาดท่าใหม่')?.card.title).toContain('ยังไม่')
  t.animations.onTool('Bash', '{}')
  await t.animations.settled()
  t.animations.onTool('WebSearch', '{}')
  await t.animations.settled()
  t.log.length = 0
  for (const phrase of ['วาดท่าใหม่', 'เปลี่ยนท่า', 'เปลี่ยนท่าใหม่หน่อย']) {
    expect(t.animations.understand(phrase)).not.toBeNull()
    await t.animations.settled()
  }
  expect(t.animations.understand('วาดรูปแมว')).toBeNull()
  expect(t.asks.map(a => a.text.includes('WebSearch'))).toEqual([false, true, true, true, true])
  expect(t.log.filter(e => e.type === 'animation')).toHaveLength(3)
})

test('a tool key that is not a safe file name still gets its own file', async () => {
  const t = await setup()
  t.animations.onTool('Skill', '{"skill":"a/b"}')
  t.animations.onTool('Skill', '{"skill":"a_b"}')
  await t.animations.settled()
  expect(t.animations.list().map(a => a.tool).sort()).toEqual(['Skill:a/b', 'Skill:a_b'])
  expect(await t.files()).toHaveLength(2)
})

test('drawing is a side ask: no resume, so it never touches the user\'s conversation session, whatever the Brain', async () => {
  const t = await setup()
  t.animations.onTool('Bash', '{}')
  await t.animations.settled()
  expect(t.asks).toHaveLength(1)
  expect(t.asks[0]).toMatchObject({ side: true, resume: null })
  expect(await t.files()).toEqual(['Bash.json'])
})
