// Runs the real compiled, signed binary as a separate process: argv, exit codes, idle timeout, signing.
import { afterAll, beforeAll, expect, test } from 'bun:test'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tempHome } from './helpers'

const cliDir = join(import.meta.dir, '..')
const bin = join(cliDir, 'dist', 'neo')
const cleanups: Array<() => Promise<unknown>> = []

beforeAll(async () => {
  const build = Bun.spawn(['bash', 'tools/build.sh'], { cwd: cliDir, stdout: 'pipe', stderr: 'pipe' })
  expect(await build.exited, await new Response(build.stderr).text()).toBe(0)
}, 120_000)
afterAll(async () => {
  await Promise.all(cleanups.splice(0).map(c => c()))
})

async function neo(args: string[], { env = {}, cwd }: { env?: Record<string, string>; cwd?: string } = {}) {
  const p = Bun.spawn([bin, ...args], { cwd, env: { PATH: process.env.PATH!, ...env }, stdout: 'pipe', stderr: 'pipe' })
  const [stdout, stderr, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited])
  return { stdout, stderr, code }
}

async function startDaemon(extraEnv: Record<string, string> = {}) {
  const { dir, cleanup } = await tempHome()
  const p = Bun.spawn([bin, 'daemon', 'run', '--home', dir, '--port', String(20_000 + Math.floor(Math.random() * 20_000))], {
    env: { PATH: process.env.PATH!, NEO_LOG_DIR: join(dir, 'logs'), NEO_DISCOVER: '0', ...extraEnv }, stdout: 'ignore', stderr: 'pipe',
  })
  cleanups.push(async () => { p.kill('SIGTERM'); await p.exited; await cleanup() })
  for (let i = 0; i < 100 && (await neo(['status', '--home', dir, '-q'])).code !== 0; i++) await Bun.sleep(50)
  return { dir, proc: p }
}

test('the binary is signed with hardened runtime and allow-jit, and passes strict verification', async () => {
  const verify = Bun.spawn(['codesign', '--verify', '--strict', bin], { stderr: 'pipe' })
  expect(await verify.exited).toBe(0)
  const info = Bun.spawn(['codesign', '-dvv', '--entitlements', '-', bin], { stdout: 'pipe', stderr: 'pipe' })
  const text = (await new Response(info.stdout).text()) + (await new Response(info.stderr).text())
  expect(text).toContain('flags=0x10000(runtime)')
  expect(text).toContain('com.apple.security.cs.allow-jit')
  expect(text).toContain('Authority=Apple Development')
  expect(text).toContain('Identifier=com.mochi.neo.cli')
})

test('exit codes: usage → 2, daemon down → 3 (Thai on stderr, {error, code} on stdout with --json)', async () => {
  const { dir, cleanup } = await tempHome()
  cleanups.push(cleanup)
  const usage = await neo(['nonsense', '--home', dir])
  expect(usage.code).toBe(2)
  const down = await neo(['status', '--home', dir])
  expect(down.code).toBe(3)
  expect(down.stderr).toContain('Neo ไม่ได้ทำงานอยู่')
  const downJson = await neo(['status', '--json', '--home', dir])
  expect(downJson.code).toBe(3)
  expect(JSON.parse(downJson.stdout)).toMatchObject({ code: 3 })
})

test('dotenv and bunfig autoload are off in the compiled binary', async () => {
  const daemon = await startDaemon()
  const project = await tempHome()
  cleanups.push(project.cleanup)
  await mkdir(project.dir, { recursive: true })
  await writeFile(join(project.dir, '.env'), `NEO_HOME=${daemon.dir}\n`)
  const empty = await tempHome()
  cleanups.push(empty.cleanup)
  // with autoload on, the project's .env would point neo at the live daemon
  const r = await neo(['status'], { cwd: project.dir, env: { HOME: empty.dir } })
  expect(r.code).toBe(3)
})

test('status over the real socket from a separate process', async () => {
  const { dir, proc } = await startDaemon()
  const r = await neo(['status', '--json', '--home', dir])
  expect(r.code).toBe(0)
  expect(JSON.parse(r.stdout)).toMatchObject({ pid: proc.pid, consoles: 0, requireName: true })
  const md = await neo(['status', '--home', dir])
  expect(md.stdout).toContain('# Neo')
})

test('events stays open past 60 s of silence and still receives a status event', async () => {
  const { dir } = await startDaemon({ NEO_PING_MS: '3600000' }) // no pings: a real 65 s of silence
  const watcher = Bun.spawn([bin, 'events', '--json', '--home', dir], { stdout: 'pipe', stderr: 'pipe', env: { PATH: process.env.PATH! } })
  cleanups.push(async () => { watcher.kill('SIGTERM'); await watcher.exited })
  const reader = watcher.stdout.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  const nextLine = async () => {
    while (!buffer.includes('\n')) {
      const { value, done } = await reader.read()
      if (done) throw new Error('events stream closed early')
      buffer += decoder.decode(value)
    }
    const nl = buffer.indexOf('\n')
    const line = buffer.slice(0, nl)
    buffer = buffer.slice(nl + 1)
    return JSON.parse(line)
  }
  expect(await nextLine()).toMatchObject({ type: 'status', consoles: 1 })
  await Bun.sleep(65_000)
  expect(watcher.exitCode).toBeNull()
  // state change: a second console connects
  const second = Bun.spawn([bin, 'events', '--json', '--home', dir], { stdout: 'pipe', stderr: 'pipe', env: { PATH: process.env.PATH! } })
  cleanups.push(async () => { second.kill('SIGTERM'); await second.exited })
  expect(await nextLine()).toMatchObject({ type: 'status', consoles: 2 })
}, 100_000)

test('events --history replays the backlog first', async () => {
  const { dir } = await startDaemon()
  expect((await neo(['settings', 'set', 'bypass', 'false', '--home', dir])).code).toBe(0)
  const watcher = Bun.spawn([bin, 'events', '--history', '--json', '--home', dir], { stdout: 'pipe', stderr: 'pipe', env: { PATH: process.env.PATH! } })
  cleanups.push(async () => { watcher.kill('SIGTERM'); await watcher.exited })
  const reader = watcher.stdout.getReader()
  let text = ''
  while (text.split('\n').length < 3) {
    const { value, done } = await reader.read()
    if (done) break
    text += new TextDecoder().decode(value)
  }
  const types = text.trim().split('\n').map(l => JSON.parse(l).type)
  expect(types.slice(0, 2)).toEqual(['settings', 'status'])
})
