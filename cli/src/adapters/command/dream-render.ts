import type { DreamDoc, DreamInfo, DreamStatus, NeoEvent } from '../../protocol'

const when = (ms: number) => new Date(ms).toLocaleString('en-GB', { hour12: false })

export const dreamLine = (d: DreamInfo) => `- ${d.id} — ${d.dream || '(ไม่มีชื่อ)'} · ${d.reason}${d.undelivered ? ' · ยังไม่ได้เล่าให้มือถือ' : ''}`

export function dreamListMarkdown(dreams: DreamInfo[]) {
  return dreams.length ? dreams.map(dreamLine).join('\n') : '(ยังไม่เคยฝัน — neo dream now)'
}

export function dreamDoneMarkdown(d: DreamDoc) {
  return [`ฝันแล้ว: ${d.dream || '(ไม่มีชื่อ)'}`, `ไฟล์ dreams/${d.id}.md · อ่าน ${d.entries} รายการ · ใช้เวลา ${Math.round(d.took / 1000)} วินาที · ความจำ +${d.added.length} −${d.removed.length}`].join('\n')
}

const BARS = '▁▂▃▄▅▆▇█'
const bar = (v: number) => (v <= 0 ? '·' : BARS[Math.min(BARS.length - 1, Math.floor(v * BARS.length))]!)

export function dreamStatusMarkdown(s: DreamStatus) {
  const quiet = s.quietHours.length ? s.quietHours.map(h => String(h).padStart(2, '0')).join(' ') : '—'
  return [
    '# การฝัน',
    '',
    `- **ฝันเองตอนไม่อยู่:** ${s.enabled ? 'เปิด' : 'ปิด'}${s.running ? ' (กำลังฝันอยู่)' : ''}`,
    `- **ฝันครั้งล่าสุด:** ${s.last ? `${when(s.last.at)} — ${s.last.dream} (${s.last.id})` : 'ยังไม่เคย'}`,
    `- **ตอนนี้:** ${s.why ? `ฝันได้ (${s.why})` : `ยังไม่ฝัน — ${s.blocked}`}`,
    `- **เรื่องใหม่ใน journal:** ${s.newEntries} รายการ · ผู้ใช้เงียบมา ${s.idleMinutes} นาที`,
    `- **ชั่วโมงที่ปกติไม่อยู่:** ${quiet}${s.quietNow ? ' (ตอนนี้อยู่ในช่วงนี้)' : ''}`,
    `- **กิจกรรมตามชั่วโมง (00–23):** ${s.activity.map(bar).join('')}`,
  ].join('\n')
}

type DreamEvent = Extract<NeoEvent, { type: 'dreaming' | 'dream_done' | 'dream_fail' }>
export const isDreamEvent = (event: NeoEvent): event is DreamEvent => event.type === 'dreaming' || event.type === 'dream_done' || event.type === 'dream_fail'

export function dreamEventLine(event: DreamEvent, time: string) {
  switch (event.type) {
    case 'dreaming': return `${time}  dreaming  เริ่มฝัน (${event.reason}) อ่าน ${event.entries} รายการ`
    case 'dream_done': return `${time}  dream_done ${event.dream ?? ''}${event.insights === undefined ? '' : ` · ค้นพบ ${event.insights} เรื่อง`}`.trimEnd()
    case 'dream_fail': return `${time}  dream_fail ${event.error}`
  }
}
