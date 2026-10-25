import { expect, test } from 'bun:test'
import { parseJobs, serializeJobs, type StoredJob } from './markdown'

const at = (y: number, mo: number, d: number, h: number, mi: number) => new Date(y, mo - 1, d, h, mi).getTime()

const sample = `# Neo jobs

บรรทัดนี้เป็นของผู้ใช้

## ปลุกไปทำงาน {#a1b2c3d4}

- kind: alarm
- enabled: yes
- at: 2026-10-27 05:30

## สรุปข่าวเช้า {#k3j2h1g0}

- kind: task
- enabled: no
- cron: 30 7 * * 1-5
- prompt: สรุปข่าววันนี้
  เน้นเศรษฐกิจ
- last: 2026-10-26 07:30

ข้อความโน้ตของผู้ใช้ใต้งานนี้
`

test('a file in the documented grammar parses into jobs', () => {
  const { jobs, problems } = parseJobs(sample)
  expect(problems).toEqual([])
  expect(jobs).toEqual([
    { id: 'a1b2c3d4', kind: 'alarm', title: 'ปลุกไปทำงาน', enabled: true, at: at(2026, 10, 27, 5, 30), notes: [] },
    {
      id: 'k3j2h1g0', kind: 'task', title: 'สรุปข่าวเช้า', enabled: false, cron: '30 7 * * 1-5',
      prompt: 'สรุปข่าววันนี้\nเน้นเศรษฐกิจ', last: at(2026, 10, 26, 7, 30), notes: ['ข้อความโน้ตของผู้ใช้ใต้งานนี้'],
    },
  ])
})

test('serialize then parse gives the same jobs, and a second serialize is byte-identical (round trip)', () => {
  const parsed = parseJobs(sample)
  const text = serializeJobs(parsed.jobs, parsed.preamble)
  expect(text).toBe(sample)
  expect(parseJobs(text).jobs).toEqual(parsed.jobs)
})

test('an empty file serializes with a header that explains the grammar, and parses back to no jobs', () => {
  const text = serializeJobs([], undefined)
  expect(text).toContain('# Neo jobs')
  expect(text).toContain('{#id}')
  expect(parseJobs(text)).toMatchObject({ jobs: [], problems: [] })
})

test('a hand-written job without an id is accepted and gets the same provisional id every time', () => {
  const text = '## ปลุก\n- kind: alarm\n- at: 2030-01-01 06:00\n'
  const first = parseJobs(text).jobs[0]!
  expect(first.id).toMatch(/^[a-z0-9]{6,12}$/)
  expect(parseJobs(text).jobs[0]!.id).toBe(first.id)
  expect(first.enabled).toBe(true) // enabled defaults to yes
  expect(serializeJobs([first], '')).toContain(`## ปลุก {#${first.id}}`)
})

const bad: Array<[string, string, string]> = [
  ['unknown key', '## a {#x1}\n- kind: alarm\n- at: 2030-01-01 06:00\n- tite: oops\n', 'tite'],
  ['missing kind', '## a {#x1}\n- at: 2030-01-01 06:00\n', 'kind'],
  ['bad kind', '## a {#x1}\n- kind: reminder\n- at: 2030-01-01 06:00\n', 'kind'],
  ['no time', '## a {#x1}\n- kind: alarm\n', 'at'],
  ['both at and cron', '## a {#x1}\n- kind: alarm\n- at: 2030-01-01 06:00\n- cron: 0 6 * * *\n', 'cron'],
  ['bad date', '## a {#x1}\n- kind: alarm\n- at: 2030-02-30 06:00\n', 'at'],
  ['bad cron', '## a {#x1}\n- kind: alarm\n- cron: 61 * * * *\n', 'cron'],
  ['task without prompt', '## a {#x1}\n- kind: task\n- cron: 0 6 * * *\n', 'prompt'],
  ['bad enabled', '## a {#x1}\n- kind: alarm\n- enabled: maybe\n- at: 2030-01-01 06:00\n', 'enabled'],
  ['duplicate key', '## a {#x1}\n- kind: alarm\n- kind: alarm\n- at: 2030-01-01 06:00\n', 'kind'],
]
for (const [name, text, mention] of bad) {
  test(`a bad line is reported with its line number: ${name}`, () => {
    const { problems } = parseJobs(text)
    expect(problems.length).toBeGreaterThan(0)
    expect(problems[0]!.error).toContain(mention)
    expect(problems[0]!.line).toBeGreaterThan(0)
    expect(problems[0]!.text.length).toBeGreaterThan(0)
  })
}

test('the line number points at the offending line (1-based)', () => {
  const { problems } = parseJobs('# Neo jobs\n\n## a {#x1}\n- kind: alarm\n- at: 2030-01-01 06:00\n- cron: nope\n')
  expect(problems[0]).toMatchObject({ line: 6, text: '- cron: nope' })
})

test('two jobs with the same id are a problem', () => {
  const one = '- kind: alarm\n- at: 2030-01-01 06:00\n'
  expect(parseJobs(`## a {#same}\n${one}\n## b {#same}\n${one}`).problems[0]!.error).toContain('id')
})

test('a title that looks like an id tag survives', () => {
  const job: StoredJob = { id: 'abc123', kind: 'alarm', title: 'ปลุก {#fake} จริง', enabled: true, at: at(2030, 1, 1, 6, 0), notes: [] }
  expect(parseJobs(serializeJobs([job], '')).jobs).toEqual([job])
})
