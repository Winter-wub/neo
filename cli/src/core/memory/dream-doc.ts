// dreams/YYYY-MM-DD-HHmm.md: one dream per file, named for the local minute it started (a counter is added if two start in the
// same minute). The file name is the dream's id. This is the settled grammar; it reads well in Obsidian.
//
//   ---
//   at: 1790000000000                  ← ms since epoch when the dream started
//   reason: ช่วงที่ปกติคุณไม่อยู่          ← why it ran, one line
//   took: 12345                        ← ms
//   entries: 5                         ← journal turns it read
//   undelivered: true                  ← only while the phone has not seen the card; removed by /api/dream/seen
//   ---
//   # ฝันถึงปลาทอง                       ← the dream, one line (≤120 characters)
//
//   ## Insights                        ← what it researched: "- <request> → <finding>" (≤5)
//   ## Patterns                        ← "- <observation>" (≤5)
//   ## Memory changes                  ← "- + <item added to memory.md>" / "- − <item removed>" (U+2212 for the minus)
//   ## Card — <title>                  ← the card told to the phone on waking: "- <line>" bullets,
//   ### Items                          ←   then optionally "- <t> | <v>" rows
//
// Values are single lines (newlines become spaces). Anything the format does not know (notes typed in an editor, stray lines,
// missing sections) is ignored when reading, so a hand-edited file still parses. The daemon changes an existing file only to
// delete the `undelivered:` line (text surgery, the rest stays as the user left it).
export interface DreamParts {
  at: number
  reason: string
  took: number
  entries: number
  undelivered: boolean
  dream: string
  insights: Array<{ q: string; finding: string }>
  patterns: string[]
  added: string[]
  removed: string[]
  card: { title: string; lines: string[]; items: Array<{ t: string; v: string }> }
}

export const DREAM_MAX = 120
const ID = /^\d{4}-\d{2}-\d{2}-\d{4}(?:-\d+)?$/
export const isDreamId = (id: string) => ID.test(id)

const flat = (text: unknown) => String(text ?? '').replace(/\s+/g, ' ').trim()
const pad = (n: number) => String(n).padStart(2, '0')
const ARROW = ' → '
const ITEM_SPLIT = ' | '

export function dreamId(at: number, taken: (id: string) => boolean): string {
  const d = new Date(at)
  const base = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`
  if (!taken(base)) return base
  for (let n = 2; ; n++) if (!taken(`${base}-${n}`)) return `${base}-${n}`
}

export function renderDream(d: DreamParts): string {
  const list = (items: string[]) => items.map(i => `- ${i}`).join('\n')
  const section = (title: string, body: string) => (body ? `## ${title}\n${body}\n\n` : '')
  const title = flat(d.card.title)
  const items = d.card.items.map(i => `- ${flat(i.t).replaceAll(ITEM_SPLIT, ' / ')}${ITEM_SPLIT}${flat(i.v)}`.trimEnd())
  return [
    '---',
    `at: ${d.at}`,
    `reason: ${flat(d.reason)}`,
    `took: ${d.took}`,
    `entries: ${d.entries}`,
    ...(d.undelivered ? ['undelivered: true'] : []),
    '---',
    `# ${flat(d.dream).slice(0, DREAM_MAX)}`,
    '',
    '',
  ].join('\n')
    + section('Insights', list(d.insights.map(i => `${flat(i.q).replaceAll(ARROW, ' - ')}${ARROW}${flat(i.finding)}`)))
    + section('Patterns', list(d.patterns.map(flat)))
    + section('Memory changes', [...d.added.map(a => `- + ${flat(a)}`), ...d.removed.map(r => `- − ${flat(r)}`)].join('\n'))
    + `## Card${title ? ` — ${title}` : ''}\n${list(d.card.lines.map(flat))}\n${items.length ? `\n### Items\n${items.join('\n')}\n` : ''}`
}

export function parseDream(text: string): DreamParts {
  const out: DreamParts = {
    at: 0, reason: '', took: 0, entries: 0, undelivered: false, dream: '',
    insights: [], patterns: [], added: [], removed: [], card: { title: '', lines: [], items: [] },
  }
  const lines = text.split('\n')
  let i = 0
  if (lines[0]?.trim() === '---') {
    for (i = 1; i < lines.length && lines[i]!.trim() !== '---'; i++) {
      const m = /^(\w+):\s*(.*)$/.exec(lines[i]!)
      if (!m) continue
      const [, key, value] = m
      if (key === 'at' || key === 'took' || key === 'entries') out[key] = Number(value) || 0
      else if (key === 'reason') out.reason = value!.trim()
      else if (key === 'undelivered') out.undelivered = value!.trim() === 'true'
    }
    i++
  }
  let section = ''
  for (; i < lines.length; i++) {
    const line = lines[i]!.trimEnd()
    const h1 = /^# (.*)$/.exec(line)
    if (h1) { out.dream ||= h1[1]!.trim(); continue }
    const h2 = /^## (.*)$/.exec(line)
    if (h2) {
      const name = h2[1]!.trim()
      section = name.startsWith('Card') ? 'card' : name
      if (section === 'card') out.card.title = /^Card\s+—\s+(.*)$/.exec(name)?.[1]?.trim() ?? ''
      continue
    }
    if (/^### Items\s*$/.test(line) && section === 'card') { section = 'items'; continue }
    const bullet = /^- (.*)$/.exec(line)?.[1]?.trim()
    if (!bullet) continue
    switch (section) {
      case 'Insights': {
        const at = bullet.indexOf(ARROW)
        out.insights.push(at < 0 ? { q: bullet, finding: '' } : { q: bullet.slice(0, at), finding: bullet.slice(at + ARROW.length) })
        break
      }
      case 'Patterns': out.patterns.push(bullet); break
      case 'Memory changes':
        if (bullet.startsWith('+ ')) out.added.push(bullet.slice(2).trim())
        else if (bullet.startsWith('− ')) out.removed.push(bullet.slice(2).trim())
        break
      case 'card': out.card.lines.push(bullet); break
      case 'items': {
        const m = /^(.*?) \|(?: (.*))?$/.exec(bullet)
        out.card.items.push(m ? { t: m[1]!, v: m[2] ?? '' } : { t: bullet, v: '' })
        break
      }
    }
  }
  return out
}
