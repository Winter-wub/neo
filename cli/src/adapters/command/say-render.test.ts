import { expect, test } from 'bun:test'
import { UsageError, parseArgs } from './argv'
import { cardMarkdown, conversationLine } from './say-render'
import { textCard } from '../../core/cards/cards'

test('argv: say joins its words, --no-wait switches waiting off, cancel takes nothing', () => {
  expect(parseArgs(['say', 'นีโอ', 'สวัสดี']).command).toEqual({ name: 'say', text: 'นีโอ สวัสดี', wait: true })
  expect(parseArgs(['say', 'สวัสดี', '--no-wait']).command).toEqual({ name: 'say', text: 'สวัสดี', wait: false })
  expect(parseArgs(['cancel']).command).toEqual({ name: 'cancel' })
  expect(() => parseArgs(['say'])).toThrow(UsageError)
  expect(() => parseArgs(['cancel', 'x'])).toThrow(UsageError)
  expect(() => parseArgs(['status', '--no-wait'])).toThrow(UsageError)
})

test('a card prints as markdown: title, big value, lines, items', () => {
  const card = textCard({ title: 'ราคา', big: '฿35', lines: ['อัปเดตวันนี้'], items: [{ t: 'ทอง', v: '40,000' }, { t: 'เงิน', v: '' }] })
  expect(cardMarkdown(card)).toBe('# ราคา\n\n**฿35**\n\nอัปเดตวันนี้\n\n- ทอง: 40,000\n- เงิน')
})

test('conversation events get one readable line each', () => {
  const t = '09:00:00'
  expect(conversationLine({ type: 'session', at: 1, fresh: false, turn: 3, provider: 'Claude Code' }, t)).toBe('09:00:00  session   Claude Code · คุยต่อ · รอบที่ 3')
  expect(conversationLine({ type: 'tool', at: 1, name: 'WebSearch', input: 'x'.repeat(100) }, t)).toContain('…')
  expect(conversationLine({ type: 'cancelled', at: 1 }, t)).toBe('09:00:00  cancelled ยกเลิกแล้ว')
})
