// Fast phrases for switching brains by voice, ported from app/server.js. Pure: the hub decides what they mean.
import type { ModelEntry, ProviderConfig } from '../../protocol'

/** "สลับไปใช้ X" / "เปลี่ยนไปใช้ X" / "ใช้ X" (optionally ending in ตอบ / แทน / นะ / หน่อย). Group 1 = X. */
export const SWITCH = /^(?:(?:สลับ|เปลี่ยน)\s*(?:ไป)?\s*(?:ใช้)?|ใช้)\s*(.{2,40}?)\s*(?:ตอบ|แทน|นะ|หน่อย)?\s*$/i
/** "ใช้โมเดล X" / "เปลี่ยนโมเดลเป็น X". Group 1 = X. */
export const MODEL_SWITCH = /(?:ใช้|เปลี่ยน|สลับ)\s*(?:ไป)?\s*(?:ใช้)?\s*(?:โมเดล|model|โมเดิล)\s*(?:เป็น)?\s*(.{1,40})$/i

const norm = (x: unknown) => String(x).toLowerCase().replace(/[\s()._-]/g, '')

/** The provider whose name, label or alias is in what was said. The longest match wins ("claude acp" is claude-acp, not claude). */
export function findProvider(said: string, providers: Record<string, ProviderConfig>): string | null {
  const heard = norm(said)
  let best: string | null = null
  let length = 0
  for (const [name, cfg] of Object.entries(providers)) {
    for (const candidate of [name, cfg.label, ...(cfg.aliases ?? [])]) {
      const key = candidate ? norm(candidate) : ''
      if (key && heard.includes(key) && key.length > length) {
        best = name
        length = key.length
      }
    }
  }
  return best
}

/**
 * The model that was said: a nickname the user set (`models`) first, then the provider's own list. Every Latin word or
 * number said must be in the id or name; the shortest id wins. Returns the alias or the id to store.
 */
export function findModel(said: string, cfg: ProviderConfig, known: readonly ModelEntry[]): string | null {
  const heard = norm(said)
  let best: string | null = null
  let length = 0
  for (const [alias, id] of Object.entries(cfg.models ?? {})) {
    for (const key of [alias, id]) {
      const k = norm(key)
      if (k && heard.includes(k) && k.length > length) {
        best = alias
        length = k.length
      }
    }
  }
  if (best) return best
  const words = String(said).toLowerCase().match(/[a-z0-9.]+/g) ?? []
  if (!words.length) return null
  const hits = known
    .filter(m => words.every(w => `${m.id} ${m.name}`.toLowerCase().includes(w)))
    .sort((a, b) => a.id.length - b.id.length)
  return hits[0]?.id ?? null
}
