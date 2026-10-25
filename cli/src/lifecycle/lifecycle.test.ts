import { afterEach, expect, test } from 'bun:test'
import { lstat, mkdir, readFile, readlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { startCommandServer, type CommandServer } from '../adapters/command/server'
import { createCore } from '../core/core'
import { DAEMON_VERSION, PROTOCOL_VERSION } from '../protocol'
import { fakeLaunchd } from '../../test/fake-launchctl'
import { FakeClock, tempHome } from '../../test/helpers'
import { Lifecycle, LifecycleError } from './lifecycle'

const cleanups: Array<() => Promise<unknown>> = []
afterEach(async () => void (await Promise.all(cleanups.splice(0).reverse().map(c => c()))))

const LABEL = 'com.mochi.neo.test'
const exists = (path: string) => lstat(path).then(() => true, () => false)

/** Temp dirs for everything lifecycle touches, plus a launchd whose job runs a real in-process daemon. */
async function rig({ seedBinary = true, launchdDown = false } = {}) {
  const { dir, cleanup } = await tempHome()
  cleanups.push(cleanup)
  const paths = {
    home: join(dir, 'h'),
    plistDir: join(dir, 'agents'),
    binDir: join(dir, 'bin'),
    logDir: join(dir, 'logs'),
    binary: join(dir, 'App', 'neo'),
  }
  if (seedBinary) {
    await mkdir(join(dir, 'App'), { recursive: true })
    await writeFile(paths.binary, '#!/bin/sh\n')
  }
  let server: CommandServer | undefined
  const launchd = fakeLaunchd({
    start: async () => {
      if (launchdDown) return 99
      const clock = new FakeClock()
      const core = await createCore({ home: paths.home, clock, pid: 777 })
      server = await startCommandServer({ core, clock, home: paths.home, build: 'abc123' })
      return 777
    },
    stop: async () => void (await server?.stop()),
  })
  cleanups.push(async () => void (await server?.stop()))
  const lifecycle = new Lifecycle({
    label: LABEL, uid: 501, ...paths, launchctl: launchd.launchctl,
    pathEnv: '/usr/bin:/bin', sleep: async () => {},
  })
  return { ...paths, dir, launchd, lifecycle, plist: join(paths.plistDir, `${LABEL}.plist`), link: join(paths.binDir, 'neo') }
}

test('install writes the plist, the symlink and bootstraps the job', async () => {
  const r = await rig()
  const result = await r.lifecycle.install({ port: 8123 })
  const xml = await readFile(r.plist, 'utf8')
  expect(xml).toContain(`<string>${r.binary}</string>`)
  expect(xml).toContain('<string>daemon</string>')
  expect(xml).toContain('<string>--port</string>')
  expect(xml).toContain('<string>8123</string>')
  expect(xml).toContain('<key>RunAtLoad</key>\n  <true/>')
  expect(xml).toMatch(/<key>KeepAlive<\/key>\s*<dict>\s*<key>SuccessfulExit<\/key>\s*<false\/>/)
  expect(xml).toContain(join(r.logDir, 'daemon.crash.log'))
  expect(xml).toContain('<key>NEO_LAUNCHD</key>')
  expect(await readlink(r.link)).toBe(r.binary)
  expect(r.launchd.loaded).toBe(true)
  expect(r.launchd.calls).toContainEqual(['bootstrap', 'gui/501', r.plist])
  expect(result.pathHint).toContain(r.binDir)
})

test('install leaves a running daemon alone when nothing changed, and repairs a stale symlink', async () => {
  const r = await rig()
  await r.lifecycle.install({})
  await r.lifecycle.install({})
  expect(r.launchd.calls.filter(c => c[0] === 'bootout')).toEqual([])
  await Bun.$`ln -sfn /nowhere/neo ${r.link}`
  await r.lifecycle.install({})
  expect(await readlink(r.link)).toBe(r.binary)
})

test('install re-bootstraps when the plist content changed', async () => {
  const r = await rig()
  await r.lifecycle.install({})
  await r.lifecycle.install({ port: 8200 })
  expect(r.launchd.calls.filter(c => c[0] === 'bootout').length).toBe(1)
  expect(r.launchd.loaded).toBe(true)
})

test('install refuses to replace a regular file at the symlink path', async () => {
  const r = await rig()
  await mkdir(r.binDir, { recursive: true })
  await writeFile(r.link, 'not mine')
  await expect(r.lifecycle.install({})).rejects.toThrow(LifecycleError)
  expect(await readFile(r.link, 'utf8')).toBe('not mine')
})

test('install hints nothing when the symlink dir is already on PATH', async () => {
  const r = await rig()
  const onPath = new Lifecycle({ label: LABEL, uid: 501, ...r, launchctl: r.launchd.launchctl, pathEnv: `/usr/bin:${r.binDir}`, sleep: async () => {} })
  expect((await onPath.install({})).pathHint).toBeUndefined()
})

test('stop keeps the daemon down; start brings it back and waits for the socket', async () => {
  const r = await rig()
  await r.lifecycle.install({})
  await r.lifecycle.start()
  expect(await r.lifecycle.isUp()).toBe(true)
  await r.lifecycle.stop()
  expect(await r.lifecycle.isUp()).toBe(false)
  expect(r.launchd.calls.at(-1)?.slice(0, 2)).toEqual(['kill', 'SIGTERM'])
  await r.lifecycle.start()
  expect(await r.lifecycle.isUp()).toBe(true)
})

test('restart kickstarts with -k', async () => {
  const r = await rig()
  await r.lifecycle.install({})
  await r.lifecycle.restart()
  expect(r.launchd.calls.some(c => c[0] === 'kickstart' && c[1] === '-k' && c[2] === `gui/501/${LABEL}`)).toBe(true)
  expect(await r.lifecycle.isUp()).toBe(true)
})

test('start bootstraps first when launchd forgot the job (plist installed, e.g. after login)', async () => {
  const r = await rig()
  await r.lifecycle.install({})
  await r.lifecycle.stop()
  r.launchd.loaded = false
  await r.lifecycle.start()
  expect(r.launchd.loaded).toBe(true)
  expect(await r.lifecycle.isUp()).toBe(true)
})

test('start / stop / restart say so when Neo is not installed', async () => {
  const r = await rig()
  for (const verb of ['start', 'stop', 'restart'] as const) {
    await expect(r.lifecycle[verb]()).rejects.toThrow(/neo daemon install/)
  }
})

test('wake starts an installed-but-stopped daemon', async () => {
  const r = await rig()
  await r.lifecycle.install({})
  await r.lifecycle.stop()
  expect(await r.lifecycle.wake()).toBe('woken')
  expect(await r.lifecycle.isUp()).toBe(true)
})

test('wake does nothing when the daemon is up, and reports when not installed', async () => {
  const r = await rig()
  expect(await r.lifecycle.wake()).toBe('not-installed')
  await r.lifecycle.install({})
  await r.lifecycle.start()
  r.launchd.calls.length = 0
  expect(await r.lifecycle.wake()).toBe('up')
  expect(r.launchd.calls).toEqual([])
})

test('wake leaves alone a plist that serves a different NEO_HOME (e.g. a temp --home must not start the real daemon)', async () => {
  const r = await rig()
  await r.lifecycle.install({})
  await r.lifecycle.stop()
  r.launchd.calls.length = 0
  const other = new Lifecycle({ ...r.lifecycle.config, home: join(r.dir, 'elsewhere') })
  expect(await other.wake()).toBe('not-installed')
  expect(r.launchd.calls).toEqual([])
})

test('wake gives up after ~5 s when launchd starts a job that never opens the socket', async () => {
  const r = await rig({ launchdDown: true })
  await r.lifecycle.install({})
  const slept: number[] = []
  const impatient = new Lifecycle({ label: LABEL, uid: 501, ...r, launchctl: r.launchd.launchctl, pathEnv: '', sleep: async ms => void slept.push(ms) })
  expect(await impatient.wake()).toBe('failed')
  expect(slept.reduce((a, b) => a + b, 0)).toBe(5000)
})

test('status of a running install reports pid, version, build and protocol', async () => {
  const r = await rig()
  await r.lifecycle.install({})
  await r.lifecycle.start()
  expect(await r.lifecycle.status()).toEqual({
    label: LABEL,
    installed: true,
    loaded: true,
    running: true,
    pid: 777,
    version: DAEMON_VERSION,
    build: 'abc123',
    protocol: PROTOCOL_VERSION,
    binary: r.binary,
    plist: { path: r.plist, binary: r.binary, current: true },
    symlink: { path: r.link, target: r.binary, current: true },
    home: r.home,
    logs: { daemon: join(r.logDir, 'daemon.log'), crash: join(r.logDir, 'daemon.crash.log') },
  })
})

test('status of a stopped install and of nothing installed', async () => {
  const r = await rig()
  const none = await r.lifecycle.status()
  expect(none).toMatchObject({ installed: false, loaded: false, running: false, pid: null, version: null, build: null, protocol: null })
  expect(none.plist).toEqual({ path: r.plist, binary: null, current: false })
  expect(none.symlink).toEqual({ path: r.link, target: null, current: false })
  await r.lifecycle.install({})
  await r.lifecycle.stop()
  expect(await r.lifecycle.status()).toMatchObject({ installed: true, loaded: true, running: false, pid: null, version: null })
})

test('status flags a plist and symlink that point at another binary (app moved)', async () => {
  const r = await rig()
  await r.lifecycle.install({})
  const moved = new Lifecycle({ label: LABEL, uid: 501, ...r, binary: '/Applications/Neo Console.app/Contents/MacOS/neo', launchctl: r.launchd.launchctl, pathEnv: '', sleep: async () => {} })
  const status = await moved.status()
  expect(status.plist).toMatchObject({ binary: r.binary, current: false })
  expect(status.symlink).toMatchObject({ target: r.binary, current: false })
})

test('uninstall removes plist and symlink, stops the job, and keeps NEO_HOME', async () => {
  const r = await rig()
  await r.lifecycle.install({})
  await r.lifecycle.start()
  await writeFile(join(r.home, 'memory.md'), 'keep me')
  await r.lifecycle.uninstall()
  expect(await exists(r.plist)).toBe(false)
  expect(await exists(r.link)).toBe(false)
  expect(r.launchd.loaded).toBe(false)
  expect(await readFile(join(r.home, 'memory.md'), 'utf8')).toBe('keep me')
  await r.lifecycle.uninstall() // idempotent
})

test('uninstall leaves a symlink that is not ours alone', async () => {
  const r = await rig()
  await r.lifecycle.install({})
  await Bun.$`ln -sfn /somewhere/else/neo ${r.link}`
  await r.lifecycle.uninstall()
  expect(await exists(r.link)).toBe(true)
})

test('logs prints the tail of daemon.log', async () => {
  const r = await rig()
  await mkdir(r.logDir, { recursive: true })
  await writeFile(join(r.logDir, 'daemon.log'), ['a', 'b', 'c', 'd'].join('\n') + '\n')
  const out: string[] = []
  await r.lifecycle.logs({ lines: 2, out: t => void out.push(t) })
  expect(out.join('')).toBe('c\nd\n')
})

test('logs -f streams appended lines, follows a rotation, and stops on abort', async () => {
  const r = await rig()
  await mkdir(r.logDir, { recursive: true })
  const file = join(r.logDir, 'daemon.log')
  await writeFile(file, 'old\n')
  const out: string[] = []
  const abort = new AbortController()
  const followed = r.lifecycle.logs({ follow: true, lines: 10, pollMs: 5, signal: abort.signal, out: t => void out.push(t) })
  const until = async (text: string) => {
    for (let i = 0; i < 200 && !out.join('').includes(text); i++) await Bun.sleep(10)
    expect(out.join('')).toContain(text)
  }
  await until('old')
  await Bun.write(file, 'old\nnew\n')
  await until('new')
  await Bun.write(file, 'rot\n') // shorter file = rotated
  await until('rot\n')
  abort.abort()
  await followed
})

test('logs says there is nothing yet when daemon.log does not exist', async () => {
  const r = await rig()
  await expect(r.lifecycle.logs({ out: () => {} })).rejects.toThrow(LifecycleError)
})

