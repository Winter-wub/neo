// memory.md: `## Section` headings with `- item` lines under them. Anything else (free text, blank lines,
// deeper headings, indented bullets) is the user's own and is kept as it is; only `- ` lines at column 0 are items.
// Edits here are text surgery on the whole document so a file edited in Obsidian keeps its shape.
import type { MemoryItem } from '../../protocol'

export const DEFAULT_SECTION = 'อื่น ๆ'
const HEADING = /^#{1,6}\s+(.*?)\s*$/
const BULLET = /^[-*]\s+(.*?)\s*$/

const flat = (text: string) => text.replace(/\s+/g, ' ').trim()

interface Line { index: number; section: string; item: string | null }

function scan(text: string): { lines: string[]; found: Line[] } {
  const lines = text.split('\n')
  let section = ''
  const found: Line[] = []
  lines.forEach((line, index) => {
    const heading = HEADING.exec(line)
    if (heading) {
      section = heading[1]!
      found.push({ index, section, item: null })
      return
    }
    const bullet = BULLET.exec(line)
    if (bullet && bullet[1]) found.push({ index, section, item: bullet[1] })
  })
  return { lines, found }
}

export function parseMemory(text: string): MemoryItem[] {
  return scan(text).found.flatMap(l => (l.item === null ? [] : [{ section: l.section, text: l.item }]))
}

/** Appends one item to the end of its section (created at the end of the file if missing). Duplicates are not added. */
export function addItem(text: string, item: string, section = DEFAULT_SECTION): { text: string; added: boolean } {
  const clean = flat(item).replace(/^[-*](\s+|$)/, '').trim()
  if (!clean) throw new Error('ไม่มีข้อความ')
  const name = flat(section).replace(/^#+\s*/, '') || DEFAULT_SECTION
  const { lines, found } = scan(text)
  const inSection = found.filter(l => l.section === name)
  if (inSection.some(l => l.item === clean)) return { text, added: false }
  const heading = inSection.find(l => l.item === null)
  if (!heading) {
    const body = text.trimEnd()
    return { text: `${body ? body + '\n\n' : ''}## ${name}\n- ${clean}\n`, added: true }
  }
  const last = inSection.filter(l => l.item !== null).at(-1) ?? heading
  lines.splice(last.index + 1, 0, `- ${clean}`)
  return { text: lines.join('\n'), added: true }
}

/**
 * Items containing `query` (case-insensitive). One match, or a single exact match among several, is removed;
 * several matches are only removed with `all`. `matches` is what the query found, removed or not.
 */
export function removeItems(text: string, query: string, { all = false } = {}): { text: string; matches: MemoryItem[] } {
  const needle = flat(query).toLowerCase()
  const { lines, found } = scan(text)
  const hits = found.filter(l => l.item !== null && l.item.toLowerCase().includes(needle))
  const exact = hits.filter(l => l.item!.toLowerCase() === needle)
  const matches = !all && exact.length === 1 ? exact : hits
  const view = matches.map(l => ({ section: l.section, text: l.item! }))
  if (!matches.length || (matches.length > 1 && !all)) return { text, matches: view }
  const drop = new Set(matches.map(l => l.index))
  return { text: lines.filter((_, i) => !drop.has(i)).join('\n'), matches: view }
}
