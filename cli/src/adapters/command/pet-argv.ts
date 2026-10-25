import { FOODS, type Face, type Food } from '../../protocol'

/** Flags `neo pet` / `neo name` / `neo face` add to the parser. */
export const PET_VALUE_FLAGS = ['--variants', '--fg', '--accent', '--cheek', '--bg'] as const
export const PET_SWITCHES = ['--cancel'] as const

export type PetCommand =
  | { name: 'pet-show' }
  | { name: 'pet-feed'; food?: Food }
  | { name: 'pet-sleep' }
  | { name: 'name-show' }
  | { name: 'name-set'; petName: string; variants?: string[] }
  | { name: 'name-train'; petName: string }
  | { name: 'name-train-cancel' }
  | { name: 'face-show' }
  | { name: 'face-set'; face: Partial<Face> }
  | { name: 'phone-wake' }
  | { name: 'phone-pet'; hunger: number; affection: number }

export const PET_USAGE = `  neo pet                          ความหิว/ความผูกพันที่มือถือรายงานล่าสุด + หลับอยู่ไหม
  neo pet feed [fish|cookie|milk]  ให้อาหาร (มือถือกินให้ดู)
  neo pet sleep                    หลับลึก (ปิดไมค์ แตะจอถึงตื่น ครบ 15 นาทีฝัน)
  neo name                         ชื่อเรียก + คำที่ใช้เรียก
  neo name set <ชื่อ> [--variants a,b]   ตั้งชื่อเรียกทันที
  neo name train <ชื่อ>              พูดชื่อ 3 ครั้ง Neo จำคำที่ถอดเสียงได้ (neo name train --cancel = เลิก)
  neo face                         สีหน้า Neo
  neo face set [--fg] [--accent] [--cheek] [--bg]   เปลี่ยนสี (#rrggbb) สดบนมือถือ
  neo phone wake · neo phone pet <หิว 0-1> <ผูกพัน 0-1>   ทำตัวเป็นมือถือ`

export const PET_NOUNS = ['pet', 'name', 'face'] as const
type Flags = Map<string, string | true>

const FACE_FLAGS = ['--fg', '--accent', '--cheek', '--bg'] as const
const COLOUR = /^#[0-9a-f]{6}$/i

/** Parses `neo pet|name|face …` and `neo phone wake|pet`. Returns null for any other noun. */
export function parsePetArgv(
  noun: string | undefined,
  words: string[],
  flags: Flags,
  { only, noExtra, fail }: { only(allowed: string[]): void; noExtra(n: number): void; fail(message: string): never },
): PetCommand | null {
  const [, verb] = words
  if (noun === 'phone') {
    if (verb === 'wake') {
      only([]); noExtra(2)
      return { name: 'phone-wake' }
    }
    if (verb === 'pet') {
      only([]); noExtra(4)
      const [hunger, affection] = [Number(words[2]), Number(words[3])]
      if (words[2] === undefined || words[3] === undefined || ![hunger, affection].every(n => Number.isFinite(n) && n >= 0 && n <= 1)) {
        fail('neo phone pet <หิว 0-1> <ผูกพัน 0-1>')
      }
      return { name: 'phone-pet', hunger, affection }
    }
    return null
  }
  if (noun === 'pet') {
    switch (verb) {
      case undefined:
        only([]); noExtra(1)
        return { name: 'pet-show' }
      case 'feed': {
        only([]); noExtra(3)
        const food = words[2]
        if (food !== undefined && !(FOODS as readonly string[]).includes(food)) fail(`อาหารมี ${FOODS.join(' | ')}`)
        return { name: 'pet-feed', food: food as Food | undefined }
      }
      case 'sleep':
        only([]); noExtra(2)
        return { name: 'pet-sleep' }
      default:
        return fail(`ไม่รู้จัก pet ${verb}`)
    }
  }
  if (noun === 'name') {
    switch (verb) {
      case undefined:
        only([]); noExtra(1)
        return { name: 'name-show' }
      case 'set': {
        only(['--variants'])
        const petName = words.slice(2).join(' ').trim()
        if (!petName) fail('neo name set <ชื่อ> [--variants a,b]')
        const raw = flags.get('--variants')
        const variants = typeof raw === 'string' ? raw.split(',').map(v => v.trim()).filter(Boolean) : undefined
        return { name: 'name-set', petName, variants }
      }
      case 'train': {
        only(['--cancel'])
        const petName = words.slice(2).join(' ').trim()
        if (flags.has('--cancel')) {
          if (petName) fail('--cancel ใช้โดยไม่มีชื่อ')
          return { name: 'name-train-cancel' }
        }
        if (!petName) fail('neo name train <ชื่อ> หรือ neo name train --cancel')
        return { name: 'name-train', petName }
      }
      default:
        return fail(`ไม่รู้จัก name ${verb}`)
    }
  }
  if (noun === 'face') {
    if (verb === undefined) {
      only([]); noExtra(1)
      return { name: 'face-show' }
    }
    if (verb !== 'set') return fail(`ไม่รู้จัก face ${verb}`)
    only([...FACE_FLAGS]); noExtra(2)
    const face: Partial<Face> = {}
    for (const flag of FACE_FLAGS) {
      const value = flags.get(flag)
      if (value === undefined) continue
      if (typeof value !== 'string' || !COLOUR.test(value)) fail(`${flag} ต้องเป็นสีแบบ #rrggbb`)
      face[flag.slice(2) as keyof Face] = value as string
    }
    if (!Object.keys(face).length) fail('neo face set [--fg #rrggbb] [--accent …] [--cheek …] [--bg …]')
    return { name: 'face-set', face }
  }
  return null
}
