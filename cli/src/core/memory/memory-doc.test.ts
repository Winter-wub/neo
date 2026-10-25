import { expect, test } from 'bun:test'
import { addItem, parseMemory, removeItems } from './memory-doc'

const SAMPLE = `## ชอบ
- กาแฟดำ
- แมว

ข้อความอิสระ

## งาน
- ใช้ Jira
`

test('items are the "- " lines under their ## section; other lines are kept but are not items', () => {
  expect(parseMemory(SAMPLE)).toEqual([
    { section: 'ชอบ', text: 'กาแฟดำ' },
    { section: 'ชอบ', text: 'แมว' },
    { section: 'งาน', text: 'ใช้ Jira' },
  ])
  expect(parseMemory('- no section yet\n')).toEqual([{ section: '', text: 'no section yet' }])
  expect(parseMemory('')).toEqual([])
})

test('addItem appends to the end of an existing section and leaves the rest of the text untouched', () => {
  const { text, added } = addItem(SAMPLE, 'ชอบฝน', 'ชอบ')
  expect(added).toBe(true)
  expect(text).toBe(SAMPLE.replace('- แมว\n', '- แมว\n- ชอบฝน\n'))
})

test('addItem creates a missing section at the end, defaults to "อื่น ๆ", and ignores duplicates', () => {
  expect(addItem('', 'a').text).toBe('## อื่น ๆ\n- a\n')
  expect(addItem(SAMPLE, 'x', 'ใหม่').text).toBe(SAMPLE + '\n## ใหม่\n- x\n')
  const again = addItem(SAMPLE, ' แมว ', 'ชอบ')
  expect(again).toEqual({ text: SAMPLE, added: false })
})

test('addItem flattens newlines, strips a leading "- " and refuses empty text', () => {
  expect(addItem('', '- line one\nline two', '## S').text).toBe('## S\n- line one line two\n')
  expect(() => addItem('', '  - ')).toThrow()
})

test('removeItems takes out matching bullet lines only (case-insensitive substring)', () => {
  const found = removeItems(SAMPLE, 'jira')
  expect(found.matches).toEqual([{ section: 'งาน', text: 'ใช้ Jira' }])
  expect(found.text).toBe(SAMPLE.replace('- ใช้ Jira\n', ''))
})

test('removeItems with several matches removes nothing unless all; an exact match wins over substrings', () => {
  const text = '## a\n- ชา\n- ชาเขียว\n'
  expect(removeItems(text, 'ชา').matches.map(m => m.text)).toEqual(['ชา']) // exact
  const many = '## a\n- ชาเขียว\n- ชานม\n'
  const listed = removeItems(many, 'ชา')
  expect(listed.matches).toHaveLength(2)
  expect(listed.text).toBe(many)
  expect(removeItems(many, 'ชา', { all: true }).text).toBe('## a\n')
})
