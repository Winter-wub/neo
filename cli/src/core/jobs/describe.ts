import { parseCron } from './cron'

const DOW_TH = ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.']
const MON_TH = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.']
const DAY_MS = 86_400_000

const pad = (n: number) => String(n).padStart(2, '0')
export const clockText = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`

/** When a job runs, the way a person says it: "07:30 ทุกวัน", "พรุ่งนี้ 07:30", "ทุก 15 นาที". */
export function describe(job: { at?: number; cron?: string }, now: number) {
  if (job.at !== undefined) {
    const d = new Date(job.at)
    const today = new Date(now)
    today.setHours(0, 0, 0, 0)
    const day = Math.round((new Date(job.at).setHours(0, 0, 0, 0) - today.getTime()) / DAY_MS)
    const label = day === 0 ? 'วันนี้ ' : day === 1 ? 'พรุ่งนี้ ' : `${DOW_TH[d.getDay()]} ${d.getDate()} ${MON_TH[d.getMonth()]} `
    return label + clockText(d)
  }
  const expr = job.cron ?? ''
  const f = expr.split(/\s+/)
  const [minute = '', hour = '', dom = '', mon = '', dow = ''] = f
  if (/^\*\/\d+$/.test(minute) && hour === '*') return `ทุก ${minute.slice(2)} นาที`
  if (minute === '0' && /^\*(\/\d+)?$/.test(hour)) return hour === '*' ? 'ทุกชั่วโมง' : `ทุก ${hour.slice(2)} ชั่วโมง`
  if (/^\d+$/.test(minute) && /^\d+$/.test(hour) && dom === '*' && mon === '*') {
    const time = `${pad(Number(hour))}:${pad(Number(minute))}`
    const named: Record<string, string> = { '*': 'ทุกวัน', '1-5': 'วันธรรมดา', '0,6': 'เสาร์-อาทิตย์', '6,0': 'เสาร์-อาทิตย์' }
    const days = named[dow] ?? 'ทุก ' + [...parseCron(`0 0 * * ${dow}`).dow].map(i => DOW_TH[i]).join(' ')
    return `${time} ${days}`
  }
  return `cron ${expr}`
}
