// Ticket 13 on a real `neo daemon run` process: PATH comes from the login shell at start, NEO_APK overrides the bundled apk.
import { afterEach, expect, test } from 'bun:test'
import { chmod, mkdir, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { runCli } from '../src/adapters/command/cli'
import type { DoctorRow } from '../src/protocol'
import { tempHome } from './helpers'

const MAIN = join(import.meta.dir, '..', 'src', 'main.ts')
const cleanups: Array<() => Promise<unknown>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

async function startDaemon() {
  const { dir, cleanup } = await tempHome()
  const [home, logs, userHome, tools] = ['h', 'logs', 'home', 'tools'].map(d => join(dir, d)) as [string, string, string, string]
  for (const d of [home, logs, userHome, tools]) await mkdir(d, { recursive: true })
  // `claude` only a login shell can find
  await writeFile(join(tools, 'claude'), '#!/bin/sh\necho "9.9.9-from-login-path (Claude Code)"\n', { mode: 0o755 })
  // a stand-in for `zsh -lic`: a PATH the daemon itself was not started with, after rc-file noise
  const shell = join(dir, 'fake-zsh')
  await writeFile(shell, `#!/bin/sh\necho "banner from .zshrc"\nPATH="${tools}:$PATH"\nexport PATH\neval "$2"\n`, { mode: 0o755 })
  await chmod(shell, 0o755)
  const apk = join(dir, 'custom.apk')
  await writeFile(apk, 'APKBYTES')
  const port = 20_000 + Math.floor(Math.random() * 30_000)
  const proc = Bun.spawn([process.execPath, MAIN, 'daemon', 'run', '--home', home, '--port', String(port)], {
    env: {
      PATH: `${process.execPath.replace(/\/[^/]*$/, '')}:/usr/bin:/bin`,
      HOME: userHome, NEO_LOG_DIR: logs, NEO_DISCOVER: '0', NEO_LOGIN_SHELL: shell, NEO_APK: apk,
    },
    stdout: 'ignore', stderr: 'pipe',
  })
  cleanups.push(async () => {
    proc.kill()
    await proc.exited
    await cleanup()
  })
  for (let i = 0; i < 100 && !(await stat(join(home, 'neo.sock')).catch(() => null)); i++) await Bun.sleep(50)
  return { home, port, tools, apk }
}

test('the daemon takes PATH from the login shell at start: doctor finds claude there; NEO_APK serves /neo.apk', async () => {
  const { home, port, tools } = await startDaemon()
  const out: string[] = []
  expect(await runCli(['doctor', '--json', '--home', home], { out: t => void out.push(t), err: () => {}, env: {} })).toBe(0)
  const claude = (JSON.parse(out.join('')) as DoctorRow[]).find(r => r.id === 'claude')!
  expect(claude.found?.claude).toEndWith('/tools/claude')
  expect(claude.found?.claude).toContain(tools.split('/').slice(-2)[0]!)
  expect(claude.detail).toContain('9.9.9-from-login-path')

  const apk = await fetch(`http://127.0.0.1:${port}/neo.apk`)
  expect(apk.status).toBe(200)
  expect(await apk.text()).toBe('APKBYTES')
})
