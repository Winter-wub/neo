import { expect, test } from 'bun:test'
import { appendEntry, parseJournal, removeEntries, renderEntry } from './journal-doc'

const entry = { time: '09:41', q: 'ข่าววันนี้', a: 'มีข่าวดี', ok: true }

test('a day file round-trips: the header, then one "## HH:mm" block per turn', () => {
  const file = appendEntry(appendEntry('', '2026-10-26', entry), '2026-10-26', { time: '10:02', q: 'ฝนตกไหม', a: 'ขัดข้อง', ok: false })
  expect(file).toBe(`# 2026-10-26

## 09:41
- Q: ข่าววันนี้
- A: มีข่าวดี

## 10:02 ✗
- Q: ฝนตกไหม
- A: ขัดข้อง
`)
  expect(parseJournal(file)).toEqual([entry, { time: '10:02', q: 'ฝนตกไหม', a: 'ขัดข้อง', ok: false }])
})

test('newlines collapse to spaces and long text is capped (400 / 600) so one entry is always three lines', () => {
  const block = renderEntry({ time: '01:00', q: 'a\nb\r\nc', a: 'x'.repeat(700), ok: true })
  expect(block.split('\n')).toHaveLength(4) // heading, Q, A, and the trailing empty after the final \n
  expect(parseJournal('# d\n\n' + block)[0]).toEqual({ time: '01:00', q: 'a b c', a: 'x'.repeat(600), ok: true })
  expect(parseJournal('# d\n\n' + renderEntry({ time: '01:00', q: 'q'.repeat(500), a: '', ok: true }))[0]!.q).toHaveLength(400)
})

test('a hand-edited file is read leniently: stray lines are ignored, a missing A is empty', () => {
  const file = '# d\n\nnotes I wrote\n\n## 08:00\n- Q: hi\n\n## 08:05\n- Q: yo\n- A: ok\nmore stray text\n'
  expect(parseJournal(file)).toEqual([
    { time: '08:00', q: 'hi', a: '', ok: true },
    { time: '08:05', q: 'yo', a: 'ok', ok: true },
  ])
})

test('removeEntries drops the blocks the predicate selects and keeps the rest byte for byte', () => {
  const file = appendEntry(appendEntry('', 'D', entry), 'D', { time: '10:00', q: 'อื่น', a: 'b', ok: true })
  const kept = removeEntries(file, e => e.q === 'อื่น')
  expect(kept).toBe(appendEntry('', 'D', entry))
  expect(removeEntries(file, () => true)).toBeNull() // nothing left → the caller deletes the file
})
