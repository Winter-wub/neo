import { afterEach, expect, test } from 'bun:test'
import { createCore } from '../../core/core'
import { FakeClock, golden, tempHome } from '../../../test/helpers'
import { startCommandServer } from './server'
import { runCli } from './cli'

const cleanups: Array<() => Promise<unknown>> = []
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map(c => c()))
})

async function running() {
  const { dir, cleanup } = await tempHome()
  cleanups.push(cleanup)
  const clock = new FakeClock()
  const core = await createCore({ home: dir, clock, pid: 4242 })
  const server = await startCommandServer({ core, clock, home: dir })
  cleanups.unshift(() => server.stop())
  clock.advance(65_000)
  return { dir, core, clock }
}

function capture(extra: { signal?: AbortSignal } = {}) {
  const out: string[] = []
  const err: string[] = []
  return {
    out, err,
    io: { out: (t: string) => void out.push(t), err: (t: string) => void err.push(t), env: {}, ...extra },
    stdout: () => out.join(''),
    stderr: () => err.join(''),
  }
}

test('neo status prints a markdown snapshot', async () => {
  const { dir } = await running()
  const c = capture()
  expect(await runCli(['status', '--home', dir], c.io)).toBe(0)
  expect(c.stdout()).toContain('# Neo')
  expect(c.stdout()).toContain('**pid:** 4242')
  expect(c.stdout()).toContain('1 นาที 5 วินาที')
  expect(c.stderr()).toBe('')
})

test('neo status --json prints the protocol shape', async () => {
  const { dir } = await running()
  const c = capture()
  expect(await runCli(['status', '--json', '--home', dir], c.io)).toBe(0)
  const status = JSON.parse(c.stdout())
  expect(status).toEqual({
    phone: false, consoles: 0, provider: 'Claude Code', model: null, thinking: false, ringing: false, busy: false,
    requireName: true, bypass: true, pet: null, uptime: 65, pid: 4242,
  })
  await golden('status', status)
})

test('neo settings and settings set', async () => {
  const { dir } = await running()
  const c = capture()
  expect(await runCli(['settings', 'set', 'followUp', 'false', '--json', '--home', dir], c.io)).toBe(0)
  const after = JSON.parse(c.stdout())
  expect(after).toEqual({
    requireName: true, followUp: false, bypass: true, tailscale: true, lan: false,
    idle: { sleepAfter: 150, clock: true }, dream: true, onboarded: false,
    claudeConfigDir: null, home: { city: 'กรุงเทพฯ', lat: 13.75, lon: 100.52 }, mcpServers: null,
  })
  await golden('settings', after)
  const again = capture()
  expect(await runCli(['settings', '--home', dir], again.io)).toBe(0)
  expect(again.stdout()).toContain('**followUp:** false')
})

test('daemon down: exit 3, Thai message on stderr, {error, code} on stdout with --json', async () => {
  const { dir, cleanup } = await tempHome()
  cleanups.push(cleanup)
  const plain = capture()
  expect(await runCli(['status', '--home', dir], plain.io)).toBe(3)
  expect(plain.stdout()).toBe('')
  expect(plain.stderr()).toContain('Neo ไม่ได้ทำงานอยู่')

  const json = capture()
  expect(await runCli(['status', '--json', '--home', dir], json.io)).toBe(3)
  const body = JSON.parse(json.stdout())
  expect(body).toEqual({ error: expect.stringContaining('Neo ไม่ได้ทำงานอยู่'), code: 3 })
  await golden('error-daemon-down', { ...body, error: body.error.replace(dir, '<home>') })
})

test('usage errors exit 2 without touching the daemon', async () => {
  const { dir, cleanup } = await tempHome()
  cleanups.push(cleanup)
  const c = capture()
  expect(await runCli(['frobnicate', '--home', dir], c.io)).toBe(2)
  expect(c.stderr()).toContain('ไม่รู้จักคำสั่ง frobnicate')
  const json = capture()
  expect(await runCli(['status', '--bogus', '--json', '--home', dir], json.io)).toBe(2)
  expect(JSON.parse(json.stdout())).toMatchObject({ code: 2 })
  await golden('error-usage', { error: 'ไม่รู้จักตัวเลือก --bogus\nดู: neo --help', code: 2 })
})

test('quiet keeps the exit code but silences stderr', async () => {
  const { dir, cleanup } = await tempHome()
  cleanups.push(cleanup)
  const c = capture()
  expect(await runCli(['status', '-q', '--home', dir], c.io)).toBe(3)
  expect(c.stderr()).toBe('')
})

test('neo settings set takes every key; a bad value exits 1 with a Thai message', async () => {
  const { dir } = await running()
  const run = async (...argv: string[]) => {
    const c = capture()
    return { code: await runCli([...argv, '--home', dir], c.io), out: c.stdout(), err: c.stderr() }
  }
  expect((await run('settings', 'set', 'idle.sleepAfter', '600', '--json')).code).toBe(0)
  expect((await run('settings', 'set', 'home', 'เชียงใหม่', '18.79', '98.98')).code).toBe(0)
  const all = await run('settings', '--json')
  const parsed = JSON.parse(all.out)
  expect(parsed).toMatchObject({ idle: { sleepAfter: 600 }, home: { city: 'เชียงใหม่' } })
  await golden('settings-all', { ...parsed, claudeConfigDir: '/Users/me/.claude', mcpServers: ['MCP_DOCKER'] })
  const bad = await run('settings', 'set', 'bypass', 'maybe')
  expect(bad.code).toBe(1)
  expect(bad.err).toContain('true หรือ false')
  const badJson = await run('settings', 'set', 'idle.sleepAfter', 'soon', '--json')
  expect(badJson.code).toBe(1)
  expect(JSON.parse(badJson.out)).toEqual({ error: 'idle.sleepAfter ต้องเป็นตัวเลข', code: 1 })
  expect((await run('settings')).out).toContain('**idle.sleepAfter:** 600')
})

test('the daemon rejects a bad settings value with code 1', async () => {
  const { dir } = await running()
  // the argv parser validates first, so go around it with the raw route
  const { connect } = await import('./client')
  const err = await connect(dir).call('POST /settings', { bypass: 3 } as never).catch(e => e)
  expect(err.code).toBe(1)
})

async function until(cond: () => boolean) {
  for (let i = 0; i < 100 && !cond(); i++) await Bun.sleep(20)
  expect(cond()).toBe(true)
}

test('neo events --json streams a status event, then settings changes; ctrl-c exits 0', async () => {
  const { dir, core } = await running()
  const abort = new AbortController()
  const c = capture({ signal: abort.signal })
  const done = runCli(['events', '--json', '--home', dir], c.io)
  await until(() => c.out.length >= 1)
  await core.settings.set({ bypass: false })
  await until(() => c.out.length >= 2)
  abort.abort()
  expect(await done).toBe(0)
  const lines = c.out.map(l => JSON.parse(l))
  expect(lines[0]).toMatchObject({ type: 'status', consoles: 1 })
  expect(lines[1]).toMatchObject({ type: 'settings', bypass: false })
  await golden('event-status', lines[0])
  await golden('event-settings', lines[1])
})

test('neo events --history replays the backlog first, in markdown by default', async () => {
  const { dir, core } = await running()
  await core.settings.set({ followUp: false })
  const abort = new AbortController()
  const c = capture({ signal: abort.signal })
  const done = runCli(['events', '--history', '--home', dir], c.io)
  await until(() => c.out.length >= 2)
  abort.abort()
  await done
  expect(c.out[0]).toMatch(/settings\s+requireName=true followUp=false/)
  expect(c.out[1]).toMatch(/status\s+มือถือ ไม่เชื่อม · คอนโซล 1/)
})

test('events history is capped at 400 lines', async () => {
  const { dir, core } = await running()
  for (let i = 0; i < 450; i++) await core.settings.set({ bypass: i % 2 === 1 })
  const abort = new AbortController()
  const c = capture({ signal: abort.signal })
  const done = runCli(['events', '--history', '--json', '--home', dir], c.io)
  await until(() => c.out.length >= 401)
  abort.abort()
  await done
  expect(c.out).toHaveLength(401) // 400 replayed + the live status for this console
})
