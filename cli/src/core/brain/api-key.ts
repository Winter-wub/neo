import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import type { ProviderConfig } from '../../protocol'

/** `~/x` → `/Users/me/x`. */
export const expandHome = (path: string, home = homedir()) => path.replace(/^~(?=\/)/, home)

/**
 * The key a provider names: the env var in `apiKeyEnv`, else the file in `apiKeyFile`. Nothing else is read
 * (the old backend also looked in ~/.config/neo; the migration copies that key into NEO_HOME and rewrites `apiKeyFile`).
 */
export function readApiKey(cfg: Pick<ProviderConfig, 'apiKeyEnv' | 'apiKeyFile'>, env: Record<string, string | undefined>, home = homedir()): string {
  const fromEnv = cfg.apiKeyEnv ? env[cfg.apiKeyEnv] : undefined
  if (fromEnv) return fromEnv
  if (cfg.apiKeyFile) {
    try {
      return readFileSync(expandHome(cfg.apiKeyFile, home), 'utf8').trim()
    } catch {
      // unreadable: no key
    }
  }
  return ''
}

/** Headers for a custom endpoint: the configured ones, then the bearer key when there is one. */
export const authHeaders = (cfg: ProviderConfig, env: Record<string, string | undefined>, home?: string): Record<string, string> => {
  const key = readApiKey(cfg, env, home)
  return { ...cfg.headers, ...(key ? { Authorization: `Bearer ${key}` } : {}) }
}
