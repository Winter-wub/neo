import { afterEach, expect, test } from 'bun:test'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { runCli } from '../adapters/command/cli'
import { startCommandServer, type CommandServer } from '../adapters/command/server'
import { createCore } from '../core/core'
import { fakeLaunchd } from '../../test/fake-launchctl'
import { FakeClock, golden, tempHome } from '../../test/helpers'
import { Lifecycle } from './lifecycle'

const cleanups: Array<() => Promise<unknown>> = []
afterEach(async () => void (await Promise.all(cleanups.splice(0).reverse().map(c => c()))))

async function rig() {
  const { dir, cleanup } = await tempHome()
  cleanups.push(cleanup)
  const home = join(dir, 'h')
  const binary = join(dir, 'neo')
  await writeFile(binary, '')
  let server: CommandServer | undefined
  const launchd = fakeLaunchd({
    start: async () => {
      const clock = new FakeClock()
      server = await startCommandServer({ core: await createCore({ home, clock, pid: 777 }), clock, home, build: 'b1' })
      return 777
    },
    stop: async () => void (await server?.stop()),
  })
  cleanups.push(async () => void (await server?.stop()))
  const lifecycle = new Lifecycle({
    label: 'com.mochi.neo.test', uid: 501, home, binary, plistDir: join(dir, 'agents'), binDir: join(dir, 'bin'), logDir: join(dir, 'logs'),
    launchctl: launchd.launchctl, pathEnv: '', sleep: async () => {},
  })
  const out: string[] = []
  const err: string[] = []
  const run = (...argv: string[]) => runCli([...argv, '--home', home], { out: t => void out.push(t), err: t => void err.push(t), env: {}, lifecycle: () => lifecycle })
  return { dir, home, launchd, lifecycle, run, stdout: () => out.join(''), stderr: () => err.join('') }
}

test('neo status with the daemon stopped but installed starts it and succeeds', async () => {
  const r = await rig()
  expect(await r.run('daemon', 'install')).toBe(0)
  expect(await r.run('daemon', 'stop')).toBe(0)
  expect(await r.lifecycle.isUp()).toBe(false)
  expect(await r.run('status', '--json')).toBe(0)
  expect(JSON.parse(r.stdout().trim().split('\n').at(-1)!)).toMatchObject({ pid: 777 })
})

test('neo status with nothing installed still exits 3, pointing at neo daemon install', async () => {
  const r = await rig()
  expect(await r.run('status')).toBe(3)
  expect(r.stderr()).toContain('neo daemon install')
})

test('neo status exits 3 when the wake-up fails', async () => {
  const r = await rig()
  await r.run('daemon', 'install')
  await r.run('daemon', 'stop')
  r.launchd.launchctl = async () => ({ code: 1, stdout: '', stderr: 'boom' })
  const broken = new Lifecycle({ ...r.lifecycle.config, launchctl: r.launchd.launchctl })
  const out: string[] = []
  const code = await runCli(['status', '--home', r.home], { out: t => void out.push(t), err: () => {}, env: {}, lifecycle: () => broken })
  expect(code).toBe(3)
})

test('daemon install / start / stop / restart / uninstall exit 0 and say what happened', async () => {
  const r = await rig()
  expect(await r.run('daemon', 'install')).toBe(0)
  expect(r.stdout()).toContain('ติดตั้งแล้ว')
  expect(await r.run('daemon', 'start')).toBe(0)
  expect(await r.run('daemon', 'restart')).toBe(0)
  expect(await r.run('daemon', 'stop')).toBe(0)
  expect(await r.run('daemon', 'uninstall')).toBe(0)
})

test('daemon verbs fail with exit 1 and a Thai hint when not installed', async () => {
  const r = await rig()
  expect(await r.run('daemon', 'start')).toBe(1)
  expect(r.stderr()).toContain('neo daemon install')
})

test('daemon install --port bakes the port into the plist', async () => {
  const r = await rig()
  expect(await r.run('daemon', 'install', '--port', '8123')).toBe(0)
  expect(await Bun.file(r.lifecycle.plistPath).text()).toContain('<string>8123</string>')
})

test('daemon status --json reports installed, targets, pid, version, build, protocol', async () => {
  const r = await rig()
  await r.run('daemon', 'install')
  await r.run('daemon', 'start')
  const before = r.stdout().length
  expect(await r.run('daemon', 'status', '--json')).toBe(0)
  const status = JSON.parse(r.stdout().slice(before))
  expect(status).toMatchObject({ installed: true, running: true, pid: 777, build: 'b1', protocol: 1, version: '0.1.0' })
  expect(status.plist.current).toBe(true)
  expect(status.symlink.current).toBe(true)
  await golden('daemon-status', { ...status, label: 'com.mochi.neo', binary: '<app>/Contents/MacOS/neo', home: '<home>',
    plist: { path: '<LaunchAgents>/com.mochi.neo.plist', binary: '<app>/Contents/MacOS/neo', current: true },
    symlink: { path: '<bin>/neo', target: '<app>/Contents/MacOS/neo', current: true },
    logs: { daemon: '<Logs>/Neo/daemon.log', crash: '<Logs>/Neo/daemon.crash.log' } })
})

test('daemon status in words (not json) names each fact and exits 0 even when nothing is installed', async () => {
  const r = await rig()
  expect(await r.run('daemon', 'status')).toBe(0)
  expect(r.stdout()).toContain('ยังไม่ได้ติดตั้ง')
})

test('daemon logs prints daemon.log', async () => {
  const r = await rig()
  await mkdir(join(r.dir, 'logs'), { recursive: true })
  await writeFile(join(r.dir, 'logs', 'daemon.log'), 'hello\n')
  expect(await r.run('daemon', 'logs')).toBe(0)
  expect(r.stdout()).toBe('hello\n')
})

test('daemon run / unknown verbs: -f only for logs', async () => {
  const r = await rig()
  expect(await r.run('daemon', 'bogus')).toBe(2)
  expect(await r.run('daemon', 'start', '-f')).toBe(2)
})

test('argv: daemon lifecycle verbs parse, -f only on logs, --port only on install/run', async () => {
  const { parseArgs } = await import('../adapters/command/argv')
  expect(parseArgs(['daemon', 'logs', '-f']).command).toEqual({ name: 'daemon', verb: 'logs', follow: true, port: undefined })
  expect(parseArgs(['daemon', 'install', '--port', '8100']).command).toEqual({ name: 'daemon', verb: 'install', follow: false, port: 8100 })
  expect(parseArgs(['daemon', 'run']).command).toEqual({ name: 'daemon-run', port: 8000 })
})
