// 5-field cron: minute hour day-of-month month day-of-week (0 = Sunday). Supports * , - /

export class CronError extends Error {}

export interface Cron {
  m: Set<number>
  h: Set<number>
  dom: Set<number>
  mon: Set<number>
  dow: Set<number>
  anyDom: boolean
  anyDow: boolean
}

function field(source: string, lo: number, hi: number) {
  const out = new Set<number>()
  for (const part of source.split(',')) {
    const m = part.match(/^(\*|\d+)(?:-(\d+))?(?:\/(\d+))?$/)
    if (!m) throw new CronError(`cron ไม่ถูกต้อง: ${part}`)
    const first = m[1] === '*' ? lo : Number(m[1])
    const last = m[2] !== undefined ? Number(m[2]) : m[1] === '*' || m[3] ? hi : first
    const step = m[3] ? Number(m[3]) : 1
    if (first < lo || last > hi || first > last || step < 1) throw new CronError(`cron เกินช่วง: ${part}`)
    for (let i = first; i <= last; i += step) out.add(hi === 7 && i === 7 ? 0 : i)
  }
  return out
}

export function parseCron(expr: string): Cron {
  const f = expr.trim().split(/\s+/)
  if (f.length !== 5) throw new CronError('cron ต้องมี 5 ช่อง: นาที ชั่วโมง วันที่ เดือน วันในสัปดาห์')
  const [m, h, dom, mon, dow] = f as [string, string, string, string, string]
  return { m: field(m, 0, 59), h: field(h, 0, 23), dom: field(dom, 1, 31), mon: field(mon, 1, 12), dow: field(dow, 0, 7), anyDom: dom === '*', anyDow: dow === '*' }
}

export function cronMatch(c: Cron, d: Date) {
  if (!c.m.has(d.getMinutes()) || !c.h.has(d.getHours()) || !c.mon.has(d.getMonth() + 1)) return false
  const dom = c.dom.has(d.getDate())
  const dow = c.dow.has(d.getDay())
  // standard cron: when both day fields are restricted, either one matches
  return c.anyDom || c.anyDow ? dom && dow : dom || dow
}

const SEARCH_DAYS = 400
const MINUTES_PER_DAY = 1440

/** The first matching minute strictly after `from` (ms), looking at most 400 days ahead. */
export function nextCron(expr: string, from: number): number | null {
  const c = parseCron(expr)
  const d = new Date(from)
  d.setSeconds(0, 0)
  d.setMinutes(d.getMinutes() + 1)
  for (let i = 0; i < SEARCH_DAYS * MINUTES_PER_DAY; i++, d.setMinutes(d.getMinutes() + 1)) {
    if (!c.h.has(d.getHours())) {
      d.setMinutes(59) // skip the whole hour
      continue
    }
    if (cronMatch(c, d)) return d.getTime()
  }
  return null
}
