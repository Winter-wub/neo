// journal/YYYY-MM-DD.md: one file per local day, one block per turn. This is the settled grammar.
//
//   # 2026-10-26                 ← file header (the day); written once
//
//   ## 09:41                     ← one block per turn: local time HH:mm
//   - Q: what the user asked     ← one line (newlines become spaces), at most 400 characters
//   - A: what Neo answered       ← one line, at most 600 characters; the card text, or the error for a failed turn
//
//   ## 10:02 ✗                   ← "✗" after the time = the turn failed or was cancelled
//
// Blocks are in time order and separated by one blank line. Everything outside a block's `## HH:mm` heading and its
// `- Q:` / `- A:` lines (notes the user typed, stray lines) is ignored when reading and kept when other entries are
// removed. The entry's identity is (day, position), its timestamp is the day's local date plus HH:mm.
import type { JournalEntry } from '../../protocol'

export const Q_MAX = 400
export const A_MAX = 600
const HEADING = /^## (\d{2}:\d{2})( ✗)?\s*$/
const flat = (text: string, max: number) => text.replace(/\s+/g, ' ').trim().slice(0, max)

type Block = Pick<JournalEntry, 'time' | 'q' | 'a' | 'ok'>

export function renderEntry(entry: Block): string {
  return `## ${entry.time}${entry.ok ? '' : ' ✗'}\n- Q: ${flat(entry.q, Q_MAX)}\n- A: ${flat(entry.a, A_MAX)}\n`
}

export function appendEntry(file: string, day: string, entry: Block): string {
  const head = file === '' ? `# ${day}\n\n` : file.endsWith('\n') ? file + '\n' : file + '\n\n'
  return head + renderEntry(entry)
}

/** The file split at its `## HH:mm` headings: everything before the first one, then one raw block per entry. */
function split(file: string): { preamble: string; blocks: Array<{ raw: string; entry: Block }> } {
  const lines = file.split('\n')
  const starts = lines.flatMap((line, i) => (HEADING.test(line) ? [i] : []))
  const preamble = lines.slice(0, starts[0] ?? lines.length).join('\n')
  const blocks = starts.map((start, n) => {
    const body = lines.slice(start, starts[n + 1] ?? lines.length)
    const heading = HEADING.exec(body[0]!)!
    const q = body.find(l => l.startsWith('- Q:'))
    const a = body.find(l => l.startsWith('- A:'))
    return {
      raw: body.join('\n'),
      entry: { time: heading[1]!, ok: !heading[2], q: q ? q.slice(4).trim() : '', a: a ? a.slice(4).trim() : '' },
    }
  })
  return { preamble, blocks }
}

export function parseJournal(file: string): Block[] {
  return split(file).blocks.map(b => b.entry)
}

/** The file without the entries `drop` selects; null when no entry is left (the caller deletes the file). */
export function removeEntries(file: string, drop: (entry: Block) => boolean): string | null {
  const { preamble, blocks } = split(file)
  const kept = blocks.filter(b => !drop(b.entry))
  if (!kept.length) return null
  return (preamble ? preamble + '\n' : '') + kept.map(b => b.raw).join('\n').trimEnd() + '\n'
}
