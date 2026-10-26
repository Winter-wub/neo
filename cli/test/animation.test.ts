// Ticket 27 end to end: a tool's animation is drawn once in the background and reused; neo animation …, "วาดท่าใหม่" and the phone routes.
import { afterEach, expect, test } from 'bun:test'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { runCli } from '../src/adapters/command/cli'
import { startCommandServer } from '../src/adapters/command/server'
import { startPhoneServer } from '../src/adapters/phone/server'
import type { AskRequest, Brain } from '../src/core/brain/brain'
import { textCard } from '../src/core/cards/cards'
import { createCore } from '../src/core/core'
import type { NeoEvent } from '../src/protocol'
import { FakeClock, golden, tempHome } from './helpers'

const cleanups: Array<() => Promise<unknown>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

const frames = [0, 1, 2].map(n => Array.from({ length: 24 }, (_, row) => ('a'.repeat(6) + (row % 3 === n ? 'b' : 'a').repeat(12)).padEnd(24, '.')))
const pixel = { ...textCard({ title: 'ท่า', lines: [] }), layout: 'pixel' as const, w: 24, h: 24, palette: { a: '#ff0000', b: '#00ff00' }, frames, fps: 4 }

async function running() {
  const { dir, cleanup } = await tempHome()
  const clock = new FakeClock()
  const asks: AskRequest[] = []
  const brain: Brain = {
    label: 'Fake',
    async ask(request) {
      asks.push(request)
      if (request.text.includes('pixel art')) return { answer: { type: 'card', card: pixel }, session: null }
      request.onTool('WebSearch', '{"query":"gold"}')
      return { answer: { type: 'card', card: textCard({ title: 'ทอง', lines: ['ราคา 1'] }) }, session: 's' }
    },
    runSkill: async () => ({ answer: { type: 'error', error: 'no' }, session: null }),
  }
  const core = await createCore({ home: dir, clock, pid: 1, brain, env: { HOME: dir } })
  const server = await startCommandServer({ core, clock, home: dir })
  const phone = await startPhoneServer({ core, clock, port: 0, apkPath: join(dir, 'neo.apk'), networks: () => [], tailscale: async () => null })
  cleanups.push(cleanup, () => core.stop(), () => server.stop(), () => phone.stop(), () => core.devices.flush())
  const events: NeoEvent[] = []
  core.events.subscribe(e => events.push(e))
  return { dir, core, asks, events, base: `http://127.0.0.1:${phone.port}` }
}

async function neo(dir: string, args: string[]) {
  const out: string[] = []
  const err: string[] = []
  const code = await runCli([...args, '--home', dir], { out: t => void out.push(t), err: t => void err.push(t), env: {} })
  return { code, stdout: out.join(''), stderr: err.join('') }
}

const files = async (dir: string) => (await readdir(join(dir, 'animations')).catch(() => [])).sort()

test('first use: the answer is not held up and an animation appears afterwards; the second use carries it', async () => {
  const t = await running()
  const first = await neo(t.dir, ['say', 'นีโอ ราคาทองวันนี้'])
  expect(first.code).toBe(0)
  expect(first.stdout).toContain('ทอง')
  expect(t.events.filter(e => e.type === 'tool')).toMatchObject([{ name: 'WebSearch', key: 'WebSearch', animation: null }])
  expect(t.asks[0]!.text).toBe('ราคาทองวันนี้') // the user's ask came first; the drawing starts only after the answer
  await t.core.animations.settled()
  expect(t.asks).toHaveLength(2)
  expect(t.asks[1]).toMatchObject({ resume: null, bypass: false })
  expect(await files(t.dir)).toEqual(['WebSearch.json'])
  expect(t.events.at(-1)).toMatchObject({ type: 'animation', tool: 'WebSearch', animation: { w: 24, h: 24, createdBy: 'Claude Code' } })

  await neo(t.dir, ['say', 'นีโอ ราคาเงินวันนี้'])
  const tools = t.events.filter(e => e.type === 'tool')
  expect(tools[1]).toMatchObject({ key: 'WebSearch', animation: { tool: 'WebSearch', w: 24, frames: expect.any(Array) } })
  await t.core.animations.settled()
  expect(t.asks.filter(a => a.text.includes('pixel art'))).toHaveLength(1)

  await golden('tool-event-animation', tools[1])
  await golden('animation-event', t.events.find(e => e.type === 'animation'))
})

test('neo animation list / show / redo / rm', async () => {
  const t = await running()
  expect((await neo(t.dir, ['animation', 'list'])).stdout).toContain('ยังไม่มี')
  await neo(t.dir, ['say', 'นีโอ ราคาทองวันนี้'])
  await t.core.animations.settled()

  const list = await neo(t.dir, ['animation', 'list', '--json'])
  expect(JSON.parse(list.stdout)).toMatchObject([{ tool: 'WebSearch', w: 24, h: 24, frames: 3, fps: 4 }])
  await golden('animation-list', JSON.parse(list.stdout))
  expect((await neo(t.dir, ['animation', 'list'])).stdout).toContain('WebSearch — 24×24 · 3 เฟรม')
  const show = await neo(t.dir, ['animation', 'show', 'websearch', '--json'])
  expect(JSON.parse(show.stdout)).toMatchObject({ tool: 'WebSearch', palette: { a: '#ff0000' } })
  await golden('animation-show', JSON.parse(show.stdout))
  expect((await neo(t.dir, ['animation', 'show', 'WebSearch'])).stdout).toContain('██')

  const before = t.asks.length
  const redo = await neo(t.dir, ['animation', 'redo', 'WebSearch', '--json'])
  expect(JSON.parse(redo.stdout)).toEqual({ tool: 'WebSearch', queued: true })
  await golden('animation-redo', JSON.parse(redo.stdout))
  await t.core.animations.settled()
  expect(t.asks.length).toBe(before + 1)

  const rm = await neo(t.dir, ['animation', 'rm', 'WebSearch', '--json'])
  expect(JSON.parse(rm.stdout)).toMatchObject({ removed: { tool: 'WebSearch' } })
  await golden('animation-rm', JSON.parse(rm.stdout))
  expect(await files(t.dir)).toEqual([])
  expect(t.events.at(-1)).toMatchObject({ type: 'animation', tool: 'WebSearch', animation: null })

  const missing = await neo(t.dir, ['animation', 'show', 'nope'])
  expect(missing.code).toBe(1)
  expect(missing.stderr).toContain('ไม่พบ')
  expect((await neo(t.dir, ['animation', 'show'])).code).toBe(2)
})

test('"วาดท่าใหม่" after a tool run redoes that tool\'s animation and publishes an event', async () => {
  const t = await running()
  expect((await neo(t.dir, ['say', 'นีโอ วาดท่าใหม่'])).stdout).toContain('ยังไม่เคย')
  await neo(t.dir, ['say', 'นีโอ ราคาทองวันนี้'])
  await t.core.animations.settled()
  const drawn = t.events.filter(e => e.type === 'animation').length
  const said = await neo(t.dir, ['say', 'นีโอ วาดท่าใหม่'])
  expect(said.stdout).toContain('WebSearch')
  await t.core.animations.settled()
  expect(t.events.filter(e => e.type === 'animation')).toHaveLength(drawn + 1)
  expect(t.asks.filter(a => a.text.includes('WebSearch') && a.text.includes('pixel art'))).toHaveLength(2)
})

test('a paired phone can list and redo animations on port 8000\'s routes', async () => {
  const t = await running()
  await neo(t.dir, ['say', 'นีโอ ราคาทองวันนี้'])
  await t.core.animations.settled()
  const { code } = t.core.devices.startPairing()
  const { token } = (await (await fetch(`${t.base}/api/pair`, { method: 'POST', body: JSON.stringify({ code, name: 'A7' }) })).json()) as { token: string }
  const auth = { authorization: `Bearer ${token}` }
  expect((await fetch(`${t.base}/api/animations`)).status).toBe(401)
  const list = await (await fetch(`${t.base}/api/animations`, { headers: auth })).json()
  expect(list).toMatchObject([{ tool: 'WebSearch' }])
  const shown = await (await fetch(`${t.base}/api/animations/show`, { method: 'POST', headers: auth, body: JSON.stringify({ tool: 'WebSearch' }) })).json()
  expect(shown).toMatchObject({ tool: 'WebSearch', frames: [expect.any(Array), expect.any(Array), expect.any(Array)] })
  const redo = await fetch(`${t.base}/api/animations/redo`, { method: 'POST', headers: auth, body: JSON.stringify({ tool: 'WebSearch' }) })
  expect(await redo.json()).toEqual({ tool: 'WebSearch', queued: true })
  const gone = await fetch(`${t.base}/api/animations/show`, { method: 'POST', headers: auth, body: JSON.stringify({ tool: 'nope' }) })
  expect(gone.status).toBe(400)
  await t.core.animations.settled()
})
