import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { ProviderConfig, ProviderType } from '../../protocol'

/** `NEO_HOME/providers.json`: only what the user set (custom endpoints, overrides for discovered agents). */
export interface ProvidersFile {
  _help?: string
  default?: string
  providers: Record<string, ProviderConfig>
}

export class BrainError extends Error {}

export const PROVIDER_TYPES: readonly ProviderType[] = ['claude-code', 'acp', 'openai', 'http']
const NAME = /^[a-z0-9][a-z0-9_-]{0,31}$/
/** What may be kept for an agent the machine already offers: only overrides, never a start command. */
const OVERRIDE_KEYS = ['label', 'aliases', 'models', 'model', 'config', 'apiKeyFile', 'headers']
/** Anything that looks like a secret stored in the config itself. */
const SECRET_KEYS = ['apiKey', 'api_key', 'key', 'token', 'secret']

export async function readProvidersFile(file: string): Promise<{ conf: ProvidersFile; problem?: string }> {
  let text: string
  try {
    text = await readFile(file, 'utf8')
  } catch {
    return { conf: { providers: {} } }
  }
  try {
    const json = JSON.parse(text)
    return { conf: { ...json, providers: json?.providers && typeof json.providers === 'object' ? json.providers : {} } }
  } catch (e) {
    return { conf: { providers: {} }, problem: `providers.json อ่านไม่ได้: ${(e as Error).message}` }
  }
}

export async function writeProvidersFile(file: string, conf: ProvidersFile) {
  await mkdir(dirname(file), { recursive: true, mode: 0o700 })
  const tmp = `${file}.tmp`
  await writeFile(tmp, JSON.stringify(conf, null, 2) + '\n', { mode: 0o600 })
  await rename(tmp, file)
}

/** Writes the key for `name` (mode 0600, even if the file already existed). Returns the path. */
export async function writeKeyFile(path: string, key: string) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  await writeFile(path, key.trim() + '\n', { mode: 0o600 })
  await chmod(path, 0o600)
}

/** Checks a config before it is saved. `discovered`: the machine already offers this agent, so only overrides are kept. */
export function cleanConfig(name: string, cfg: ProviderConfig | undefined, discovered: boolean): ProviderConfig {
  if (!NAME.test(name)) throw new BrainError('ชื่อใช้ได้แค่ a-z 0-9 - _ (ไม่เกิน 32 ตัว ขึ้นต้นด้วยตัวอักษรหรือตัวเลข)')
  if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) throw new BrainError('ไฟล์ตั้งค่าต้องเป็น JSON object')
  for (const key of SECRET_KEYS) {
    if (key in cfg) throw new BrainError(`ห้ามใส่ ${key} ในไฟล์ตั้งค่า — ส่ง API key ด้วย --api-key-stdin (เก็บเป็นไฟล์ ${name}.key สิทธิ์ 0600)`)
  }
  if (!discovered) {
    if (!cfg.type || !PROVIDER_TYPES.includes(cfg.type)) throw new BrainError(`type ต้องเป็น ${PROVIDER_TYPES.join(' | ')}`)
    if (cfg.type === 'openai' && !/^https?:\/\//.test(cfg.baseUrl ?? '')) throw new BrainError('type openai ต้องมี baseUrl (http:// หรือ https://)')
    if (cfg.type === 'http' && !/^https?:\/\//.test(cfg.url ?? '')) throw new BrainError('type http ต้องมี url (http:// หรือ https://)')
    if (cfg.type === 'acp' && !cfg.command) throw new BrainError('type acp ต้องมี command')
  }
  const clean: Record<string, unknown> = { ...cfg }
  delete clean.found
  return (discovered ? Object.fromEntries(Object.entries(clean).filter(([k]) => OVERRIDE_KEYS.includes(k))) : clean) as ProviderConfig
}
