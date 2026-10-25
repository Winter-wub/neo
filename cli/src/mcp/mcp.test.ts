import { afterEach, expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tempHome } from '../../test/helpers'
import { createTools, safeUrl } from './tools'
import { handleMessage, type JsonRpcResponse } from './server'

const FAKE_BIN = join(import.meta.dir, '../../test/fake-bin')
const cleanups: Array<() => Promise<unknown>> = []
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map(c => c()))
})

async function setup() {
  const { dir, cleanup } = await tempHome()
  cleanups.push(cleanup)
  const orcaLog = join(dir, 'orca.log')
  const egoLog = join(dir, 'ego.log')
  const tools = createTools({
    env: { ORCA_BIN: join(FAKE_BIN, 'orca'), EGO_BIN: join(FAKE_BIN, 'ego-browser'), FAKE_ORCA_LOG: orcaLog, FAKE_EGO_LOG: egoLog, PATH: process.env.PATH },
    home: '/Users/x',
    now: () => 1_792_000_000_000 + 5 * 60_000,
  })
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const reply = (await handleMessage(tools, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } })) as JsonRpcResponse
    return reply.result as { content: Array<{ text: string }>; isError?: boolean }
  }
  const lines = async (file: string) => (await readFile(file, 'utf8').catch(() => '')).split('\n').filter(Boolean).map(l => JSON.parse(l))
  return { tools, call, orcaLog, egoLog, lines }
}

test('initialize echoes the protocol version and announces tools; ping answers; unknown method is -32601', async () => {
  const { tools } = await setup()
  const init = (await handleMessage(tools, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26' } })) as JsonRpcResponse
  expect(init.result).toEqual({ protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'neo-agents', version: '0.1.0' } })
  expect(await handleMessage(tools, { jsonrpc: '2.0', id: 2, method: 'ping' })).toEqual({ jsonrpc: '2.0', id: 2, result: {} })
  expect(await handleMessage(tools, { jsonrpc: '2.0', id: 3, method: 'nope' })).toMatchObject({ id: 3, error: { code: -32601 } })
  expect(await handleMessage(tools, { jsonrpc: '2.0', method: 'notifications/initialized' })).toBeUndefined()
})

test('tools/list names the six read-only tools', async () => {
  const { tools } = await setup()
  const reply = (await handleMessage(tools, { jsonrpc: '2.0', id: 1, method: 'tools/list' })) as JsonRpcResponse
  const listed = (reply.result as { tools: Array<{ name: string; annotations: unknown; inputSchema: { type: string } }> }).tools
  expect(listed.map(t => t.name)).toEqual(['orca_agents', 'orca_agent_output', 'orca_runs', 'orca_run_tasks', 'browser_search', 'browser_read'])
  expect(listed.every(t => JSON.stringify(t.annotations) === '{"readOnlyHint":true}' && t.inputSchema.type === 'object')).toBe(true)
})

test('orca_agents lists terminals with ANSI stripped, the last three preview lines and a relative time', async () => {
  const { call, orcaLog, lines } = await setup()
  const { content } = await call('orca_agents')
  expect(content[0]!.text).toBe([
    'handle: term_0123abcd-4567', 'title: build neo', 'agent: claude', 'worktree: ~/repo (main)',
    'connected: true', 'last output: 5 นาทีก่อน', 'preview: line2 / line3 / last line',
  ].join('\n'))
  expect(await lines(orcaLog)).toEqual([['terminal', 'list', '--json']])
})

test('orca_agent_output validates the handle, then returns the last lines (at least 5) without blanks or escapes', async () => {
  const { call, orcaLog, lines } = await setup()
  expect((await call('orca_agent_output', { handle: 'rm -rf' })).isError).toBe(true)
  expect(await lines(orcaLog)).toEqual([])
  const ok = await call('orca_agent_output', { handle: 'term_0123abcd-4567', lines: 2 })
  expect(ok.content[0]!.text).toBe('one\ntwo\nthree')
})

test('orca_runs counts workers per run; orca_run_tasks validates the run id and lists tasks', async () => {
  const { call } = await setup()
  expect((await call('orca_runs')).content[0]!.text).toBe('run: run_abc1\nobjective: ship ticket 07\nstatus: active\ncreated: 2026-10-26\nworkers: {"busy":2}')
  expect((await call('orca_run_tasks', { run_id: '../x' })).isError).toBe(true)
  expect((await call('orca_run_tasks', { run_id: 'run_abc1' })).content[0]!.text).toBe('t1 [done] write tests\nt2 [open] write code')
})

test('an orca failure comes back as an error result, not a crash', async () => {
  const { tools } = await setup()
  const broken = createTools({ env: { ORCA_BIN: '/nonexistent/orca', PATH: '' }, home: '/Users/x', now: () => 0 })
  const reply = (await handleMessage(broken, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'orca_agents' } })) as JsonRpcResponse
  expect(reply.result).toMatchObject({ isError: true })
  expect(tools).toBeDefined()
})

test('safeUrl allows only external http(s) hosts', () => {
  expect(safeUrl('https://example.com/a?b=1')).toBe('https://example.com/a?b=1')
  for (const bad of ['file:///etc/passwd', 'http://localhost:8000', 'http://127.0.0.1', 'http://192.168.1.5', 'http://10.0.0.1', 'http://172.20.1.1', 'http://169.254.1.1', 'http://nas.local', 'http://svc.internal', 'http://intranet', 'http://[::1]/', 'not a url']) {
    expect(() => safeUrl(bad)).toThrow()
  }
})

test('browser_read refuses local addresses without starting ego; for a public page it sends one script on stdin', async () => {
  const { call, egoLog, lines } = await setup()
  expect((await call('browser_read', { url: 'http://localhost:8000' })).isError).toBe(true)
  expect(await lines(egoLog)).toEqual([])
  const ok = await call('browser_read', { url: 'https://example.com/x' })
  expect(ok.content[0]!.text).toBe('T https://example.com/x\nhttps://example.com/x\n\nbody of https://example.com/x')
  const [run] = await lines(egoLog)
  expect(run.args).toEqual(['nodejs'])
  expect(run.script).toContain('page.goto("https://example.com/x")')
})

test('browser_search queries Google in Thai and lists the result links', async () => {
  const { call, lines, egoLog } = await setup()
  const { content } = await call('browser_search', { query: 'ราคาทอง & น้ำมัน' })
  expect(content[0]!.text).toStartWith('ผลค้นหา: T https://www.google.com/search?hl=th&q=')
  expect(content[0]!.text).toContain('1. ผลที่หนึ่ง — https://a.example/1')
  expect((await lines(egoLog))[0].script).toContain(encodeURIComponent('ราคาทอง & น้ำมัน'))
  expect((await call('browser_search', { query: '  ' })).isError).toBe(true)
})

test('when ego does not answer, the error carries its output without notice lines', async () => {
  const { call } = await setup()
  const { content, isError } = await call('browser_read', { url: 'https://ego-down.example.com' })
  expect(isError).toBe(true)
  expect(content[0]!.text).toBe('error: ego browser is not running\n')
})
