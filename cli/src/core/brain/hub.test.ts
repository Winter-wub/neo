import { afterEach, expect, test } from 'bun:test'
import { readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { FakeClock, tempHome } from '../../../test/helpers'
import type { NeoEvent } from '../../protocol'
import { createEvents } from '../events/events'
import type { AskRequest, Brain } from './brain'
import type { Discovery } from './discover'
import { BrainError, createBrainHub, type HubOptions } from './hub'

const FAKE_AGENT = join(import.meta.dir, '../../../test/fake-acp-agent.js')
const cleanups: Array<() => Promise<unknown> | void> = []
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map(c => c()))
})

const AGENT = { name: 'fakeagent', label: 'Fake Agent', type: 'acp' as const, available: true, command: process.execPath, args: [FAKE_AGENT], via: 'PATH fake' }
const machine = (agents: Discovery['agents']): Discovery => ({ agents, acpx: true })

function request(text: string, over: Partial<AskRequest> = {}): AskRequest {
  return {
    text, resume: null, bypass: false, signal: new AbortController().signal, onTool() {},
    context: { petName: 'จอห์น', wakeVariants: ['จอห์น'], memory: '', notes: [], now: new Date(2026, 9, 26, 9, 5) },
    ...over,
  }
}

async function setup(over: Partial<HubOptions> = {}, agents: Discovery['agents'] = [AGENT], state: Record<string, unknown> = {}, file?: object) {
  const { dir, cleanup } = await tempHome()
  cleanups.push(cleanup)
  if (file) await writeFile(join(dir, 'providers.json'), JSON.stringify(file))
  const events = createEvents({ clock: new FakeClock() })
  const log: NeoEvent[] = []
  events.subscribe(e => log.push(e))
  const claudeModels: Array<string | null> = []
  const claudeAsks: string[] = []
  const state_ = { ...state }
  const hub = await createBrainHub({
    home: dir, events, env: { ...process.env }, homeDir: dir,
    store: { read: key => state_[key], write: async (key, value) => void (state_[key] = value) },
    claude: model => ({
      label: 'Claude Code',
      ask: async r => (claudeModels.push(model()), claudeAsks.push(r.text), { answer: { type: 'error', error: 'fake claude' }, session: null }),
      runSkill: async () => ({ answer: { type: 'error', error: 'fake claude' }, session: null }),
    } satisfies Brain),
    mcp: { neoCommand: ['/bin/neo', 'mcp'], configDir: () => join(dir, 'no-claude-config') },
    discover: async () => machine(agents),
    bypass: () => false,
    ...over,
  })
  cleanups.push(() => hub.stop())
  return { hub, dir, events: log, state: state_, claudeModels, claudeAsks }
}

const types = (log: NeoEvent[]) => log.map(e => e.type)

test('before discovery only Claude Code exists; discovery adds the agents that can run here', async () => {
  const { hub, events } = await setup()
  expect(hub.list()).toEqual({ current: 'claude', list: [{ name: 'claude', label: 'Claude Code', type: 'claude-code', found: true, model: null }] })
  expect(hub.brain.label).toBe('Claude Code')
  await hub.refresh()
  expect(hub.list().list.map(p => [p.name, p.label, p.type])).toEqual([['claude', 'Claude Code', 'claude-code'], ['fakeagent', 'Fake Agent', 'acp']])
  expect(events).toEqual([]) // nothing in use changed: the stream stays quiet
  await hub.refresh({ announce: true }) // `neo provider discover`
  expect(events.at(-1)).toMatchObject({ type: 'provider', name: 'claude', label: 'Claude Code' })
})

test('the starting provider: NEO_PROVIDER, then the saved choice, then providers.json default', async () => {
  const saved = await setup({}, [AGENT], { provider: 'fakeagent' })
  await saved.hub.refresh()
  expect(saved.hub.current()).toBe('fakeagent') // chosen before the agent was discovered: picked up once it is
  const env = await setup({ env: { NEO_PROVIDER: 'claude' } }, [AGENT], { provider: 'fakeagent' })
  await env.hub.refresh()
  expect(env.hub.current()).toBe('claude')
  const gone = await setup({}, [], { provider: 'fakeagent' })
  expect(gone.hub.current()).toBe('claude') // not available → falls back
})

test('use: remembers the choice, announces it, answers with a card, and the next ask goes to that provider', async () => {
  const { hub, events, state, claudeAsks } = await setup()
  await hub.refresh()
  events.length = 0
  const card = await hub.use('fakeagent')
  expect(card).toMatchObject({ title: 'ใช้ Fake Agent', lines: ['ต่อจากนี้ นีโอ ถาม Fake Agent แทน', 'พูด "สลับไปใช้ …" เพื่อเปลี่ยนอีก'] })
  expect(events).toMatchObject([{ type: 'provider', name: 'fakeagent', label: 'Fake Agent' }])
  expect(state.provider).toBe('fakeagent')
  expect(hub.brain.label).toBe('Fake Agent')
  const reply = await hub.brain.ask(request('สวัสดี'))
  expect(reply.answer).toMatchObject({ type: 'card', card: { title: 'turn 1' } })
  expect(claudeAsks).toEqual([])
  expect(hub.status()).toEqual({ provider: 'Fake Agent', model: null })
  await hub.use('claude')
  expect((await hub.brain.ask(request('x'))).answer).toEqual({ type: 'error', error: 'fake claude' })
  await expect(hub.use('nope')).rejects.toThrow(BrainError)
})

test('models: the list comes from the agent, nicknames are mapped, and use stores the choice then emits model', async () => {
  const { hub, events, state } = await setup({}, [AGENT], {}, { providers: { fakeagent: { models: { เร็ว: 'm1' } } } })
  await hub.refresh()
  await hub.use('fakeagent')
  expect(await hub.listModels()).toEqual({ name: 'fakeagent', mapped: [{ alias: 'เร็ว', id: 'm1' }], list: [{ id: 'm0', name: 'M0' }, { id: 'm1', name: 'M1' }], current: null })
  events.length = 0
  const card = await hub.useModel('เร็ว')
  expect(events).toMatchObject([{ type: 'model', name: 'fakeagent', model: 'เร็ว', id: 'm1' }])
  expect(card).toMatchObject({ title: 'โมเดล เร็ว', lines: ['Fake Agent', 'm1'] })
  expect(state.model).toEqual({ fakeagent: 'เร็ว' })
  expect(hub.status().model).toBe('เร็ว')
  const reply = await hub.brain.ask(request('x'))
  expect(JSON.stringify(reply.answer)).toContain('model m1') // the agent got the real id
})

test('use model emits `model` with the nickname and the id; "default" for Claude Code means its own default', async () => {
  const { hub, events, claudeModels } = await setup()
  events.length = 0
  const card = await hub.useModel('opus')
  expect(types(events)).toEqual(['model'])
  expect(events[0]).toMatchObject({ type: 'model', name: 'claude', model: 'opus', id: 'opus' })
  expect(card).toMatchObject({ title: 'โมเดล opus', lines: ['Claude Code'] })
  await hub.brain.ask(request('a'))
  await hub.useModel('default')
  await hub.brain.ask(request('b'))
  expect(claudeModels).toEqual(['opus', null])
  await hub.useModel(null)
  expect(hub.status().model).toBeNull()
  await expect(hub.useModel('x', 'nope')).rejects.toThrow('ไม่รู้จัก provider nope')
})

test('Claude Code lists models through the Claude ACP agent on this Mac, or none', async () => {
  const none = await setup()
  expect((await none.hub.listModels()).list).toEqual([])
  const withAcp = await setup({}, [{ ...AGENT, name: 'claude-acp', label: 'Claude Code (ACP)' }])
  await withAcp.hub.refresh()
  expect((await withAcp.hub.listModels('claude')).list.map(m => m.id)).toEqual(['m0', 'm1'])
})

test('listing models never throws: a failing endpoint comes back as `error`', async () => {
  const { hub } = await setup()
  await hub.saveConfig({ name: 'dead', cfg: { type: 'openai', baseUrl: 'http://127.0.0.1:1', label: 'Dead' } })
  const result = await hub.listModels('dead')
  expect(result).toMatchObject({ name: 'dead', list: [], current: null })
  expect(result.error).toBeTruthy()
})

test('spoken switches: provider by name or alias, model by nickname or list; everything else goes on to the Brain', async () => {
  const { hub, state } = await setup()
  await hub.refresh()
  await hub.saveConfig({ name: 'fakeagent', cfg: { aliases: ['เฟค'], models: { เร็ว: 'm1' } } })
  expect(await hub.understand('วันนี้อากาศเป็นยังไง')).toBeNull()
  expect(await hub.understand('ใช้ไฟล์ที่สอง')).toBeNull() // "ใช้ X" with no such brain
  expect(await hub.understand('สลับไปใช้ เฟค')).toMatchObject({ title: 'ใช้ Fake Agent' })
  expect(state.provider).toBe('fakeagent')
  expect(await hub.understand('ใช้โมเดล เร็ว')).toMatchObject({ title: 'โมเดล เร็ว' })
  expect(await hub.understand('เปลี่ยนโมเดลเป็น m0')).toMatchObject({ title: 'โมเดล m0' })
  expect(state.model).toEqual({ fakeagent: 'm0' })
  expect(await hub.understand('ใช้โมเดล gpt ห้า')).toMatchObject({ title: 'ไม่รู้จักโมเดลนี้', emotion: 'confused' })
  expect(await hub.understand('สลับไปใช้ claude')).toMatchObject({ title: 'ใช้ Claude Code' })
})

test('config: a custom endpoint is saved, its key goes to a 0600 file in NEO_HOME and never into providers.json or any output', async () => {
  const { hub, dir, events } = await setup()
  events.length = 0
  await hub.saveConfig({ name: 'router', cfg: { type: 'openai', label: 'Router', baseUrl: 'https://example.test/v1', model: 'm', headers: { 'X-Title': 'Neo' } }, apiKey: 'sk-very-secret\n' })
  expect(events).toMatchObject([{ type: 'provider' }])
  const keyFile = join(dir, 'router.key')
  expect(await readFile(keyFile, 'utf8')).toBe('sk-very-secret\n')
  expect((await stat(keyFile)).mode & 0o777).toBe(0o600)
  const saved = await readFile(join(dir, 'providers.json'), 'utf8')
  expect(saved).not.toContain('sk-very-secret')
  expect(JSON.parse(saved).providers.router).toMatchObject({ type: 'openai', apiKeyFile: '~/router.key', baseUrl: 'https://example.test/v1' })
  const view = hub.config()
  expect(view.keys).toMatchObject({ router: true, claude: false })
  expect(JSON.stringify(view)).not.toContain('sk-very-secret')
  expect(hub.list().list.find(p => p.name === 'router')).toMatchObject({ type: 'openai', found: false })
})

test('config: bad input is refused with a reason; secrets in the file are refused; discovered agents keep only overrides', async () => {
  const { hub } = await setup()
  await hub.refresh()
  const refuse = (name: string, cfg: any, why: string) => expect(hub.saveConfig({ name, cfg })).rejects.toThrow(why)
  await refuse('Bad Name', { type: 'http', url: 'http://x' }, 'ชื่อใช้ได้แค่')
  await refuse('x', { type: 'telnet' }, 'type ต้องเป็น')
  await refuse('x', { type: 'openai' }, 'baseUrl')
  await refuse('x', { type: 'http' }, 'url')
  await refuse('x', { type: 'acp' }, 'command')
  await refuse('x', { type: 'openai', baseUrl: 'http://x', apiKey: 'sk-1' }, '--api-key-stdin')
  await refuse('x', 'nope', 'JSON object')
  await hub.saveConfig({ name: 'fakeagent', cfg: { type: 'acp', command: '/evil', label: 'Mine', models: { a: 'm1' } } })
  expect(hub.config().overrides.fakeagent).toEqual({ label: 'Mine', models: { a: 'm1' } }) // no command override
  expect(hub.config().providers.fakeagent).toMatchObject({ label: 'Mine', command: process.execPath })
})

test('config: remove clears an override and its chosen model; the provider in use cannot be removed', async () => {
  const { hub, state } = await setup()
  await hub.saveConfig({ name: 'mine', cfg: { type: 'http', url: 'http://127.0.0.1:1' } })
  await hub.use('mine')
  await hub.useModel('big')
  await expect(hub.saveConfig({ name: 'mine', remove: true })).rejects.toThrow('ลบตัวที่ใช้อยู่ไม่ได้')
  await hub.use('claude')
  await hub.saveConfig({ name: 'mine', remove: true })
  expect(hub.list().list.map(p => p.name)).toEqual(['claude'])
  expect(state.model).toEqual({})
  await expect(hub.saveConfig({ name: 'mine', remove: true })).rejects.toThrow('ไม่มีการตั้งค่า')
})

test('a broken providers.json is reported and ignored instead of crashing', async () => {
  const { dir, cleanup } = await tempHome()
  cleanups.push(cleanup)
  await writeFile(join(dir, 'providers.json'), '{ nope')
  const logged: string[] = []
  const hub = await createBrainHub({
    home: dir, events: createEvents({ clock: new FakeClock() }), env: {}, store: { read: () => undefined, write: async () => {} },
    claude: () => ({ label: 'C', ask: async () => { throw new Error('x') }, runSkill: async () => { throw new Error('x') } }),
    mcp: { neoCommand: ['/bin/neo', 'mcp'] }, bypass: () => false, log: m => void logged.push(m),
  })
  expect(hub.list().list.map(p => p.name)).toEqual(['claude'])
  expect(logged[0]).toContain('providers.json อ่านไม่ได้')
})

test('the switch card uses the pet name core passes in', async () => {
  const { hub } = await setup({ petName: () => 'จอห์น' })
  await hub.refresh()
  expect((await hub.use('fakeagent'))).toMatchObject({ lines: ['ต่อจากนี้ จอห์น ถาม Fake Agent แทน', 'พูด "สลับไปใช้ …" เพื่อเปลี่ยนอีก'] })
})

test('a long model id does not get cut in the card title; the full id goes in the lines', async () => {
  const { hub } = await setup()
  const long = await hub.useModel('opencode/deepseek-v4.1-flash-free')
  expect(long).toMatchObject({ title: 'เปลี่ยนโมเดล', lines: ['Claude Code', 'opencode/deepseek-v4.1-flash-free'] })
  expect(await hub.useModel('opencode/gpt-5')).toMatchObject({ title: 'gpt-5', lines: ['Claude Code', 'opencode/gpt-5'] })
  expect(await hub.useModel('opencode/gpt-5-mini-x')).toMatchObject({ title: 'gpt-5-mini-x', lines: ['Claude Code', 'opencode/gpt-5-mini-x'] })
})
