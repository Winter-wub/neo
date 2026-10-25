import { homedir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_LABEL, Lifecycle } from './lifecycle'
import { systemLaunchctl } from './launchctl'

/**
 * Every path launchd-related can be redirected, so tests and dev runs never touch the real
 * com.mochi.neo, ~/.local/bin/neo or ~/Library/LaunchAgents.
 */
export const logDirFromEnv = (env: Record<string, string | undefined>) =>
  env.NEO_LOG_DIR ?? join(env.HOME ?? homedir(), 'Library', 'Logs', 'Neo')

export function lifecycleFromEnv(env: Record<string, string | undefined>, home: string) {
  const user = env.HOME ?? homedir()
  return new Lifecycle({
    label: env.NEO_LAUNCH_LABEL ?? DEFAULT_LABEL,
    uid: process.getuid?.() ?? 501,
    home,
    plistDir: env.NEO_LAUNCH_AGENTS_DIR ?? join(user, 'Library', 'LaunchAgents'),
    binDir: env.NEO_BIN_DIR ?? join(user, '.local', 'bin'),
    logDir: logDirFromEnv(env),
    binary: env.NEO_BINARY ?? process.execPath,
    launchctl: systemLaunchctl(env.NEO_LAUNCHCTL),
    pathEnv: env.PATH ?? '',
    sleep: ms => Bun.sleep(ms),
  })
}
