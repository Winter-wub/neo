import type { Face, NeoEvent, PetInfo, WakeInfo } from '../../protocol'

const percent = (n: number) => `${Math.round(n * 100)}%`

export function petMarkdown({ pet, sleeping }: PetInfo) {
  return [
    '# สัตว์เลี้ยง',
    '',
    pet ? `- **หิว:** ${percent(pet.hunger)}\n- **ความผูกพัน:** ${percent(pet.affection)}\n- **รายงานล่าสุด:** ${new Date(pet.at).toLocaleString('en-GB')}` : '- ยังไม่มีรายงานจากมือถือ',
    `- **หลับลึก:** ${sleeping ? 'ใช่ (แตะจอมือถือเพื่อปลุก)' : 'ไม่'}`,
  ].join('\n')
}

export function wakeMarkdown({ name, variants, training }: WakeInfo) {
  return [
    `# ชื่อเรียก: ${name}`,
    '',
    `- **คำที่ใช้เรียก:** ${variants.join(' · ')}`,
    training ? `- **กำลังฝึก "${training.name}":** ได้ ${training.got.length}/3 ครั้ง${training.got.length ? ` (${training.got.join(', ')})` : ''} พูดชื่อใส่มือถือต่อได้เลย` : '',
  ].filter(Boolean).join('\n')
}

export function faceMarkdown(face: Face) {
  return ['# หน้า Neo', '', ...(['fg', 'accent', 'cheek', 'bg'] as const).map(key => `- **${key}:** ${face[key]}`)].join('\n')
}

type PetEventType = 'feed' | 'pet_ask' | 'pet' | 'sleep' | 'wakeup' | 'wake' | 'train' | 'face'
type PetEvent = Extract<NeoEvent, { type: PetEventType }>
const TYPES: readonly string[] = ['feed', 'pet_ask', 'pet', 'sleep', 'wakeup', 'wake', 'train', 'face'] satisfies PetEventType[]
export const isPetEvent = (event: NeoEvent): event is PetEvent => TYPES.includes(event.type)

/** One line per pet / name / face event for `neo events`. */
export function petEventLine(event: PetEvent, time: string) {
  const row = (type: string, text: string) => `${time}  ${type.padEnd(9)} ${text}`.trimEnd()
  switch (event.type) {
    case 'feed': return row('feed', event.food)
    case 'pet_ask': return row('pet_ask', 'ถามว่าหิวไหม')
    case 'pet': return row('pet', `หิว ${percent(event.hunger)} · ผูกพัน ${percent(event.affection)}`)
    case 'sleep': return row('sleep', 'หลับลึก ปิดไมค์')
    case 'wakeup': return row('wakeup', event.dreamCancelled ? 'ตื่นแล้ว ยกเลิกการฝัน' : 'ตื่นแล้ว')
    case 'wake': return row('wake', `${event.name} (${event.variants.join(', ')})`)
    case 'train': return row('train', `${event.name} ${event.n}/3${event.text ? ` "${event.text}"` : ''}`)
    case 'face': return row('face', `fg ${event.fg} · accent ${event.accent} · cheek ${event.cheek} · bg ${event.bg}`)
  }
}
