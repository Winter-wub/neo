import { afterEach, expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tempHome } from '../../../test/helpers'
import { createAcpBrain, pickMode, toAcpMcp, type AcpOptions } from './acp'
import type { AskRequest, PermissionRequest, Provider } from './brain'

const FAKE_AGENT = join(import.meta.dir, '../../../test/fake-acp-agent.js')
const cleanups: Array<() => Promise<unknown> | void> = []
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map(c => c()))
})

interface Logged { method: string; params: any; env: Record<string, string | null> }

async function setup(over: Partial<AcpOptions> & { cfg?: AcpOptions['cfg'] } = {}, env: Record<string, string> = {}) {
  const { dir, cleanup } = await tempHome()
  cleanups.push(cleanup)
  const log = join(dir, 'acp.jsonl')
  const brain: Provider = createAcpBrain({
    name: 'fake', cwd: join(dir, 'tasks'),
    cfg: { type: 'acp', label: 'Fake', command: process.execPath, args: [FAKE_AGENT] },
    env: { ...process.env, FAKE_ACP_LOG: log, ...env },
    mcpServers: () => [{ name: 'neo-agents', command: 'neo', args: ['mcp'], env: [] }],
    ...over,
  })
  cleanups.push(() => brain.stop?.())
  const calls = async (): Promise<Logged[]> =>
    (await readFile(log, 'utf8').catch(() => '')).split('\n').filter(Boolean).map(line => JSON.parse(line))
  return { brain, calls, dir }
}

function request(text: string, over: Partial<AskRequest> = {}): AskRequest & { tools: Array<[string, string]> } {
  const tools: Array<[string, string]> = []
  return {
    text, resume: null, bypass: false, signal: new AbortController().signal,
    onTool: (name, input) => void tools.push([name, input]),
    context: { petName: 'จอห์น', wakeVariants: ['จอห์น'], memory: '', notes: [], now: new Date(2026, 9, 26, 9, 5) },
    ...over, tools,
  }
}

const lines = (reply: { answer: any }) => (reply.answer.type === 'card' ? (reply.answer.card.lines as string[]) : [])

test('an ask answers with a card, reports tool use, passes the MCP servers and the full prompt', async () => {
  const { brain, calls } = await setup()
  const req = request('สวัสดี')
  const reply = await brain.ask(req)
  expect(reply.answer).toMatchObject({ type: 'card', card: { title: 'turn 1' } })
  expect(lines(reply)).toEqual(expect.arrayContaining(['sid S1', 'mcp neo-agents', 'fresh true']))
  expect(reply.session).toBe('S1')
  expect(req.tools).toEqual([['Search the web', 'search']])
  const prompt = (await calls()).find(c => c.method === 'session/prompt')!
  expect(prompt.params.prompt[0].text).toContain('คุณคือ "จอห์น"')
})

test('a resumed ask continues the same session with only the follow-up prompt; no resume starts a new one', async () => {
  const { brain, calls } = await setup()
  const first = await brain.ask(request('หนึ่ง'))
  const second = await brain.ask(request('สอง', { resume: first.session }))
  expect(second.answer).toMatchObject({ card: { title: 'turn 2' } })
  expect(lines(second)).toEqual(expect.arrayContaining(['sid S1', 'fresh false']))
  const prompts = (await calls()).filter(c => c.method === 'session/prompt')
  expect(prompts[1]!.params.prompt[0].text).toContain('ผู้ใช้พูดต่อ: "สอง"')
  const third = await brain.ask(request('สาม', { resume: null }))
  expect(third.answer).toMatchObject({ card: { title: 'turn 1' } })
  expect(third.session).toBe('S2')
  // a session id that is not ours (e.g. left from another provider) is never resumed
  const foreign = await brain.ask(request('สี่', { resume: 'sess-from-claude' }))
  expect(foreign.session).toBe('S3')
})

test('changing bypass starts a new session (the mode is picked when it opens)', async () => {
  const { brain } = await setup({}, { FAKE_MODES: 'plan,default,bypassPermissions' })
  const safe = await brain.ask(request('a', { bypass: false }))
  expect(lines(safe)).toContain('mode -')
  const open = await brain.ask(request('b', { bypass: true, resume: safe.session }))
  expect(open.session).not.toBe(safe.session)
  expect(lines(open)).toContain('mode bypassPermissions')
})

test('write actions ask the user; read-only tools and bypass never do', async () => {
  const asked: PermissionRequest[] = []
  const answer = (yes: boolean) => async (r: PermissionRequest) => (asked.push(r), yes)
  const { brain } = await setup()
  expect(lines(await brain.ask(request('PERM', { confirm: answer(true) })))).toContain('perm yes')
  expect(asked).toEqual([{ title: 'Edit README.md', kind: 'edit', agent: 'Fake' }])
  expect(lines(await brain.ask(request('PERM', { confirm: answer(false) })))).toContain('perm no')
  expect(lines(await brain.ask(request('PERM')))).toContain('perm no') // nobody to ask: denied
  asked.length = 0
  expect(lines(await brain.ask(request('READ', { confirm: answer(false) })))).toContain('perm yes')
  expect(lines(await brain.ask(request('PERM', { bypass: true, confirm: answer(false) })))).toContain('perm yes')
  expect(asked).toEqual([])
})

test('aborting answers "interrupted" at once, tells the agent to cancel, and the next ask starts clean', async () => {
  const { brain, calls } = await setup()
  const abort = new AbortController()
  const pending = brain.ask(request('SLOW', { signal: abort.signal }))
  await Bun.sleep(300)
  abort.abort()
  expect((await pending).answer).toEqual({ type: 'error', error: 'interrupted' })
  await Bun.sleep(100)
  expect((await calls()).some(c => c.method === 'session/cancel')).toBe(true)
  const next = await brain.ask(request('ต่อ', { resume: 'S1' }))
  expect(next.answer).toMatchObject({ type: 'card' })
  expect(next.session).toBe('S2')
})

test('a run that takes too long is cancelled with a timeout error', async () => {
  const { brain } = await setup({ timeoutMs: 250 })
  expect((await brain.ask(request('SLOW'))).answer).toEqual({ type: 'error', error: 'timeout' })
})

test('a missing or crashing agent is a typed error naming the provider, never an exception', async () => {
  const missing = await setup({ cfg: { type: 'acp', label: 'Nope', command: '/no/such/agent' } })
  expect((await missing.brain.ask(request('hi'))).answer).toEqual({ type: 'error', error: 'Nope: ไม่พบคำสั่ง /no/such/agent' })
  const crash = await setup({ cfg: { type: 'acp', label: 'Crashy', command: process.execPath, args: ['-e', 'process.stderr.write("boom\\n"); process.exit(3)'] } })
  const reply = await crash.brain.ask(request('hi'))
  expect(reply.answer).toMatchObject({ type: 'error' })
  expect((reply.answer as any).error).toContain('Crashy: ปิดตัว (3) boom')
})

test('an agent that answers in words still gets a text card', async () => {
  const { brain } = await setup()
  const reply = await brain.ask(request('TEXT'))
  expect(reply.answer).toMatchObject({ type: 'card', card: { title: 'จอห์น', lines: ['ตอบเป็นข้อความธรรมดา'] } })
})

test('models: listed from the agent (config option or models), chosen model applied, also mid-conversation', async () => {
  let model: string | null = 'm1'
  const a = await setup({ model: () => model })
  expect((await a.brain.listModels()).map(m => m.id)).toEqual(['m0', 'm1'])
  const first = await a.brain.ask(request('x'))
  expect(lines(first)).toContain('model m1')
  model = 'm0'
  expect(lines(await a.brain.ask(request('y', { resume: first.session })))).toContain('model m0')

  const b = await setup({ model: () => 'sonnet' }, { FAKE_MODELS: 'models' })
  expect((await b.brain.listModels()).map(m => m.id)).toEqual(['haiku', 'sonnet'])
  expect(lines(await b.brain.ask(request('x')))).toContain('model sonnet')
})

test('listing models opens an empty session and sends no prompt', async () => {
  const { brain, calls } = await setup()
  await brain.listModels()
  expect((await calls()).map(c => c.method)).toEqual(['initialize', 'session/new'])
})

test('config values are set on the session; CLAUDECODE* is stripped; CLAUDE_CONFIG_DIR only when set', async () => {
  const { brain, calls } = await setup(
    { cfg: { type: 'acp', command: process.execPath, args: [FAKE_AGENT], config: { mode: 'plan', temperature: 'low' } }, claudeConfigDir: () => undefined },
    { CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'cli' },
  )
  await brain.ask(request('x'))
  const all = await calls()
  const options = all.filter(c => c.method === 'session/set_config_option').map(c => [c.params.configId, c.params.value])
  expect(options).toEqual([['mode', 'plan'], ['temperature', 'low']])
  expect(all[0]!.env).toEqual({ CLAUDECODE: null, CLAUDE_CODE_ENTRYPOINT: null })
})

test('bypass skips the configured mode and picks the most permissive one the agent lists', () => {
  expect(pickMode(['auto', 'default', 'acceptEdits', 'plan', 'dontAsk', 'bypassPermissions'])).toBe('bypassPermissions')
  expect(pickMode(['build', 'plan'])).toBe('build')
  expect(pickMode(['plan', 'read-only'])).toBeNull()
})

test('MCP servers go to the agent in ACP shape; entries without a command are dropped', () => {
  expect(toAcpMcp({ a: { command: 'x', args: ['1'], env: { K: 'v' } }, b: { url: 'http://x' } })).toEqual([
    { name: 'a', command: 'x', args: ['1'], env: [{ name: 'K', value: 'v' }] },
  ])
})

test('skills are not an agent thing', async () => {
  const { brain } = await setup()
  const reply = await brain.runSkill({ skill: 's', plan: 'p', task: 't', petName: 'จอห์น', signal: new AbortController().signal, onTool() {} })
  expect(reply.answer).toMatchObject({ type: 'error' })
})
