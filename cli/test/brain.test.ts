// Ticket 06 end to end: neo provider / neo model / spoken switches against a real core, a real socket, the fake ACP agent and the fake `claude`.
import { afterEach, expect, test } from 'bun:test'
import { readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { runCli } from '../src/adapters/command/cli'
import { startCommandServer } from '../src/adapters/command/server'
import { createCore } from '../src/core/core'
import { FakeClock, golden, tempHome } from './helpers'

const FAKE_BIN = join(import.meta.dir, 'fake-bin')
const FAKE_AGENT = join(import.meta.dir, 'fake-acp-agent.js')
const cleanups: Array<() => Promise<unknown>> = []
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map(c => c()))
})

async function running() {
  const { dir, cleanup } = await tempHome()
  cleanups.push(cleanup)
  const clock = new FakeClock()
  const core = await createCore({
    home: dir, clock, pid: 1,
    env: { PATH: `${FAKE_BIN}:${process.env.PATH}`, FAKE_CLAUDE_LOG: join(dir, 'claude.jsonl'), HOME: dir },
    discover: async () => ({ acpx: true, agents: [{ name: 'fakeagent', label: 'Fake Agent', type: 'acp', available: true, command: process.execPath, args: [FAKE_AGENT], via: 'PATH fake' }] }),
  })
  const server = await startCommandServer({ core, clock, home: dir })
  cleanups.unshift(async () => { await server.stop(); await core.stop() })
  await core.providers.discover()
  return { dir, core, clock }
}

async function neo(dir: string, args: string[], stdin?: string) {
  const out: string[] = []
  const err: string[] = []
  const code = await runCli([...args, '--home', dir], { out: t => void out.push(t), err: t => void err.push(t), env: {}, stdin: async () => stdin ?? '' })
  return { code, stdout: out.join(''), stderr: err.join('') }
}

function watch(dir: string) {
  const abort = new AbortController()
  const lines: any[] = []
  const done = runCli(['events', '--json', '--home', dir], { out: t => void lines.push(...t.split('\n').filter(Boolean).map(l => JSON.parse(l))), err() {}, env: {}, signal: abort.signal })
  const poll = async (match: (e: any) => boolean) => {
    for (let i = 0; i < 200; i++) {
      const hit = lines.find(match)
      if (hit) return hit
      await Bun.sleep(20)
    }
    throw new Error('event never arrived')
  }
  return { lines, poll, stop: async () => { abort.abort(); await done } }
}

const claudeCalls = async (dir: string) => (await readFile(join(dir, 'claude.jsonl'), 'utf8').catch(() => '')).split('\n').filter(Boolean).length

test('neo provider list, then use an ACP agent: neo say answers through it, not through claude', async () => {
  const { dir } = await running()
  const list = await neo(dir, ['provider', 'list', '--json'])
  const parsed = JSON.parse(list.stdout)
  expect(parsed.current).toBe('claude')
  expect(parsed.list.map((p: any) => p.name)).toEqual(['claude', 'fakeagent'])
  await golden('provider-list', parsed)
  expect((await neo(dir, ['provider', 'list'])).stdout).toContain('fakeagent**')

  const used = await neo(dir, ['provider', 'use', 'fakeagent', '--json'])
  expect(used.code).toBe(0)
  const result = JSON.parse(used.stdout)
  expect(result).toMatchObject({ current: 'fakeagent', card: { title: 'ใช้ Fake Agent' } })
  await golden('provider-use', result)

  const said = await neo(dir, ['say', 'นีโอ สวัสดี'])
  expect(said.code).toBe(0)
  expect(said.stdout).toContain('# turn 1')
  expect(said.stdout).toContain('sid S1')
  expect(await claudeCalls(dir)).toBe(0)
  expect((await neo(dir, ['status', '--json'])).stdout).toContain('"provider":"Fake Agent"')
  expect((await neo(dir, ['provider', 'use', 'nope'])).code).toBe(1)
})

test('the choice is remembered in state.json across a restart of the core', async () => {
  const { dir } = await running()
  await neo(dir, ['provider', 'use', 'fakeagent'])
  await neo(dir, ['model', 'use', 'm1'])
  const state = JSON.parse(await readFile(join(dir, 'state.json'), 'utf8'))
  expect(state).toMatchObject({ provider: 'fakeagent', model: { fakeagent: 'm1' } })
})

test('neo provider discover lists what the machine offers', async () => {
  const { dir } = await running()
  const out = await neo(dir, ['provider', 'discover', '--json'])
  const agents = JSON.parse(out.stdout)
  expect(agents).toEqual([{ name: 'fakeagent', label: 'Fake Agent', type: 'acp', available: true, via: 'PATH fake' }])
  await golden('provider-discover', agents)
})

test('provider config set stores the key 0600 in NEO_HOME, and no output ever shows it', async () => {
  const { dir } = await running()
  const cfg = join(dir, 'cfg.json')
  await writeFile(cfg, JSON.stringify({ type: 'openai', label: 'Router', baseUrl: 'http://127.0.0.1:1/v1', model: 'm', models: { เร็ว: 'm' } }))
  const set = await neo(dir, ['provider', 'config', 'set', 'router', '--file', cfg, '--api-key-stdin'], 'sk-super-secret\n')
  expect(set.code).toBe(0)
  const key = join(dir, 'router.key')
  expect(await readFile(key, 'utf8')).toBe('sk-super-secret\n')
  expect((await stat(key)).mode & 0o777).toBe(0o600)
  const outputs = [set.stdout, set.stderr, (await neo(dir, ['provider', 'config'])).stdout, (await neo(dir, ['provider', 'config', '--json'])).stdout, await readFile(join(dir, 'providers.json'), 'utf8')]
  for (const text of outputs) expect(text).not.toContain('sk-super-secret')
  const view = JSON.parse((await neo(dir, ['provider', 'config', '--json'])).stdout)
  expect(view.keys.router).toBe(true)
  await golden('provider-config', view)
  expect((await neo(dir, ['provider', 'config', 'router'])).stdout).toContain('Router')

  // a key inside the file is refused, and an empty stdin is refused
  const bad = join(dir, 'bad.json')
  await writeFile(bad, JSON.stringify({ type: 'openai', baseUrl: 'http://x', apiKey: 'sk-leak' }))
  const refused = await neo(dir, ['provider', 'config', 'set', 'bad', '--file', bad])
  expect(refused.code).toBe(1)
  expect(refused.stderr).toContain('--api-key-stdin')
  expect((await neo(dir, ['provider', 'config', 'set', 'router', '--file', cfg, '--api-key-stdin'], '  ')).code).toBe(1)
  expect((await neo(dir, ['provider', 'config', 'set', 'router'])).code).toBe(2)

  expect((await neo(dir, ['provider', 'config', 'rm', 'router'])).code).toBe(0)
  expect((await neo(dir, ['provider', 'list', '--json'])).stdout).not.toContain('router')
})

test('neo model list shows nicknames and models; neo model use emits model, then a card', async () => {
  const { dir } = await running()
  await writeFile(join(dir, 'cfg.json'), JSON.stringify({ models: { เร็ว: 'm1' } }))
  await neo(dir, ['provider', 'config', 'set', 'fakeagent', '--file', join(dir, 'cfg.json')])
  await neo(dir, ['provider', 'use', 'fakeagent'])
  const list = await neo(dir, ['model', 'list'])
  expect(list.stdout).toContain('เร็ว → m1')
  expect(list.stdout).toContain('- m0 — M0')
  const json = JSON.parse((await neo(dir, ['model', 'list', '--json'])).stdout)
  await golden('model-list', json)

  const w = watch(dir)
  await Bun.sleep(150)
  const used = await neo(dir, ['model', 'use', 'เร็ว', '--json'])
  expect(used.code).toBe(0)
  await golden('model-use', JSON.parse(used.stdout))
  const model = await w.poll(e => e.type === 'model')
  await w.poll(e => e.type === 'card' && e.card.title === 'โมเดล เร็ว')
  await w.stop()
  expect(model).toMatchObject({ name: 'fakeagent', model: 'เร็ว', id: 'm1' })
  await golden('event-model', model)
  const order = w.lines.map(e => e.type).filter(t => t === 'model' || t === 'card')
  expect(order).toEqual(['model', 'card'])
  expect((await neo(dir, ['say', 'นีโอ ทดสอบ'])).stdout).toContain('model m1')
  expect((await neo(dir, ['model', 'use', 'x', '--provider', 'nope'])).code).toBe(1)
})

test('neo provider use announces a provider event, then a card', async () => {
  const { dir } = await running()
  const w = watch(dir)
  await Bun.sleep(150)
  await neo(dir, ['provider', 'use', 'fakeagent'])
  const event = await w.poll(e => e.type === 'provider')
  await w.poll(e => e.type === 'card')
  await w.stop()
  expect(event).toMatchObject({ name: 'fakeagent', label: 'Fake Agent' })
  await golden('event-provider', event)
})

test('saying "สลับไปใช้ X" / "ใช้โมเดล X" switches without asking any Brain', async () => {
  const { dir } = await running()
  const switched = await neo(dir, ['say', 'นีโอ สลับไปใช้ fakeagent'])
  expect(switched.stdout).toContain('# ใช้ Fake Agent')
  const model = await neo(dir, ['say', 'นีโอ ใช้โมเดล m1'])
  expect(model.stdout).toContain('# โมเดล m1')
  const back = await neo(dir, ['say', 'นีโอ เปลี่ยนไปใช้ claude'])
  expect(back.stdout).toContain('# ใช้ Claude Code')
  expect(await claudeCalls(dir)).toBe(0)
  expect(JSON.parse(await readFile(join(dir, 'state.json'), 'utf8'))).toMatchObject({ provider: 'claude', model: { fakeagent: 'm1' } })
  // anything else still goes to the Brain
  expect((await neo(dir, ['say', 'นีโอ ข่าววันนี้'])).stdout).toContain('ตอบ:')
  expect(await claudeCalls(dir)).toBe(1)
})

test('an ACP tool that is not read-only waits for ตกลง (30 s window); read-only ones never ask', async () => {
  const { dir, core, clock } = await running()
  await neo(dir, ['settings', 'set', 'bypass', 'false'])
  await neo(dir, ['provider', 'use', 'fakeagent'])
  const w = watch(dir)
  await Bun.sleep(150)

  const first = neo(dir, ['say', 'นีโอ PERM'])
  const question = await w.poll(e => e.type === 'card' && e.card.title === 'ใช้ Fake Agent?')
  expect(question.card.lines).toContain('Edit README.md')
  expect((await neo(dir, ['say', 'ตกลง'])).code).toBe(0)
  expect((await first).stdout).toContain('perm yes')

  const second = neo(dir, ['say', 'นีโอ PERM'])
  for (let i = 0; i < 100 && w.lines.filter(e => e.type === 'card' && e.card.title === 'ใช้ Fake Agent?').length < 2; i++) await Bun.sleep(20)
  clock.advance(31_000)
  expect((await second).stdout).toContain('perm no')
  await w.poll(e => e.type === 'thinking' && e.text === 'Edit README.md (ไม่ได้รับอนุญาต)')

  const read = await neo(dir, ['say', 'นีโอ READ'])
  expect(read.stdout).toContain('perm yes')
  await w.stop()
  expect(core.status().thinking).toBe(false)
})
