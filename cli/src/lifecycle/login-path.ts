import { spawn } from 'node:child_process'

const MARK = '__NEO_PATH__'
const TIMEOUT_MS = 8000
const COMMAND = `printf '${MARK}%s${MARK}' "$PATH"`

/**
 * What `zsh -lic 'echo $PATH'` says: launchd starts the daemon with a bare PATH, but `claude` and the agents live where the
 * user's shell profile puts them. The markers skip whatever the rc files print. Null when the shell fails, hangs or says no PATH.
 */
export async function readLoginPath({ shell = process.env.NEO_LOGIN_SHELL ?? process.env.SHELL ?? '/bin/zsh', timeoutMs = TIMEOUT_MS }: { shell?: string; timeoutMs?: number } = {}) {
  return new Promise<string | null>(resolve => {
    let out = ''
    let settled = false
    const done = (value: string | null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(value)
    }
    const child = spawn(shell, ['-lic', COMMAND], { stdio: ['ignore', 'pipe', 'ignore'], detached: true })
    const timer = setTimeout(() => {
      try { process.kill(-child.pid!, 'SIGKILL') } catch { /* already gone */ }
      done(null)
    }, timeoutMs)
    child.stdout.on('data', chunk => (out += chunk))
    child.on('error', () => done(null))
    child.on('close', code => {
      const path = out.match(new RegExp(`${MARK}(.*?)${MARK}`, 's'))?.[1]
      done(code === 0 && path && path.includes('/') ? path : null)
    })
  })
}

/** Puts the login shell's PATH first and keeps the daemon's own entries after it. */
export function applyLoginPath(env: Record<string, string | undefined>, loginPath: string | null) {
  if (!loginPath) return
  env.PATH = [...new Set([...loginPath.split(':'), ...(env.PATH ?? '').split(':')].filter(Boolean))].join(':')
}
