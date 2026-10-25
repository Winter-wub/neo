import { expect, test } from 'bun:test'
import { nextCron, parseCron, CronError } from './cron'
import { describe } from './describe'
import { digits, fromSpeech, type SpeechResult } from './speech'

/** Wednesday 2026-10-28 10:00 local. */
const NOW = new Date(2026, 9, 28, 10, 0, 0).getTime()
const add = (text: string) => {
  const result = fromSpeech(text, NOW) as Extract<SpeechResult, { action: 'add' }>
  expect(result?.action).toBe('add')
  return result.job
}
const hm = (ms: number) => {
  const d = new Date(ms)
  return [d.getDate(), d.getHours(), d.getMinutes()]
}

test('"ปลุกพรุ่งนี้ตีห้าครึ่ง" is an alarm tomorrow at 05:30', () => {
  const job = add('ปลุกพรุ่งนี้ตีห้าครึ่ง'.replace('ห้า', ' 5'))
  expect(job).toMatchObject({ kind: 'alarm', title: 'ปลุก', enabled: true })
  expect(hm(job.at!)).toEqual([29, 5, 30])
})

test('number words become digits', () => {
  expect(digits('ปลุกตีห้าครึ่ง')).toBe('ปลุกตี5ครึ่ง')
  expect(add('ปลุกพรุ่งนี้ตีห้าครึ่ง')).toMatchObject({ kind: 'alarm' })
  expect(hm(add('ปลุกพรุ่งนี้ตีห้าครึ่ง').at!)).toEqual([29, 5, 30])
  expect(digits('สิบห้านาที')).toBe('15นาที')
  expect(digits('ยี่สิบเอ็ด')).toBe('21')
  expect(digits('๓๐')).toBe('30')
})

test('a time already past today means tomorrow; a time later today stays today', () => {
  expect(hm(add('ปลุก 9 โมงเช้า').at!)).toEqual([29, 9, 0])
  expect(hm(add('ปลุก 3 โมงเย็น').at!)).toEqual([28, 15, 0])
  expect(hm(add('ปลุกบ่ายสองครึ่ง').at!)).toEqual([28, 14, 30])
  expect(hm(add('ปลุก 2 ทุ่ม').at!)).toEqual([28, 20, 0])
  expect(hm(add('ปลุก 20:15').at!)).toEqual([28, 20, 15])
})

test('relative times: อีก N นาที / ชั่วโมง', () => {
  expect(add('ปลุกอีก 10 นาที').at).toBe(NOW + 10 * 60_000)
  expect(add('เตือนอีกครึ่งชั่วโมง').at).toBe(NOW + 30 * 60_000)
  expect(add('เตือนอีก 2 ชั่วโมง').at).toBe(NOW + 2 * 3_600_000)
})

test('repeating alarms become cron', () => {
  expect(add('ปลุกทุกวัน 7 โมงเช้า').cron).toBe('0 7 * * *')
  expect(add('ปลุกวันธรรมดา 6 โมงครึ่ง').cron).toBe('30 6 * * 1-5')
  expect(add('ปลุกทุกวันเสาร์ 8 โมง').cron).toBe('0 8 * * 6')
})

test('a task has a prompt; "every N minutes" is cron; a task with nothing to do is an error', () => {
  const job = add('ทุกเช้า 7 โมง ตั้งเวลาให้สรุปข่าววันนี้')
  expect(job).toMatchObject({ kind: 'task', cron: '0 7 * * *', prompt: 'สรุปข่าว' })
  expect(add('ตั้งเวลาทุก 30 นาที เช็คราคาทอง').cron).toBe('*/30 * * * *')
  expect(fromSpeech('ตั้งเวลา 7 โมง', NOW)).toMatchObject({ error: expect.stringContaining('ให้ทำอะไร') })
})

test('an alarm that asks for work ("เตือน 9 โมง ไปเช็คตั๋วใน google") becomes a task', () => {
  const job = add('เตือน 9 โมง ไปเช็คตั๋วใน google')
  expect(job.kind).toBe('task')
  expect(job.prompt).toContain('ตั๋ว')
})

test('list and clear phrases; unrelated sentences and sentences with no time are null', () => {
  expect(fromSpeech('มีปลุกอะไรบ้าง', NOW)).toEqual({ action: 'list' })
  expect(fromSpeech('ยกเลิกปลุกทั้งหมด', NOW)).toEqual({ action: 'clear', kind: null })
  expect(fromSpeech('ยกเลิกนาฬิกาปลุก', NOW)).toEqual({ action: 'clear', kind: 'alarm' })
  expect(fromSpeech('วันนี้อากาศเป็นยังไง', NOW)).toBeNull()
  expect(fromSpeech('ช่วยปลุกฉันหน่อย', NOW)).toBeNull() // no time: left for the Brain
})

test('cron: validation, steps, ranges, next run', () => {
  expect(() => parseCron('1 2 3')).toThrow(CronError)
  expect(() => parseCron('61 * * * *')).toThrow('เกินช่วง')
  expect(() => parseCron('a * * * *')).toThrow('ไม่ถูกต้อง')
  expect([...parseCron('*/20 * * * *').m]).toEqual([0, 20, 40])
  expect([...parseCron('0 9 * * 7').dow]).toEqual([0]) // 7 = Sunday
  // Wed 10:00 → next weekday 07:30 is Thu 29th
  expect(hm(nextCron('30 7 * * 1-5', NOW)!)).toEqual([29, 7, 30])
  expect(hm(nextCron('*/15 * * * *', NOW)!)).toEqual([28, 10, 15])
  expect(nextCron('0 0 31 2 *', NOW)).toBeNull() // no 31st of February
})

test('describe says it the way a person does', () => {
  expect(describe({ cron: '0 7 * * *' }, NOW)).toBe('07:00 ทุกวัน')
  expect(describe({ cron: '30 6 * * 1-5' }, NOW)).toBe('06:30 วันธรรมดา')
  expect(describe({ cron: '0 8 * * 6' }, NOW)).toBe('08:00 ทุก ส.')
  expect(describe({ cron: '*/15 * * * *' }, NOW)).toBe('ทุก 15 นาที')
  expect(describe({ cron: '0 */2 * * *' }, NOW)).toBe('ทุก 2 ชั่วโมง')
  expect(describe({ cron: '5 4 1 * *' }, NOW)).toBe('cron 5 4 1 * *')
  expect(describe({ at: new Date(2026, 9, 28, 15, 0).getTime() }, NOW)).toBe('วันนี้ 15:00')
  expect(describe({ at: new Date(2026, 9, 29, 5, 30).getTime() }, NOW)).toBe('พรุ่งนี้ 05:30')
  expect(describe({ at: new Date(2026, 10, 3, 5, 30).getTime() }, NOW)).toBe('อ. 3 พ.ย. 05:30')
})
