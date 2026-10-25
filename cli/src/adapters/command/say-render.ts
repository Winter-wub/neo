import type { Card, NeoEvent, SayResult } from '../../protocol'

export function cardMarkdown(card: Card) {
  const lines: string[] = [`# ${card.title || 'Neo'}`]
  if (card.big) lines.push('', `**${card.big}**`)
  if (card.layout === 'pixel') lines.push('', `(ภาพ pixel ${card.w}×${card.h} ดูได้บนจอมือถือ)`)
  if (card.lines.length) lines.push('', ...card.lines)
  if (card.items.length) lines.push('', ...card.items.map(item => `- ${item.t}${item.v ? `: ${item.v}` : ''}`))
  return lines.join('\n')
}

/** What `neo say` prints when it worked (exit 0). Failures are thrown by the caller. */
export function sayMarkdown(result: Extract<SayResult, { outcome: 'card' | 'accepted' | 'heard' }>) {
  switch (result.outcome) {
    case 'card': return cardMarkdown(result.card)
    case 'accepted': return 'ส่งให้ Neo แล้ว'
    case 'heard': return 'Neo พร้อมฟังแล้ว พูดต่อได้เลย'
  }
}

export const NOT_ADDRESSED = 'Neo ได้ยินแล้วแต่ไม่ได้ตอบ: ต้องขึ้นต้นด้วยชื่อเรียก (เช่น "นีโอ …") หรือปิดด้วย neo settings set requireName false'

const clip = (text: string, max = 60) => (text.length > max ? text.slice(0, max - 1) + '…' : text)

type ConversationEvent = Extract<NeoEvent, { type: 'heard' | 'ignored' | 'armed' | 'thinking' | 'session' | 'tool' | 'card' | 'askerr' | 'cancelled' }>

/** One line per conversation event for `neo events`. */
export function conversationLine(event: ConversationEvent, time: string) {
  const row = (type: string, text: string) => `${time}  ${type.padEnd(9)} ${text}`.trimEnd()
  switch (event.type) {
    case 'heard': return row('heard', event.text)
    case 'ignored': return row('ignored', event.text)
    case 'armed': return row('armed', 'รอฟังคำสั่ง')
    case 'thinking': return row('thinking', event.text)
    case 'session': return row('session', `${event.provider} · ${event.fresh ? 'เริ่มใหม่' : 'คุยต่อ'} · รอบที่ ${event.turn}`)
    case 'tool': return row('tool', `${event.name} ${clip(event.input)}`)
    case 'card': return row('card', [event.card.title, ...event.card.lines.slice(0, 2)].filter(Boolean).join(' · '))
    case 'askerr': return row('askerr', event.error)
    case 'cancelled': return row('cancelled', 'ยกเลิกแล้ว')
  }
}
