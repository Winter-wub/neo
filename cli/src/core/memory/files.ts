// What the files in Memory's directory share: the errors the adapters turn into 400/404/409, and small file helpers.
import { createHash } from 'node:crypto'
import { readFileSync, renameSync, writeFileSync } from 'node:fs'

/** The request is wrong (400). */
export class MemoryError extends Error {}
/** The file changed since it was read, the text matched several items, or a dream is already running (409). */
export class MemoryConflict extends MemoryError {}
/** Nothing matched (404). */
export class MemoryNotFound extends MemoryError {}

export const pad = (n: number) => String(n).padStart(2, '0')
export const dayOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
export const versionOf = (text: string) => createHash('sha1').update(text).digest('hex').slice(0, 12)

export function readText(file: string) {
  try {
    return readFileSync(file, 'utf8')
  } catch {
    return ''
  }
}

export function writeAtomic(file: string, text: string) {
  const tmp = `${file}.tmp`
  writeFileSync(tmp, text, { mode: 0o600 })
  renameSync(tmp, file)
}
