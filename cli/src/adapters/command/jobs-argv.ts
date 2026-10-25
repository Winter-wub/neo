import { SNOOZE_MAX_MIN } from '../../core/jobs/jobs'
import { parseWhen } from '../../core/jobs/markdown'
import type { JobKind } from '../../protocol'

/** Flags `neo jobs` adds to the parser. */
export const JOBS_VALUE_FLAGS = ['--kind', '--title', '--prompt', '--at', '--cron'] as const
export const JOBS_SWITCHES = ['--yes'] as const

export type JobsCommand =
  | { name: 'jobs-list' }
  | { name: 'jobs-parse'; speech: string }
  | { name: 'jobs-add-speech'; speech: string; yes: boolean }
  | { name: 'jobs-add'; kind: JobKind; title?: string; prompt?: string; at?: number; cron?: string }
  | { name: 'jobs-edit'; ref?: string; patch: { title?: string; prompt?: string; at?: number; cron?: string } }
  | { name: 'jobs-enable'; ref: string; enabled: boolean }
  | { name: 'jobs-rm'; ref: string }
  | { name: 'jobs-clear'; kind?: JobKind }
  | { name: 'jobs-test'; ref: string }
  | { name: 'alarm-stop' }
  | { name: 'alarm-snooze'; minutes: number }

export const JOBS_USAGE = `  neo jobs list                    งานตั้งเวลา (ปลุก/งาน) พร้อมเวลารอบถัดไป
  neo jobs parse "<ประโยค>"         แปลงประโยคเป็นงานให้ดูก่อน ไม่เพิ่มจริง
  neo jobs add "<ประโยค>" [--yes]  เช่น "ปลุกพรุ่งนี้ตีห้าครึ่ง": แสดงที่เข้าใจก่อน แล้วถามว่าจะเพิ่มไหม (--yes = เพิ่มเลย)
  neo jobs add --kind alarm|task --title … [--prompt …] (--at "YYYY-MM-DD HH:mm" | --cron "m h dom mon dow")
  neo jobs edit <id|ชื่อ> [--title] [--prompt] [--at|--cron]   ไม่ใส่ตัวเลือก = เปิด jobs.md ใน $EDITOR (ไม่บันทึกถ้าไฟล์ถูกแก้ซ้อน)
  neo jobs on|off <id|ชื่อ>         เปิด/ปิดงาน
  neo jobs rm <id|ชื่อ> · neo jobs clear [--kind alarm|task]   ลบ
  neo jobs test <id|ชื่อ>           ทำงานนั้นเดี๋ยวนี้
  neo alarm stop · neo alarm snooze <นาที>   ปิด/เลื่อนนาฬิกาปลุกที่กำลังดัง`

type Flags = Map<string, string | true>

/** Parses `neo jobs …` and `neo alarm …`. Returns null for any other noun. */
export function parseJobsArgv(
  noun: string | undefined,
  words: string[],
  flags: Flags,
  { only, noExtra, fail }: { only(allowed: string[]): void; noExtra(n: number): void; fail(message: string): never },
): JobsCommand | null {
  const [, verb] = words
  const text = (flag: string) => {
    const value = flags.get(flag)
    return typeof value === 'string' ? value : undefined
  }
  const when = () => {
    const raw = text('--at')
    if (raw === undefined) return undefined
    const ms = parseWhen(raw.trim())
    return ms ?? fail('--at ต้องเป็นเวลารูปแบบ "YYYY-MM-DD HH:mm" (เวลาเครื่อง)')
  }
  const kindFlag = () => {
    const raw = text('--kind')
    if (raw === undefined) return undefined
    if (raw !== 'alarm' && raw !== 'task') fail('--kind ต้องเป็น alarm หรือ task')
    return raw as JobKind
  }
  const ref = (usage: string) => {
    const value = words.slice(2).join(' ').trim()
    if (!value) fail(usage)
    return value
  }

  if (noun === 'alarm') {
    only([])
    if (verb === 'stop') {
      noExtra(2)
      return { name: 'alarm-stop' }
    }
    if (verb === 'snooze') {
      noExtra(3)
      const minutes = Number(words[2])
      if (!Number.isInteger(minutes) || minutes < 1 || minutes > SNOOZE_MAX_MIN) fail(`neo alarm snooze <นาที 1-${SNOOZE_MAX_MIN}>`)
      return { name: 'alarm-snooze', minutes }
    }
    return fail(`ไม่รู้จัก alarm ${verb ?? ''}`.trim())
  }
  if (noun !== 'jobs') return null

  switch (verb) {
    case undefined:
    case 'list':
      only([]); noExtra(2)
      return { name: 'jobs-list' }
    case 'parse': {
      only([])
      const speech = words.slice(2).join(' ').trim()
      if (!speech) return fail('neo jobs parse "<ประโยค>"')
      return { name: 'jobs-parse', speech }
    }
    case 'add': {
      const sentence = words.slice(2).join(' ').trim()
      if (sentence) {
        only(['--yes'])
        return { name: 'jobs-add-speech', speech: sentence, yes: flags.has('--yes') }
      }
      only(['--kind', '--title', '--prompt', '--at', '--cron'])
      const kind = kindFlag()
      if (!kind) return fail('neo jobs add "<ประโยค>" หรือ neo jobs add --kind alarm|task --title … (--at … | --cron …)')
      if (flags.has('--at') === flags.has('--cron')) fail('ใส่ได้อย่างเดียว: --at หรือ --cron')
      return { name: 'jobs-add', kind, title: text('--title'), prompt: text('--prompt'), at: when(), cron: text('--cron') }
    }
    case 'edit': {
      only(['--title', '--prompt', '--at', '--cron'])
      if (flags.has('--at') && flags.has('--cron')) fail('ใส่ได้อย่างเดียว: --at หรือ --cron')
      const patch = { title: text('--title'), prompt: text('--prompt'), at: when(), cron: text('--cron') }
      const given = Object.values(patch).some(value => value !== undefined)
      const target = words.slice(2).join(' ').trim() || undefined
      if (given && !target) fail('neo jobs edit <id|ชื่อ> [--title] [--prompt] [--at|--cron]')
      return { name: 'jobs-edit', ref: target, patch }
    }
    case 'on':
    case 'off':
      only([])
      return { name: 'jobs-enable', ref: ref(`neo jobs ${verb} <id|ชื่อ>`), enabled: verb === 'on' }
    case 'rm':
      only([])
      return { name: 'jobs-rm', ref: ref('neo jobs rm <id|ชื่อ>') }
    case 'test':
      only([])
      return { name: 'jobs-test', ref: ref('neo jobs test <id|ชื่อ>') }
    case 'clear':
      only(['--kind']); noExtra(2)
      return { name: 'jobs-clear', kind: kindFlag() }
    default:
      return fail(`ไม่รู้จัก jobs ${verb}`)
  }
}
