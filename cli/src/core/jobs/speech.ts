// Thai fast phrases about time ("ปลุกพรุ่งนี้ตีห้าครึ่ง"), ported from app/schedule.js. `now` is always passed in.
import type { JobKind } from '../../protocol'

export type NewJob = { kind: JobKind; title: string; enabled: boolean; prompt?: string; at?: number; cron?: string }
export type SpeechResult =
  | { action: 'add'; job: NewJob }
  | { action: 'list' }
  | { action: 'clear'; kind: JobKind | null }
  | { error: string }

const DIG: Record<string, number> = { หนึ่ง: 1, เอ็ด: 1, สอง: 2, ยี่: 2, สาม: 3, สี่: 4, ห้า: 5, หก: 6, เจ็ด: 7, แปด: 8, เก้า: 9 }
const UNIT = '(?:หนึ่ง|สอง|สาม|สี่|ห้า|หก|เจ็ด|แปด|เก้า)'

/** Number words (up to 99) and Thai numerals → digits. */
export function digits(text: string) {
  const arabic = text.replace(/[๐-๙]/g, c => String('๐๑๒๓๔๕๖๗๘๙'.indexOf(c)))
  return arabic.replace(new RegExp(`(?:(${UNIT}|ยี่)?สิบ(เอ็ด|${UNIT})?|(${UNIT}))`, 'g'), (_m, tens?: string, ones?: string, solo?: string) => {
    if (solo) return String(DIG[solo])
    return String((tens ? DIG[tens]! : 1) * 10 + (ones ? DIG[ones]! : 0))
  })
}

const DAYS: Record<string, number> = { อาทิตย์: 0, จันทร์: 1, อังคาร: 2, พุธ: 3, พฤหัส: 4, พฤหัสบดี: 4, ศุกร์: 5, เสาร์: 6 }
const DAY_RE = 'อาทิตย์|จันทร์|อังคาร|พุธ|พฤหัส(?:บดี)?|ศุกร์|เสาร์'

const mins = (half?: string, n?: string) => (half === 'ครึ่ง' ? 30 : n ? Number(n) : 0)

/** The time of day in a sentence, and the part of the sentence it came from. */
export function clockOf(text: string): { h: number; m: number; span: string } | null {
  const M = '(?:\\s*(ครึ่ง|(\\d{1,2})\\s*(?:นาที)?))?'
  const rules: Array<[RegExp, (m: RegExpMatchArray) => [number, number]]> = [
    [/(\d{1,2})\s*[:.]\s*(\d{2})\s*(?:น\.|นาฬิกา)?/, m => [+m[1]!, +m[2]!]],
    [/(\d{1,2})\s*นาฬิกา(?:\s*(\d{1,2})\s*นาที)?/, m => [+m[1]!, +(m[2] || 0)]],
    [new RegExp('เที่ยงคืน' + M), m => [0, mins(m[1], m[2])]],
    [new RegExp('เที่ยง(?:วัน)?' + M), m => [12, mins(m[1], m[2])]],
    [new RegExp('ตี\\s*(\\d{1,2})' + M), m => [+m[1]! % 12, mins(m[2], m[3])]],
    [new RegExp('บ่าย\\s*(\\d{1,2})?\\s*โมง(?:เย็น)?' + M), m => [12 + (+(m[1] || 1) % 12), mins(m[2], m[3])]],
    [new RegExp('บ่าย\\s*(\\d{1,2})(?!\\s*(?:นาที|ชั่วโมง|วัน))' + M), m => [12 + (+m[1]! % 12), mins(m[2], m[3])]], // "บ่ายสอง" has no โมง
    [new RegExp('(\\d{1,2})\\s*โมง\\s*เย็น' + M), m => [12 + (+m[1]! % 12), mins(m[2], m[3])]],
    [new RegExp('(\\d{1,2})\\s*โมง\\s*เช้า' + M), m => [+m[1]! % 12, mins(m[2], m[3])]],
    [new RegExp('(\\d{1,2})\\s*ทุ่ม' + M), m => [(18 + +m[1]!) % 24, mins(m[2], m[3])]],
    [new RegExp('(\\d{1,2})\\s*โมง' + M), m => {
      const h = +m[1]!
      return [h >= 6 && h <= 12 ? h : h < 6 ? h + 12 : h, mins(m[2], m[3])] // 6-12 โมง = morning, 1-5 โมง = afternoon
    }],
  ]
  for (const [re, f] of rules) {
    const m = text.match(re)
    if (m) {
      const [h, minute] = f(m)
      if (h >= 0 && h < 24 && minute >= 0 && minute < 60) return { h, m: minute, span: m[0] }
    }
  }
  return null
}

export const ALARM_RE = /(?:ตั้ง)?(?:นาฬิกา)?ปลุก|(?:ช่วย)?เตือน(?:ความจำ)?|(?:ตั้ง)?เวลาเตือน/
const REPEAT_RE = new RegExp(`ทุก\\s*(?:วัน\\s*)?(?:${DAY_RE})|ทุกวัน(?:ทำงาน|ธรรมดา)|วันธรรมดา|จันทร์\\s*(?:ถึง|-)\\s*ศุกร์|ทุก\\s*(?:เสาร์\\s*อาทิตย์|วันหยุด|สุดสัปดาห์)|ทุก\\s*วัน|ทุก\\s*เช้า|ทุก\\s*เย็น|ทุก\\s*คืน`)
const TASK_RE = /ตั้งเวลา(?:ให้)?|ตั้งงาน/
const WORK_RE = /เช็ค|เช็ก|ค้นหา|ค้น|หาข้อมูล|หา(?:ให้|ดู)|สรุป|ตรวจ|google|กูเกิ้?ล|browser|เบราว์เซอร์|เว็บ|ราคา|ตั๋ว|จอง|ไปดู|ดูให้|เปิด|รายงาน|อ่าน|เทียบ/i

const TITLE_MAX = 60
const PROMPT_MAX = 300

/**
 * Time-related phrases (wake word already removed). null = not about time.
 * A phrase with no clear time also gives null, so the Brain can interpret it (schedule intent).
 */
export function fromSpeech(text: string, now: number): SpeechResult | null {
  const t = digits(text.trim())
  if (/(?:ยกเลิก|ลบ|ปิด|เลิก)\s*(?:นาฬิกา)?(?:ปลุก|การเตือน|เตือน|งานตั้งเวลา|ตั้งเวลา)/.test(t)) {
    return { action: 'clear', kind: /ตั้งเวลา|งาน/.test(t) ? 'task' : /ทั้งหมด/.test(t) ? null : 'alarm' }
  }
  if (/(?:มี|ดู|เช็ค|เช็ก)\s*(?:นาฬิกา)?(?:ปลุก|การเตือน|เตือน|งานตั้งเวลา|ตั้งเวลา).*(?:อะไร|บ้าง|ไหม|มั้ย)|(?:ตั้ง)?(?:ปลุก|เตือน)ไว้(?:กี่โมง|อะไร|บ้าง)/.test(t)) return { action: 'list' }

  const alarm = ALARM_RE.test(t)
  const rep = t.match(REPEAT_RE)
  const task = TASK_RE.test(t)
  const every = t.match(/ทุก\s*(?:(\d{1,3})\s*)?(นาที|ชั่วโมง|ชม\.?)/) // every N minutes / hours (recurring)
  const rel = t.match(/(?:ใน)?อีก\s*(\d{1,3}|ครึ่ง)\s*(นาที|ชั่วโมง|ชม\.?)(?:\s*(ครึ่ง))?/) // in N minutes / hours (once)
  if (!alarm && !task && !(rep || every)) return null
  const clock = clockOf(t)
  if (!clock && !rel && !every) return null
  if (!alarm && !task && !(every && !rep && !clock) && !clock) return null

  const kind: JobKind = alarm ? 'alarm' : 'task'
  const job: NewJob = { kind, title: '', enabled: true }
  const spans: string[] = []
  if (every && !rel) {
    const n = Number(every[1] || 1)
    const hour = /ชั่วโมง|ชม/.test(every[2]!)
    if (!hour && (n < 1 || n > 59)) return { error: 'ทุกกี่นาทีได้ 1–59 นาที' }
    job.cron = hour ? `0 ${n > 1 ? '*/' + n : '*'} * * *` : `*/${n} * * * *`
    spans.push(every[0])
  } else if (rel) {
    const n = rel[1] === 'ครึ่ง' ? 0.5 : Number(rel[1])
    const hour = /ชั่วโมง|ชม/.test(rel[2]!)
    job.at = now + Math.round((n + (rel[3] ? 0.5 : 0)) * (hour ? 3_600_000 : 60_000))
    spans.push(rel[0])
  } else if (clock) {
    spans.push(clock.span)
    if (rep) {
      spans.push(rep[0])
      const r = rep[0]
      const day = r.match(new RegExp(DAY_RE))
      const dow = /ทำงาน|ธรรมดา|จันทร์\s*(?:ถึง|-)\s*ศุกร์/.test(r) ? '1-5' : /เสาร์\s*อาทิตย์|วันหยุด|สุดสัปดาห์/.test(r) ? '0,6' : day ? String(DAYS[day[0]]) : '*'
      job.cron = `${clock.m} ${clock.h} * * ${dow}`
    } else {
      const d = new Date(now)
      d.setHours(clock.h, clock.m, 0, 0)
      const plus = /มะรืน/.test(t) ? 2 : /พรุ่งนี้/.test(t) ? 1 : 0
      const weekday = t.match(new RegExp(`วัน\\s*(${DAY_RE})`))
      if (plus) d.setDate(d.getDate() + plus)
      else if (weekday) {
        let k = (DAYS[weekday[1]!]! - d.getDay() + 7) % 7
        if (k === 0 && d.getTime() <= now) k = 7
        d.setDate(d.getDate() + k)
        spans.push(weekday[0])
      } else if (d.getTime() <= now) d.setDate(d.getDate() + 1) // already past = tomorrow
      job.at = d.getTime()
    }
  } else {
    return null
  }

  // the title / what to do = what is left once the time words are cut out
  let rest = t
  for (const span of spans) rest = rest.replace(span, ' ')
  rest = rest
    .replace(ALARM_RE, ' ').replace(TASK_RE, ' ') // before the loose words below: "ตั้งเวลา" must go whole, not as "ตั้ง" + "เวลา"
    .replace(/(?:ช่วย|ขอ|ฝาก|รบกวน)(?=\s*(?:ปลุก|เตือน|ตั้ง|$))|พรุ่งนี้|มะรืน(?:นี้)?|วันนี้|คืนนี้|เช้านี้|ตอน|เวลา|ด้วย(?:นะ|ครับ|ค่ะ|คะ)?|หน่อย|นะ(?:ครับ|คะ|ค่ะ)?|ครับ|ค่ะ|คะ|จ้า|จ๊ะ/g, ' ')
    .replace(/^\s*(?:ให้|ว่า|ไป|มา)\s*/, '').replace(/\s+/g, ' ').trim()
    .replace(/^(?:ให้|ว่า)\s*/, '').trim()
  if (job.kind === 'alarm' && WORK_RE.test(rest) && rest.length > 6) job.kind = 'task' // "เตือน 9 โมง ไปเช็คตั๋วใน google" = go and do it
  if (job.kind === 'alarm') {
    job.title = rest.length >= 2 ? rest.slice(0, TITLE_MAX) : /เตือน/.test(t) ? 'เตือน' : 'ปลุก'
  } else {
    if (rest.length < 3) return { error: 'ตั้งเวลาแล้วให้ทำอะไร? เช่น "ทุกเช้า 7 โมง สรุปข่าววันนี้"' }
    job.title = rest.slice(0, TITLE_MAX)
    job.prompt = rest.slice(0, PROMPT_MAX)
  }
  return { action: 'add', job }
}
