import type { NeoEvent, Settings, Status } from '../../protocol'
import { conversationLine } from './say-render'
import { isSpeechEvent, speechEventLine } from './speech-render'
import { dreamEventLine, isDreamEvent } from './dream-render'
import { isJobsEvent, jobsEventLine } from './jobs-render'
import { isPetEvent, petEventLine } from './pet-render'

const yes = (value: boolean) => (value ? 'ใช่' : 'ไม่')

function duration(seconds: number) {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  return [h && `${h} ชม.`, m && `${m} นาที`, (s || !(h || m)) && `${s} วินาที`].filter(Boolean).join(' ')
}

export function statusMarkdown(s: Status) {
  const pet = s.pet ? `หิว ${Math.round(s.pet.hunger * 100)}% · ความผูกพัน ${Math.round(s.pet.affection * 100)}%` : 'ยังไม่มีข้อมูล'
  return [
    '# Neo',
    '',
    `- **มือถือ:** ${s.phone ? 'เชื่อมต่ออยู่' : 'ไม่ได้เชื่อมต่อ'}`,
    `- **คอนโซลที่เปิดอยู่:** ${s.consoles}`,
    `- **Brain:** ${s.provider || '—'}${s.model ? ` (${s.model})` : ''}`,
    `- **กำลังคิด:** ${yes(s.thinking)}`,
    `- **ต้องเรียกชื่อก่อนถาม:** ${yes(s.requireName)}`,
    `- **ข้ามการขออนุญาต:** ${yes(s.bypass)}`,
    `- **สัตว์เลี้ยง:** ${pet}`,
    `- **ทำงานมาแล้ว:** ${duration(s.uptime)}`,
    `- **pid:** ${s.pid}`,
  ].join('\n')
}

export function settingsMarkdown(s: Settings) {
  return [
    '# การตั้งค่า',
    '',
    `- **requireName:** ${s.requireName}`,
    `- **followUp:** ${s.followUp}`,
    `- **bypass:** ${s.bypass}`,
    `- **tailscale:** ${s.tailscale}`,
    `- **lan:** ${s.lan}`,
    `- **idle.sleepAfter:** ${s.idle.sleepAfter} วินาที`,
    `- **idle.clock:** ${s.idle.clock}`,
    `- **dream:** ${s.dream}`,
    `- **onboarded:** ${s.onboarded}`,
    `- **claudeConfigDir:** ${s.claudeConfigDir ?? '— (ใช้ค่าเริ่มต้นของ claude)'}`,
    `- **home:** ${s.home.city} (${s.home.lat}, ${s.home.lon})`,
    `- **mcpServers:** ${s.mcpServers?.join(', ') ?? '— (ชุดเริ่มต้น)'}`,
  ].join('\n')
}

export function eventLine(event: NeoEvent) {
  const time = new Date(event.at).toLocaleTimeString('en-GB')
  switch (event.type) {
    case 'status':
      return `${time}  status    มือถือ ${event.phone ? 'เชื่อม' : 'ไม่เชื่อม'} · คอนโซล ${event.consoles} · คิด ${yes(event.thinking)}`
    case 'settings':
      return `${time}  settings  requireName=${event.requireName} followUp=${event.followUp} bypass=${event.bypass}`
    case 'idle':
      return `${time}  idle      หลับหลัง ${event.sleepAfter} วินาที · นาฬิกา ${event.clock}`
    case 'paired':
      return `${time}  paired    ${event.name}`
    case 'devices':
      return `${time}  devices   รายการมือถือเปลี่ยน`
    case 'changed':
      return `${time}  changed   ${event.file === 'memory' ? 'memory.md' : event.file === 'dream' ? `dreams/${event.id ?? ''}.md` : `journal/${event.day ?? ''}.md`} เปลี่ยน`
    case 'provider':
      return `${time}  provider  ${event.label} (${event.name})`
    case 'model':
      return `${time}  model     ${event.name} → ${event.model ?? 'ค่าเริ่มต้น'}${event.id && event.id !== event.model ? ` (${event.id})` : ''}`
    default:
      return isDreamEvent(event) ? dreamEventLine(event, time) : isSpeechEvent(event) ? speechEventLine(event, time) : isJobsEvent(event) ? jobsEventLine(event, time) : isPetEvent(event) ? petEventLine(event, time) : conversationLine(event, time)
  }
}
