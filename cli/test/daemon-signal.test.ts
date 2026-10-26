// Ticket 29: SIGTERM while the daemon is still starting up (here: a login shell that takes seconds) ends it promptly.
import { expect, test } from 'bun:test'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tempHome } from './helpers'

const MAIN = join(import.meta.dir, '..', 'src', 'main.ts')

test('SIGTERM during startup is honoured at once, exit 0', async () => {
  const { dir, cleanup } = await tempHome()
  try {
    const [home, logs, userHome] = ['h', 'logs', 'home'].map(d => join(dir, d)) as [string, string, string]
    for (const d of [home, logs, userHome]) await mkdir(d, { recursive: true })
    const shell = join(dir, 'slow-zsh')
    await writeFile(shell, '#!/bin/sh\nexec sleep 4\n', { mode: 0o755 })
    const port = 20_000 + Math.floor(Math.random() * 30_000)
    const proc = Bun.spawn([process.execPath, MAIN, 'daemon', 'run', '--home', home, '--port', String(port)], {
      env: { PATH: `${process.execPath.replace(/\/[^/]*$/, '')}:/usr/bin:/bin`, HOME: userHome, NEO_LOG_DIR: logs, NEO_DISCOVER: '0', NEO_LOGIN_SHELL: shell },
      stdout: 'ignore', stderr: 'ignore',
    })
    await Bun.sleep(700) // inside the login-shell wait
    const sent = Date.now()
    proc.kill('SIGTERM')
    const code = await Promise.race([proc.exited, Bun.sleep(2500).then(() => 'timeout' as const)])
    if (code === 'timeout') proc.kill('SIGKILL')
    expect(code).toBe(0)
    expect(Date.now() - sent).toBeLessThan(2000)
  } finally {
    await cleanup()
  }
})
