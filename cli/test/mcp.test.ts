// Ticket 07 end to end: `neo mcp` over stdio from the real entry point, and claude launched with an MCP config that points at it.
import { afterEach, expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { runCli } from '../src/adapters/command/cli'
import { startCommandServer } from '../src/adapters/command/server'
import { createCore } from '../src/core/core'
import { FakeClock, tempHome } from './helpers'

const FAKE_BIN = join(import.meta.dir, 'fake-bin')
const MAIN = join(import.meta.dir, '../src/main.ts')
const cleanups: Array<() => Promise<unknown>> = []
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map(c => c()))
})

/** Speak newline-delimited JSON-RPC to `neo mcp` and collect the replies until it exits. */
async function talk(messages: unknown[], env: Record<string, string> = {}) {
  const { dir, cleanup } = await tempHome()
  cleanups.push(cleanup)
  const child = Bun.spawn(['bun', MAIN, 'mcp'], {
    stdin: 'pipe', stdout: 'pipe', stderr: 'pipe',
    env: { PATH: process.env.PATH!, HOME: dir, NEO_LOG_DIR: join(dir, 'logs'), ORCA_BIN: join(FAKE_BIN, 'orca'), EGO_BIN: join(FAKE_BIN, 'ego-browser'), ...env },
  })
  for (const m of messages) child.stdin.write(JSON.stringify(m) + '\n')
  child.stdin.end()
  const [stdout, code] = await Promise.all([new Response(child.stdout).text(), child.exited])
  return { code, replies: stdout.split('\n').filter(Boolean).map(l => JSON.parse(l)) }
}

test('`neo mcp` answers initialize and lists its tools over stdio, then exits when stdin closes', async () => {
  const { code, replies } = await talk([
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'orca_runs', arguments: {} } },
  ])
  expect(code).toBe(0)
  expect(replies.map(r => r.id)).toEqual([1, 2, 3])
  expect(replies[0].result.serverInfo.name).toBe('neo-agents')
  expect(replies[1].result.tools.map((t: { name: string }) => t.name)).toContain('browser_read')
  expect(replies[2].result.content[0].text).toContain('run: run_abc1')
})

async function running() {
  const { dir, cleanup } = await tempHome()
  cleanups.push(cleanup)
  const clock = new FakeClock()
  const core = await createCore({
    home: dir, clock, pid: 1,
    env: { PATH: `${FAKE_BIN}:${process.env.PATH}`, FAKE_CLAUDE_LOG: join(dir, 'calls.jsonl'), FAKE_CLAUDE_PIDS: join(dir, 'pids') },
  })
  const server = await startCommandServer({ core, clock, home: dir })
  cleanups.unshift(() => server.stop())
  return dir
}

async function neo(dir: string, args: string[]) {
  const out: string[] = []
  const code = await runCli([...args, '--home', dir], { out: t => void out.push(t), err: () => {}, env: {} })
  return { code, stdout: out.join('') }
}

test('claude is launched with an MCP config (0600, under NEO_HOME) whose neo-agents entry runs `<neo> mcp`', async () => {
  const dir = await running()
  await neo(dir, ['say', 'นีโอ ข่าววันนี้'])
  const [call] = (await readFile(join(dir, 'calls.jsonl'), 'utf8')).split('\n').filter(Boolean).map(l => JSON.parse(l))
  const file = join(dir, 'neo-mcp.json')
  expect(call.args[call.args.indexOf('--mcp-config') + 1]).toBe(file)
  const config = JSON.parse(await readFile(file, 'utf8'))
  expect(config.mcpServers['neo-agents']).toEqual({ command: process.execPath, args: ['mcp'] })
  expect((await Bun.file(file).stat()).mode & 0o777).toBe(0o600)
})

test('a skill confirm card, "ตกลง", then `neo cancel` stops the running skill and its process group', async () => {
  const dir = await running()
  const ask = await neo(dir, ['say', 'นีโอ @skillhang ดู jenkins'])
  expect(ask.stdout).toContain('ใช้ jenkins?')
  const run = neo(dir, ['say', 'ตกลง'])
  let written = ''
  for (let i = 0; i < 100 && !written.includes(' '); i++) {
    await Bun.sleep(50)
    written = await readFile(join(dir, 'pids'), 'utf8').catch(() => '')
  }
  const pids = written.split(' ').map(Number)
  expect(pids).toHaveLength(2)
  const alive = (pid: number) => { try { process.kill(pid, 0); return true } catch { return false } }
  expect(pids.every(alive)).toBe(true)
  const calls = (await readFile(join(dir, 'calls.jsonl'), 'utf8')).split('\n').filter(Boolean).map(l => JSON.parse(l))
  expect(calls.at(-1).args).toEqual(expect.arrayContaining(['--model', 'sonnet', '--permission-mode', 'bypassPermissions']))

  const cancelled = await neo(dir, ['cancel'])
  expect(cancelled.code).toBe(0)
  await run
  for (let i = 0; i < 100 && pids.some(alive); i++) await Bun.sleep(50)
  expect(pids.some(alive)).toBe(false)
})
