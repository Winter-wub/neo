// The jobs.md grammar. One file, hand-editable, readable in Obsidian (headings + a bullet list per job).
//
//   # Neo jobs                              ← everything before the first "## " is kept as it is (the preamble)
//
//   ## ปลุกไปทำงาน {#a1b2c3d4}              ← one "## " heading per job: title, then {#id}
//
//   - kind: alarm                           ← alarm | task                       (required)
//   - enabled: yes                          ← yes | no (also true/false/on/off)  (default yes)
//   - at: 2026-10-27 05:30                  ← one-off, local time YYYY-MM-DD HH:mm
//   - cron: 30 7 * * 1-5                    ← or repeating: minute hour day-of-month month day-of-week (0 = Sunday)
//   - prompt: สรุปข่าววันนี้                  ← tasks only (required): what Neo does at that time
//     เน้นเศรษฐกิจ                            ← a line indented by two spaces continues the prompt
//   - last: 2026-10-26 07:30                ← written by Neo: when a repeating job last fired
//
//   Any other text under a heading (no leading "- ") is the user's own note and is kept with the job.
//
// Rules
// - Exactly one of `at` / `cron`. A task needs a `prompt`. Keys are lower case; an unknown key, a repeated key,
//   a bad date or a bad cron is a problem (reported with its line number) instead of being guessed at.
// - `{#id}` may be left out when writing by hand: the job gets a provisional id derived from its content, and
//   the id is written the next time Neo saves the file. Ids are unique within the file.
// - One-off jobs (`at`) are removed from the file after they ring (or are skipped when more than 30 minutes late).
// - Round trip: serializeJobs(parseJobs(text)) is byte-identical for text Neo wrote itself.
import type { Job, JobProblem } from '../../protocol'
import { CronError, parseCron } from './cron'

/** A job as kept in the file: the protocol job plus the user's own notes under its heading. */
export type StoredJob = Job & { notes: string[] }

export interface ParsedJobs {
  jobs: StoredJob[]
  /** The text before the first job heading (kept verbatim on save). */
  preamble: string
  problems: JobProblem[]
}

const DEFAULT_PREAMBLE = `# Neo jobs

แก้ไฟล์นี้ได้เลย Neo จะโหลดใหม่เอง ถ้ามีบรรทัดที่อ่านไม่ออก Neo จะใช้งานชุดเดิมต่อและบอกใน \`neo doctor\`

แต่ละงานคือหัวข้อ \`## ชื่อ {#id}\` แล้วตามด้วยรายการ:
- \`kind: alarm\` หรือ \`task\` · \`enabled: yes\` หรือ \`no\`
- \`at: 2026-10-27 05:30\` (ครั้งเดียว) หรือ \`cron: 30 7 * * 1-5\` (ซ้ำ: นาที ชั่วโมง วันที่ เดือน วันในสัปดาห์)
- \`prompt: …\` (เฉพาะ task: ให้ Neo ทำอะไร)
`

const FIELD_KEYS = ['kind', 'enabled', 'at', 'cron', 'prompt', 'last'] as const
type FieldKey = (typeof FIELD_KEYS)[number]
const TITLE_MAX = 80
const HEADING = /^## (.*?)(?:\s*\{#([A-Za-z0-9_-]{1,32})\})?\s*$/
const FIELD = /^- ([A-Za-z]+):[ \t]*(.*?)\s*$/
const WHEN = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/

const pad = (n: number) => String(n).padStart(2, '0')
export function formatWhen(ms: number) {
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}
/** Local "YYYY-MM-DD HH:mm" → ms, or null when it is not a real date. */
export function parseWhen(text: string): number | null {
  const m = text.match(WHEN)
  if (!m) return null
  const [y, mo, d, h, mi] = m.slice(1).map(Number) as [number, number, number, number, number]
  const date = new Date(y, mo - 1, d, h, mi)
  const same = date.getFullYear() === y && date.getMonth() === mo - 1 && date.getDate() === d && date.getHours() === h && date.getMinutes() === mi
  return same ? date.getTime() : null
}

const YES = new Set(['yes', 'true', 'on', 'ใช่'])
const NO = new Set(['no', 'false', 'off', 'ไม่'])

/** Same job content gives the same id, so an id-less hand-written job stays stable between reloads. */
export const provisionalId = (title: string, when: string) => 'j' + Bun.hash(`${title}\n${when}`).toString(36).slice(0, 8)

interface Draft {
  heading: number
  title: string
  id: string | undefined
  fields: Map<FieldKey, { value: string; line: number; text: string }>
  prompt: string[]
  notes: string[]
}

export function parseJobs(text: string): ParsedJobs {
  const lines = text.split('\n')
  if (lines.at(-1) === '') lines.pop()
  const problems: JobProblem[] = []
  const problem = (line: number, error: string) => problems.push({ line, text: (lines[line - 1] ?? '').trim() || '(บรรทัดว่าง)', error })

  const preambleLines: string[] = []
  const drafts: Draft[] = []
  let current: Draft | null = null
  let inPrompt = false
  let blanks = 0
  lines.forEach((raw, index) => {
    const line = index + 1
    const heading = raw.match(HEADING)
    if (heading) {
      current = { heading: line, title: heading[1]!.trim(), id: heading[2], fields: new Map(), prompt: [], notes: [] }
      drafts.push(current)
      inPrompt = false
      blanks = 0
      return
    }
    if (!current) {
      preambleLines.push(raw)
      return
    }
    if (raw.trim() === '') {
      blanks++
      return
    }
    if (inPrompt && /^(?: {2}|\t)/.test(raw)) {
      for (; blanks > 0; blanks--) current.prompt.push('')
      current.prompt.push(raw.replace(/^(?: {2}|\t)/, ''))
      return
    }
    blanks = 0
    inPrompt = false
    const field = raw.match(FIELD)
    if (field) {
      const key = field[1]!
      if (!(FIELD_KEYS as readonly string[]).includes(key)) return problem(line, `ไม่รู้จัก ${key} (ใช้ได้: ${FIELD_KEYS.join(', ')})`)
      if (current.fields.has(key as FieldKey)) return problem(line, `${key} ซ้ำ`)
      current.fields.set(key as FieldKey, { value: field[2]!, line, text: raw })
      if (key === 'prompt') {
        inPrompt = true
        current.prompt.push(field[2]!)
      }
      return
    }
    if (raw.startsWith('- ')) return problem(line, 'รูปแบบต้องเป็น "- ชื่อ: ค่า"')
    if (/^\s/.test(raw)) return problem(line, 'บรรทัดที่ย่อหน้าใช้ได้เฉพาะต่อจาก prompt')
    current.notes.push(raw.trimEnd())
  })

  const jobs: StoredJob[] = []
  const seen = new Set<string>()
  for (const draft of drafts) {
    const before = problems.length
    const at = (key: FieldKey) => draft.fields.get(key)
    const fail = (key: FieldKey, error: string) => problem(at(key)?.line ?? draft.heading, error)
    if (!draft.title) problem(draft.heading, 'หัวข้องานต้องมีชื่อ')

    const kind = at('kind')?.value
    if (kind === undefined) problem(draft.heading, 'ขาด kind (alarm หรือ task)')
    else if (kind !== 'alarm' && kind !== 'task') fail('kind', `kind ต้องเป็น alarm หรือ task (ไม่ใช่ "${kind}")`)

    let enabled = true
    const enabledText = at('enabled')?.value.toLowerCase()
    if (enabledText !== undefined) {
      if (YES.has(enabledText)) enabled = true
      else if (NO.has(enabledText)) enabled = false
      else fail('enabled', `enabled ต้องเป็น yes หรือ no (ไม่ใช่ "${enabledText}")`)
    }

    let atMs: number | undefined
    let cron: string | undefined
    if (at('at') && at('cron')) fail('cron', 'ใส่ได้อย่างเดียว: at (ครั้งเดียว) หรือ cron (ซ้ำ) ไม่ใช่ทั้งคู่')
    else if (!at('at') && !at('cron')) problem(draft.heading, 'ขาดเวลา: ใส่ at (ครั้งเดียว) หรือ cron (ซ้ำ)')
    if (at('at')) {
      const ms = parseWhen(at('at')!.value)
      if (ms === null) fail('at', `at ต้องเป็นเวลาจริงรูปแบบ YYYY-MM-DD HH:mm (ไม่ใช่ "${at('at')!.value}")`)
      else atMs = ms
    }
    if (at('cron')) {
      try {
        parseCron(at('cron')!.value)
        cron = at('cron')!.value.trim().split(/\s+/).join(' ')
      } catch (e) {
        fail('cron', e instanceof CronError ? e.message : 'cron ไม่ถูกต้อง')
      }
    }

    let last: number | undefined
    if (at('last')) {
      const ms = parseWhen(at('last')!.value)
      if (ms === null) fail('last', `last ต้องเป็นเวลารูปแบบ YYYY-MM-DD HH:mm`)
      else last = ms
    }

    const prompt = draft.prompt.join('\n').trim()
    if (kind === 'task' && !prompt) problem(at('prompt')?.line ?? draft.heading, 'task ต้องมี prompt (ให้ทำอะไร)')
    if (kind === 'alarm' && at('prompt')) fail('prompt', 'prompt ใช้กับ task เท่านั้น')

    const id = draft.id ?? provisionalId(draft.title, `${kind}|${at('at')?.value ?? ''}|${at('cron')?.value ?? ''}|${prompt}`)
    if (seen.has(id)) problem(draft.heading, `id ซ้ำ: ${id}`)
    seen.add(id)
    if (problems.length > before) continue

    jobs.push({
      id, kind: kind as Job['kind'], title: draft.title.slice(0, TITLE_MAX), enabled,
      ...(kind === 'task' ? { prompt } : {}),
      ...(atMs !== undefined ? { at: atMs } : {}),
      ...(cron !== undefined ? { cron } : {}),
      ...(last !== undefined ? { last } : {}),
      notes: draft.notes,
    })
  }
  // blank lines at the end of the preamble belong to the layout, not the preamble
  while (preambleLines.at(-1) === '') preambleLines.pop()
  const preamble = preambleLines.length ? preambleLines.join('\n') + '\n' : ''
  return { jobs, preamble, problems }
}

export function serializeJobs(jobs: readonly StoredJob[], preamble: string | undefined): string {
  const head = preamble === undefined ? DEFAULT_PREAMBLE : preamble
  const blocks = jobs.map(job => {
    const title = job.title.replace(/\s+/g, ' ').trim() || (job.kind === 'task' ? 'งาน' : 'ปลุก')
    const lines = [`## ${title} {#${job.id}}`, '', `- kind: ${job.kind}`, `- enabled: ${job.enabled ? 'yes' : 'no'}`]
    if (job.at !== undefined) lines.push(`- at: ${formatWhen(job.at)}`)
    if (job.cron !== undefined) lines.push(`- cron: ${job.cron}`)
    if (job.kind === 'task') lines.push(`- prompt: ${(job.prompt ?? '').split('\n').join('\n  ')}`)
    if (job.last !== undefined) lines.push(`- last: ${formatWhen(job.last)}`)
    if (job.notes.length) lines.push('', ...job.notes)
    return lines.join('\n')
  })
  const body = blocks.join('\n\n')
  return head ? (blocks.length ? `${head}\n${body}\n` : head) : blocks.length ? `${body}\n` : ''
}
