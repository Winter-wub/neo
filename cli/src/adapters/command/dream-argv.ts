/** `neo dream …`: no flags of its own. */
export type DreamCommand =
  | { name: 'dream-now' }
  | { name: 'dream-enable'; enabled: boolean }
  | { name: 'dream-list' }
  | { name: 'dream-show'; id: string }
  | { name: 'dream-rm'; id: string }
  | { name: 'dream-clear' }
  | { name: 'dream-status' }

export const DREAM_USAGE = `  neo dream now                    ฝันเดี๋ยวนี้ (จัดระเบียบความจำจาก journal + ค้นเรื่องเก่าให้ลึกขึ้น) รอจนเสร็จ
  neo dream on|off                 อนุญาต/ห้ามฝันเองตอนผู้ใช้ไม่อยู่ (neo settings set dream)
  neo dream list                   ความฝันที่เก็บไว้ (dreams/<YYYY-MM-DD-HHmm>.md) ใหม่สุดก่อน
  neo dream show [<id>]            ดูความฝัน (ไม่ใส่ id = ล่าสุด)
  neo dream rm <id> · neo dream clear   ลบความฝัน
  neo dream status                 ฝันครั้งล่าสุด · ตอนนี้ฝันได้ไหมเพราะอะไร · ชั่วโมงที่ปกติไม่อยู่ · กิจกรรม 24 ชม.`

/** Parses `neo dream …`. Returns null for any other noun. */
export function parseDreamArgv(
  noun: string | undefined,
  words: string[],
  { only, noExtra, fail }: { only(allowed: string[]): void; noExtra(n: number): void; fail(message: string): never },
): DreamCommand | null {
  if (noun !== 'dream') return null
  const verb = words[1]
  only([])
  switch (verb) {
    case 'now': noExtra(2); return { name: 'dream-now' }
    case 'on': noExtra(2); return { name: 'dream-enable', enabled: true }
    case 'off': noExtra(2); return { name: 'dream-enable', enabled: false }
    case 'list': noExtra(2); return { name: 'dream-list' }
    case 'clear': noExtra(2); return { name: 'dream-clear' }
    case 'status': noExtra(2); return { name: 'dream-status' }
    case 'show': noExtra(3); return { name: 'dream-show', id: words[2] ?? 'last' }
    case 'rm':
      noExtra(3)
      if (!words[2]) return fail('neo dream rm <id> (ดู neo dream list)')
      return { name: 'dream-rm', id: words[2] }
    default: return fail(`ไม่รู้จัก dream ${verb ?? ''}`.trim())
  }
}
