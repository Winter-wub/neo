/** `neo animation …`: no flags of its own. */
export type AnimationCommand =
  | { name: 'animation-list' }
  | { name: 'animation-show'; tool: string }
  | { name: 'animation-redo'; tool: string }
  | { name: 'animation-rm'; tool: string }

export const ANIMATION_USAGE = `  neo animation list               แอนิเมชันที่ Neo วาดไว้ให้แต่ละเครื่องมือ (animations/<tool>.json)
  neo animation show <tool>        ดูรายละเอียด + เฟรมแรก (ชื่อเต็มหรือส่วนที่ตรงอันเดียว)
  neo animation redo <tool>        ให้ Brain วาดท่าใหม่ (เบื้องหลัง; ของเดิมเล่นต่อจนกว่าอันใหม่เสร็จ) · พูดว่า "วาดท่าใหม่" = ของเครื่องมือล่าสุด
  neo animation rm <tool>          ลบ (ครั้งหน้าที่ใช้เครื่องมือนี้ Neo วาดใหม่เอง)`

/** Parses `neo animation …`. Returns null for any other noun. */
export function parseAnimationArgv(
  noun: string | undefined,
  words: string[],
  { only, noExtra, fail }: { only(allowed: string[]): void; noExtra(n: number): void; fail(message: string): never },
): AnimationCommand | null {
  if (noun !== 'animation') return null
  const verb = words[1]
  only([])
  if (verb === 'list') {
    noExtra(2)
    return { name: 'animation-list' }
  }
  if (verb === 'show' || verb === 'redo' || verb === 'rm') {
    noExtra(3)
    if (!words[2]) return fail(`neo animation ${verb} <tool> (ดู neo animation list)`)
    return { name: `animation-${verb}`, tool: words[2] }
  }
  return fail(`ไม่รู้จัก animation ${verb ?? ''}`.trim())
}
