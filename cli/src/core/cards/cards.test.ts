import { expect, test } from 'bun:test'
import { chunk, confirmCard, humanize, textCard } from './cards'
import type { Card } from '../../protocol'

const base: Omit<Card, 'title' | 'lines'> = { kind: 'text', layout: 'text', icon: 'text', emotion: 'happy', sounds: ['happy'], seconds: 20, items: [] }

test('markdown, links and escapes are turned into plain Thai-readable lines', () => {
  const card = humanize({ ...base, title: '**สรุปข่าว**', lines: ['## หัวข้อ [อ่านต่อ](https://example.com/a/b)', 'ดู https://www.bbc.com/news/123 ได้เลย', '`code` และ ~~ขีด~~'] })
  expect(card.title).toBe('สรุปข่าว')
  expect(card.lines).toEqual(['หัวข้อ อ่านต่อ', 'ดู bbc.com ได้เลย', 'code และ ขีด'])
})

test('a line that is raw JSON becomes "label: value" lines, skipping internal keys', () => {
  const card = humanize({ ...base, title: 't', lines: ['{"id":"x1","ticketName":"แก้บั๊ก","status":"open","url":"http://a.b"}'] })
  expect(card.lines).toEqual(['ticket Name: แก้บั๊ก', 'status: open'])
})

test('long lines wrap at 40 columns and at most 14 lines are kept, ending with an ellipsis', () => {
  const long = Array.from({ length: 30 }, (_, i) => `บรรทัด${i}`)
  const card = humanize({ ...base, title: 't', lines: long })
  expect(card.lines).toHaveLength(14)
  expect(card.lines[13]!.endsWith('…')).toBe(true)
  const wide = humanize({ ...base, title: 't', lines: ['a'.repeat(100)] })
  expect(wide.lines.map(l => l.length)).toEqual([40, 40, 20])
})

test('title is cut to 30 chars, big to 14', () => {
  const card = humanize({ ...base, title: 'x'.repeat(50), big: 'y'.repeat(30), lines: ['a'] })
  expect(card.title).toHaveLength(30)
  expect(card.big).toHaveLength(14)
})

test('list items are normalised, empty ones dropped; a list with no items falls back to text', () => {
  const card = humanize({ ...base, layout: 'list', title: 't', lines: [], items: [{ t: 'งาน **A**', v: 'เสร็จ' }, { t: '', v: '' }, { text: 'B', value: 'ค้าง' }] as never })
  expect(card.items).toEqual([{ t: 'งาน A', v: 'เสร็จ' }, { t: 'B', v: 'ค้าง' }])
  const empty = humanize({ ...base, layout: 'list', title: 't', lines: ['x'], items: [] })
  expect(empty.layout).toBe('text')
})

test('an empty card still says something', () => {
  expect(humanize({ ...base, title: 't', lines: [] }).lines).toEqual(['(ไม่มีรายละเอียด)'])
})

const pixel = { ...base, layout: 'pixel', title: 'ต้นไม้', w: 4, h: 4, palette: { g: '#00FF00', zz: '#fff', r: 'red' }, frames: [['gg', 'g.g.g', '....', '....']], fps: 99 } as unknown as Card

test('a valid pixel picture is cleaned to w×h with only palette colours', () => {
  const card = humanize(pixel) as Card & { frames: string[][]; palette: Record<string, string>; fps: number }
  expect(card.palette).toEqual({ g: '#00ff00' })
  expect(card.frames).toEqual([['gg..', 'g.g.', '....', '....']])
  expect(card.fps).toBe(12)
  expect(card.lines).toEqual([])
})

test('a pixel card with no usable picture becomes an apology text card', () => {
  const card = humanize({ ...pixel, frames: [['....', '....', '....', '....']] } as never)
  expect(card).toMatchObject({ layout: 'text', emotion: 'confused', lines: ['วาดไม่สำเร็จ ลองใหม่อีกทีนะ'] })
})

test('confirmCard asks the user to say ตกลง or ยกเลิก', () => {
  const card = confirmCard({ skill: 'jenkins', plan: 'ดูสถานะ build' })
  expect(card.title).toBe('ใช้ jenkins?')
  expect(card.lines.at(-1)).toBe('พูด “ตกลง” เพื่อทำ หรือ “ยกเลิก”')
  expect(card.seconds).toBe(30)
})

test('textCard builds a full card; chunk splits at spaces', () => {
  expect(textCard({ title: 'a', lines: ['b'] })).toMatchObject({ kind: 'text', layout: 'text', items: [], seconds: 10 })
  expect(chunk('aaa bbb ccc', 7)).toEqual(['aaa bbb', 'ccc'])
})
