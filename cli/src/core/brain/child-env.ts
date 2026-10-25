/** The environment for `claude` and ACP children: no `CLAUDECODE*` (they must not think they run inside Claude Code), `CLAUDE_CONFIG_DIR` only when the setting has a value. */
export function childEnv(base: Record<string, string | undefined>, claudeConfigDir?: string): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(base)) {
    if (value !== undefined && !key.startsWith('CLAUDECODE') && key !== 'CLAUDE_CODE_ENTRYPOINT') env[key] = value
  }
  if (claudeConfigDir) env.CLAUDE_CONFIG_DIR = claudeConfigDir
  return env
}
