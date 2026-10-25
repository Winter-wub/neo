import { expect, test } from 'bun:test'
import { parseAnswer } from './parse'

test('a card is taken from the first {…} span, even with chatter around it', () => {
  const answer = parseAnswer('นี่ครับ {"layout":"big","big":"฿35","title":"ราคา","lines":["a","b"]} จบ')
  expect(answer).toMatchObject({ type: 'card', card: { kind: 'text', layout: 'big', big: '฿35', lines: ['a', 'b'], seconds: 23 } })
})

test('seconds defaults to 15 + 4 per line and is clamped to 15..90', () => {
  const card = (json: object) => (parseAnswer(JSON.stringify(json)) as { card: { seconds: number } }).card.seconds
  expect(card({ lines: [] })).toBe(15)
  expect(card({ lines: ['a'] })).toBe(19)
  expect(card({ lines: [], seconds: 500 })).toBe(90)
  expect(card({ lines: [], seconds: 3 })).toBe(15)
})

test('an unknown layout becomes text; items accept t/v or text/value', () => {
  const answer = parseAnswer('{"layout":"grid","items":[{"text":"A","value":"1"}]}')
  expect(answer).toMatchObject({ type: 'card', card: { layout: 'text', items: [{ t: 'A', v: '1' }] } })
})

test('pixel cards pass through for Cards to validate', () => {
  expect(parseAnswer('{"layout":"pixel","w":8,"h":8}')).toMatchObject({ type: 'card', card: { layout: 'pixel', w: 8 } })
})

test('intents become typed answers', () => {
  expect(parseAnswer('{"intent":"weather","place":"เชียงใหม่","day":1}')).toEqual({ type: 'weather', place: 'เชียงใหม่', day: 1 })
  expect(parseAnswer('{"intent":"skill","skill":"jenkins","plan":"ดู build","task":"run"}')).toEqual({ type: 'skill', skill: 'jenkins', plan: 'ดู build', task: 'run' })
  expect(parseAnswer('{"intent":"schedule","kind":"alarm","title":"ผ้า","prompt":"","at":"2026-10-27T09:00"}')).toEqual({ type: 'schedule', kind: 'alarm', title: 'ผ้า', prompt: '', at: '2026-10-27T09:00' })
})

test('text with no JSON is a bad-json error', () => {
  expect(parseAnswer('ขอโทษครับ')).toEqual({ type: 'error', error: 'bad json' })
  expect(parseAnswer('{"intent":"fly"}')).toEqual({ type: 'error', error: 'bad json' })
})
