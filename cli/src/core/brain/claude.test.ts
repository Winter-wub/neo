import { afterEach, expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tempHome } from '../../../test/helpers'
import type { AskRequest } from './brain'
import { createClaudeBrain, type ClaudeBrainOptions } from './claude'

const FAKE_BIN = join(import.meta.dir, '../../../test/fake-bin')
const cleanups: Array<() => Promise<unknown>> = []
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map(c => c()))
})

interface Call { args: string[]; env: Record<string, string | null>; prompt: string }

async function setup(extra: Partial<ClaudeBrainOptions> & { env?: Record<string, string | undefined> } = {}) {
  const { dir, cleanup } = await tempHome()
  cleanups.push(cleanup)
  const log = join(dir, 'calls.jsonl')
  const pids = join(dir, 'pids')
  const { env, ...rest } = extra
  const brain = createClaudeBrain({
    cwd: join(dir, 'tasks'), mcpFile: join(dir, 'neo-mcp.json'), neoCommand: ['/bin/neo', 'mcp'], homeDir: '/home/me',
    env: { PATH: `${FAKE_BIN}:${process.env.PATH}`, FAKE_CLAUDE_LOG: log, FAKE_CLAUDE_PIDS: pids, ...env },
    ...rest,
  })
  const calls = async (): Promise<Call[]> =>
    (await readFile(log, 'utf8').catch(() => '')).split('\n').filter(Boolean).map(line => JSON.parse(line))
  return { dir, brain, calls, pids }
}

function request(text: string, over: Partial<AskRequest> = {}): AskRequest & { tools: Array<[string, string]> } {
  const tools: Array<[string, string]> = []
  return {
    text, resume: null, bypass: true, signal: new AbortController().signal,
    onTool: (name, input) => void tools.push([name, input]),
    context: { petName: 'จอห์น', wakeVariants: ['จอห์น', 'จอน'], memory: '', notes: [], now: new Date(2026, 9, 26, 9, 5) },
    ...over, tools,
  }
}

test('an ask returns the typed answer, the session id, and reports tool use as it happens', async () => {
  const { brain } = await setup()
  const req = request('สวัสดี')
  const reply = await brain.ask(req)
  expect(reply.answer).toMatchObject({ type: 'card', card: { layout: 'text', lines: ['ตอบ: สวัสดี', 'ที่มา [BBC](https://www.bbc.com/news/1)'] } })
  expect(reply.session).toMatch(/^sess-/)
  expect(req.tools).toEqual([['WebSearch', '{"query":"สวัสดี"}']])
})

test('bypass on: full permission flags, mcp config, prompt on stdin with the pet name and time', async () => {
  const { brain, calls, dir } = await setup({ model: () => 'opus' })
  await brain.ask(request('สวัสดี'))
  const [call] = await calls()
  expect(call!.args).toEqual([
    '-p', '--output-format', 'stream-json', '--verbose',
    '--model', 'opus', '--permission-mode', 'bypassPermissions', '--add-dir', '/home/me', '--mcp-config', join(dir, 'neo-mcp.json'),
  ])
  expect(call!.prompt).toContain('คุณคือ "จอห์น"')
  expect(call!.prompt).toContain('2026-10-26 09:05 (จันทร์)')
  expect(call!.env.cwd).toEndWith('/tasks')
})

test('bypass off: strict mcp, read-only tool list, no bypass flag', async () => {
  const { brain, calls } = await setup()
  await brain.ask(request('สวัสดี', { bypass: false }))
  const { args } = (await calls())[0]!
  expect(args).toContain('--strict-mcp-config')
  expect(args).not.toContain('--permission-mode')
  expect(args[args.indexOf('--tools') + 1]).toBe('WebSearch,WebFetch,Skill')
  expect(args[args.indexOf('--allowedTools') + 1]).toContain('mcp__MCP_DOCKER__jira_search')
  expect(args[args.indexOf('--allowedTools') + 1]).not.toContain('Bash')
})

test('a resumed ask passes --resume and sends only the follow-up prompt with the notes', async () => {
  const { brain, calls } = await setup()
  const first = await brain.ask(request('หนึ่ง'))
  const second = await brain.ask(request('แล้วสองล่ะ', { resume: first.session, context: { ...request('').context, notes: ['ผู้ใช้: "อากาศ" → แสดง: ฝนตก'] } }))
  const [, call] = await calls()
  expect(call!.args.slice(-2)).toEqual(['--resume', first.session!])
  expect(call!.prompt).toContain('ผู้ใช้พูดต่อ: "แล้วสองล่ะ"')
  expect(call!.prompt).toContain('ฝนตก')
  expect(call!.prompt).not.toContain('คุณคือ')
  expect(second.session).toBe(first.session)
})

test('CLAUDECODE* is stripped from the child env', async () => {
  const { brain, calls } = await setup({ env: { CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'cli', CLAUDECODE_X: 'y' } })
  await brain.ask(request('สวัสดี'))
  expect((await calls())[0]!.env).toMatchObject({ CLAUDECODE: null, CLAUDE_CODE_ENTRYPOINT: null })
})

test('CLAUDE_CONFIG_DIR is passed only when the setting has a value', async () => {
  const unset = await setup()
  await unset.brain.ask(request('a'))
  expect((await unset.calls())[0]!.env.CLAUDE_CONFIG_DIR).toBeNull()

  const set = await setup({ claudeConfigDir: () => '/cfg/claude' })
  await set.brain.ask(request('a'))
  expect((await set.calls())[0]!.env.CLAUDE_CONFIG_DIR).toBe('/cfg/claude')

  const empty = await setup({ claudeConfigDir: () => '' })
  await empty.brain.ask(request('a'))
  expect((await empty.calls())[0]!.env.CLAUDE_CONFIG_DIR).toBeNull()
})

test('the mcp config holds the chosen servers from the config dir plus neo-agents, mode 0600', async () => {
  const { brain, dir } = await setup({ claudeConfigDir: () => join(import.meta.dir, 'fixtures-mcp') })
  await brain.ask(request('a'))
  const file = join(dir, 'neo-mcp.json')
  const config = JSON.parse(await readFile(file, 'utf8'))
  expect(config.mcpServers['neo-agents']).toEqual({ command: '/bin/neo', args: ['mcp'] })
  expect(Object.keys(config.mcpServers).sort()).toEqual(['MCP_DOCKER', 'neo-agents'])
  expect(((await Bun.file(file).stat()).mode & 0o777)).toBe(0o600)
})

test('intents come back typed', async () => {
  const { brain } = await setup()
  expect((await brain.ask(request('@weather'))).answer).toEqual({ type: 'weather', place: 'เชียงใหม่', day: 1 })
  expect((await brain.ask(request('@skill'))).answer).toMatchObject({ type: 'skill', skill: 'jenkins' })
})

test('failures are typed errors, never exceptions', async () => {
  const { brain } = await setup()
  expect((await brain.ask(request('@crash'))).answer).toEqual({ type: 'error', error: 'no result' })
  expect((await brain.ask(request('@text'))).answer).toEqual({ type: 'error', error: 'bad json' })
  expect((await brain.ask(request('@error'))).answer).toEqual({ type: 'error', error: 'Credit balance is too low' })
  const missing = await setup({ command: 'claude-does-not-exist' })
  expect((await missing.brain.ask(request('a'))).answer).toEqual({ type: 'error', error: 'ไม่พบคำสั่ง claude-does-not-exist' })
})

const alive = (pid: number) => {
  try { process.kill(pid, 0); return true } catch { return false }
}

test('aborting kills the child and its helpers (the whole process group)', async () => {
  const { brain, pids } = await setup()
  const abort = new AbortController()
  const pending = brain.ask(request('@hang', { signal: abort.signal }))
  let written = ''
  for (let i = 0; i < 100 && !written.includes(' '); i++) {
    await Bun.sleep(50)
    written = await readFile(pids, 'utf8').catch(() => '')
  }
  const [child, helper] = written.split(' ').map(Number) as [number, number]
  expect(alive(child) && alive(helper)).toBe(true)
  abort.abort()
  expect((await pending).answer).toEqual({ type: 'error', error: 'interrupted' })
  for (let i = 0; i < 60 && (alive(child) || alive(helper)); i++) await Bun.sleep(50)
  expect(alive(child)).toBe(false)
  expect(alive(helper)).toBe(false)
})

test('a run that takes too long is killed with a timeout error', async () => {
  const { brain } = await setup({ timeouts: { full: 300 } })
  const reply = await brain.ask(request('@hang'))
  expect(reply.answer).toEqual({ type: 'error', error: 'timeout' })
})

test('runSkill uses sonnet with bypass, no mcp and no resume; non-JSON output still becomes a card', async () => {
  const { brain, calls } = await setup()
  const reply = await brain.runSkill({ skill: 'jenkins', plan: 'ดู build', task: 'เปิด jenkins แล้วสรุป', petName: 'จอห์น', signal: new AbortController().signal, onTool() {} })
  expect(reply.answer).toMatchObject({ type: 'card', card: { title: 'ทำเสร็จแล้ว', lines: ['build ล่าสุดผ่านหมด'] } })
  const { args, prompt } = (await calls())[0]!
  expect(args.slice(4)).toEqual(['--model', 'sonnet', '--permission-mode', 'bypassPermissions'])
  expect(prompt).toContain('โดยใช้ skill "jenkins"')
})

test('a dream is a read-only run whose prompt carries the memory and the journal, and comes back typed', async () => {
  const { brain, calls } = await setup()
  const tools: string[] = []
  const result = await brain.dream!({
    petName: 'จอห์น', memory: '## ผู้ใช้\n- ชอบกาแฟ', quietHours: [2, 3],
    entries: [{ at: new Date(2026, 9, 25, 9, 5).getTime(), q: 'ฝนตกไหม', a: 'ตก', ok: true }, { at: new Date(2026, 9, 25, 9, 6).getTime(), q: 'ซื้อตั๋ว', a: 'ไม่สำเร็จ', ok: false }],
    signal: new AbortController().signal, onTool: name => void tools.push(name),
  })
  expect(result).toEqual({
    type: 'dream',
    memory: '## ผู้ใช้\n- ชอบแมวทดสอบระบบ\n- ทำงานด้านสัญญาหลังบ้าน',
    insights: [{ q: 'ทดสอบ', finding: 'ไม่มีอะไรเพิ่ม' }],
    patterns: ['ถามตอนเช้า'],
    dream: 'ฝันถึงปลาทอง',
    card: { title: 'ฝันแล้ว', lines: ['ฝันถึงปลาทอง'], items: [] },
  })
  expect(tools).toEqual(['WebSearch'])
  const [call] = await calls()
  expect(call!.prompt).toContain('"จอห์น"')
  expect(call!.prompt).toContain('- ชอบกาแฟ')
  expect(call!.prompt).toContain('2026-10-25 09:05 | ฝนตกไหม → ตก')
  expect(call!.prompt).toContain('2026-10-25 09:06 | ซื้อตั๋ว → ไม่สำเร็จ | ok=false')
  expect(call!.prompt).toContain('2, 3')
  expect(call!.args).toContain('--strict-mcp-config') // read-only tool set, never bypass
  expect(call!.args).not.toContain('bypassPermissions')
})

test('a dream that does not answer in JSON is an error, not a half-dream', async () => {
  const { brain } = await setup()
  const result = await brain.dream!({ petName: 'จอห์น', memory: '@dreambad', entries: [], quietHours: [], signal: new AbortController().signal, onTool() {} })
  expect(result).toMatchObject({ type: 'error' })
})
