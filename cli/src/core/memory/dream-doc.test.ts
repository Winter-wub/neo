import { expect, test } from 'bun:test'
import { dreamId, parseDream, renderDream, type DreamParts } from './dream-doc'

const SAMPLE: DreamParts = {
  at: 1_790_000_000_000,
  reason: 'ช่วงที่ปกติคุณไม่อยู่',
  took: 12_345,
  entries: 5,
  undelivered: true,
  dream: 'ฝันถึงปลาทอง',
  insights: [{ q: 'ตั๋วไปเชียงใหม่', finding: 'ถูกสุดวันอังคาร' }],
  patterns: ['ถามอากาศทุกเช้า'],
  added: ['ชอบแมว'],
  removed: ['ใช้ Jira เก่า'],
  card: { title: 'ฝันแล้ว', lines: ['ฝันถึงปลาทอง', 'ตั๋วถูกวันอังคาร'], items: [{ t: 'ตั๋ว', v: '1,200' }] },
}

test('a dream file round-trips through render and parse', () => {
  expect(parseDream(renderDream(SAMPLE))).toEqual(SAMPLE)
})

test('the file is plain markdown: heading, +/− memory changes, card; delivered dreams have no undelivered line', () => {
  const text = renderDream({ ...SAMPLE, undelivered: false })
  expect(text).toContain('# ฝันถึงปลาทอง')
  expect(text).toContain('## Memory changes\n- + ชอบแมว\n- − ใช้ Jira เก่า')
  expect(text).not.toContain('undelivered')
  expect(parseDream(text).undelivered).toBe(false)
})

test('an edited or half-written file still parses: missing sections are empty, stray lines are ignored', () => {
  const parsed = parseDream('# แค่ฝัน\n\nบันทึกของฉัน\n\n## Patterns\n- a\nstray\n')
  expect(parsed).toMatchObject({ dream: 'แค่ฝัน', patterns: ['a'], insights: [], added: [], removed: [], undelivered: false })
  expect(parsed.card).toEqual({ title: '', lines: [], items: [] })
})

test('newlines in values cannot break the structure', () => {
  const back = parseDream(renderDream({ ...SAMPLE, dream: 'a\n## Card', added: ['x\n- − y'] }))
  expect(back.dream).toBe('a ## Card')
  expect(back.added).toEqual(['x - − y'])
  expect(back.removed).toEqual(['ใช้ Jira เก่า'])
})

test('the id is the local date and time, with a counter when the minute is taken', () => {
  const at = new Date(2026, 9, 26, 2, 5).getTime()
  expect(dreamId(at, () => false)).toBe('2026-10-26-0205')
  expect(dreamId(at, id => id === '2026-10-26-0205')).toBe('2026-10-26-0205-2')
})
