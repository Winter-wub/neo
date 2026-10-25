import type { Card } from '../../protocol'

const LINE_MAX = 40
const LINES_MAX = 14
const TITLE_MAX = 30
const BIG_MAX = 14
const ITEM_TEXT_MAX = 40
const ITEM_VALUE_MAX = 20
const PIXEL_TITLE_MAX = 24

/** One line a person reads: markdown, long links, escapes and JSON brackets stripped. */
export function plain(value: unknown) {
  return String(value ?? '')
    .replace(/```[a-z]*|```/gi, ' ')
    .replace(/\[([^\]]+)\]\((?:https?:\/\/)?[^)]+\)/g, '$1')
    .replace(/https?:\/\/(?:www\.)?([^/\s]+)[^\s]*/g, '$1')
    .replace(/\\[nrt]/g, ' ').replace(/\\(["'\\/])/g, '$1').replace(/\\u([0-9a-f]{4})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/(^|\s)#{1,6}\s+/g, '$1').replace(/\*\*|__|`|~~/g, '').replace(/^\s*[-*•]\s+/, '')
    .replace(/[{}[\]]/g, ' ').replace(/"\s*:\s*/g, ': ').replace(/"/g, '').replace(/\s*,\s*(?=\S+:)/g, ' · ')
    .replace(/\s+/g, ' ').trim()
}

const looksJson = (s: string) => /^\s*[[{]/.test(s) || /"\s*:\s*["\d[{tfn]/.test(s)
/** Internal keys that mean nothing on a small screen. */
const SKIP_KEY = /^(id|uuid|_id|url|href|link|icon|type|kind|created_?at|updated_?at|timestamp|self|avatar|thumbnail|raw)$/i
const NAME_KEY = /^(name|title|summary|label|text|subject|headline)$/i
const label = (key: string) => key.replace(/[_-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').trim()
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null
const MAX_FLAT_DEPTH = 3

/** JSON → human lines: "name: value", nested objects flattened a level at a time. */
export function flatten(value: unknown, out: string[] = [], prefix = '', depth = 0): string[] {
  if (out.length >= LINES_MAX * 2 || depth > MAX_FLAT_DEPTH || value == null || value === '') return out
  if (Array.isArray(value)) {
    if (value.every(x => !isObject(x))) {
      if (value.length) out.push((prefix ? prefix + ': ' : '') + value.filter(x => x != null).join(', '))
      return out
    }
    for (const x of value.slice(0, LINES_MAX)) flatten(x, out, '', depth + 1)
    return out
  }
  if (isObject(value)) {
    const entries = Object.entries(value).filter(([k, x]) => !SKIP_KEY.test(k) && x != null && x !== '')
    const name = entries.find(([k]) => NAME_KEY.test(k))
    const simple = entries.filter(([, x]) => !isObject(x))
    if (name && entries.length <= 4 && simple.length === entries.length) {
      const rest = simple.filter(entry => entry !== name).map(([, x]) => x).join(' · ')
      out.push(String(name[1]) + (rest ? ' — ' + rest : ''))
      return out
    }
    for (const [key, x] of entries) {
      if (isObject(x)) {
        const listOfObjects = !Array.isArray(x) || x.some(isObject)
        if (listOfObjects) out.push(label(key) + ':')
        flatten(x, out, !listOfObjects ? label(key) : '', depth + 1)
      } else out.push(label(key) + ': ' + x)
    }
    return out
  }
  out.push((prefix ? prefix + ': ' : '') + String(value))
  return out
}

/** Break a long line at a space near `width`. */
export function wrap(text: string, width = LINE_MAX) {
  const out: string[] = []
  let rest = text
  while (rest.length > width) {
    let cut = rest.lastIndexOf(' ', width)
    if (cut < width / 2) cut = width
    out.push(rest.slice(0, cut).trim())
    rest = rest.slice(cut).trim()
  }
  if (rest) out.push(rest)
  return out
}

/** A raw line (maybe JSON) → lines a person can read. */
export function readable(line: unknown) {
  const s = String(line ?? '')
  if (looksJson(s)) {
    try {
      return flatten(JSON.parse(s)).map(plain).filter(Boolean)
    } catch { /* not JSON after all */ }
  }
  return [plain(s)].filter(Boolean)
}

/** Split text into short card lines at spaces, ending with … when cut. */
export function chunk(text: unknown, width = 30, max = 4) {
  const out: string[] = []
  let rest = String(text ?? '').trim()
  while (rest && out.length < max) {
    let cut = rest.length <= width ? rest.length : rest.lastIndexOf(' ', width)
    if (cut < width / 2) cut = Math.min(width, rest.length)
    out.push(rest.slice(0, cut).trim())
    rest = rest.slice(cut).trim()
  }
  if (rest && out.length) out[out.length - 1] += '…'
  return out
}

interface Picture { w: number; h: number; palette: Record<string, string>; frames: string[][]; fps: number }

const PIXEL = { minW: 4, maxW: 64, minH: 4, maxH: 48, colours: 16, frames: 12, fps: 12, defaultFps: 3 } as const

/** Validate an AI-drawn picture; null when there is nothing usable to show. */
export function pixelArt(card: Record<string, unknown>): Picture | null {
  const w = Math.round(Number(card.w))
  const h = Math.round(Number(card.h))
  if (!(w >= PIXEL.minW && w <= PIXEL.maxW && h >= PIXEL.minH && h <= PIXEL.maxH)) return null
  const palette: Record<string, string> = {}
  const raw = isObject(card.palette) ? card.palette : {}
  for (const [key, colour] of Object.entries(raw).slice(0, PIXEL.colours)) {
    if (key.length === 1 && key !== '.' && key !== ' ' && /^#[0-9a-f]{6}$/i.test(String(colour))) palette[key] = String(colour).toLowerCase()
  }
  if (!Object.keys(palette).length) return null
  let frames: unknown[] = Array.isArray(card.frames) ? card.frames : Array.isArray(card.pixels) ? [card.pixels] : []
  if (frames.length && typeof frames[0] === 'string') frames = [frames]
  const cleaned = frames
    .slice(0, PIXEL.frames)
    .filter(Array.isArray)
    .map(frame => {
      const rows = frame.slice(0, h).map(row => String(row).slice(0, w).padEnd(w, '.').replace(/[^\S]/g, '.'))
      while (rows.length < h) rows.push('.'.repeat(w))
      return rows.map(row => [...row].map(ch => (palette[ch] ? ch : '.')).join(''))
    })
    .filter(frame => frame.some(row => /[^.]/.test(row)))
  if (!cleaned.length) return null
  return { w, h, palette, frames: cleaned, fps: Math.max(1, Math.min(PIXEL.fps, Math.round(Number(card.fps)) || PIXEL.defaultFps)) }
}

const clampSeconds = (value: unknown, min: number, max: number, fallback: number) => Math.max(min, Math.min(max, Number(value) || fallback))

/** The card as the phone and Neo Console get it: human language, sized for the screen. */
export function humanize(card: Card): Card {
  const c: Record<string, any> = { ...card }
  if (c.layout === 'pixel') {
    const art = pixelArt(c)
    if (art) {
      return {
        kind: 'text', layout: 'pixel', icon: c.icon || 'text', title: plain(c.title).slice(0, PIXEL_TITLE_MAX), lines: [], items: [],
        emotion: c.emotion || 'proud', sounds: c.sounds || ['happy'], seconds: clampSeconds(c.seconds, 10, 90, 25), ...art,
      } as Card
    }
    c.layout = 'text'
    c.lines = ['วาดไม่สำเร็จ ลองใหม่อีกทีนะ']
    c.emotion = 'confused'
  }
  c.title = plain(c.title).slice(0, TITLE_MAX)
  if (c.big != null) c.big = plain(c.big).slice(0, BIG_MAX)
  const lines: string[] = []
  for (const raw of Array.isArray(c.lines) ? c.lines : c.lines ? [c.lines] : []) for (const row of readable(raw)) lines.push(...wrap(row))
  c.lines = lines.slice(0, LINES_MAX)
  if (lines.length > LINES_MAX) c.lines[LINES_MAX - 1] = c.lines[LINES_MAX - 1].replace(/.{0,2}$/, '…')
  if (Array.isArray(c.items)) {
    const items: Array<{ t: string; v: string }> = []
    for (const entry of c.items) {
      const isObj = isObject(entry)
      let t: unknown = isObj ? (entry.t ?? entry.text ?? '') : entry
      let v: unknown = isObj ? (entry.v ?? entry.value ?? '') : ''
      if (isObject(v)) v = flatten(v).join(' · ')
      const tt = plain(isObject(t) ? flatten(t).join(' · ') : t)
      const vv = plain(v)
      if (tt || vv) items.push({ t: tt.slice(0, ITEM_TEXT_MAX), v: vv.slice(0, ITEM_VALUE_MAX) })
    }
    c.items = items.slice(0, LINES_MAX)
  }
  if (c.layout === 'list' && !c.items?.length) c.layout = 'text'
  if (!c.lines.length && !c.items?.length && !c.big) c.lines = ['(ไม่มีรายละเอียด)']
  return c as Card
}

/** A plain text card with the defaults every canned message needs. */
export function textCard(parts: Partial<Card> & { title: string; lines: string[] }): Card {
  return { kind: 'text', layout: 'text', icon: 'text', emotion: 'happy', sounds: ['happy'], seconds: 10, items: [], ...parts }
}

export interface ConfirmInfo {
  skill?: string
  plan?: string
  task?: string
  title?: string
  lines?: string[]
  icon?: string
  verb?: string
}

/** The card that asks "say ตกลง to go ahead". */
export const confirmCard = (d: ConfirmInfo): Card => ({
  kind: 'text', layout: 'text', icon: d.icon || 'task',
  title: d.title || 'ใช้ ' + (d.skill || 'Claude Code') + '?',
  lines: [...(d.lines || chunk(d.plan || d.task)), 'พูด “ตกลง” เพื่อ' + (d.verb || 'ทำ') + ' หรือ “ยกเลิก”'],
  items: [], emotion: 'curious', sounds: ['curious'], seconds: 30,
})

/** Short text for the next prompt: what a card said. */
export const cardText = (c: Card) =>
  [c.big, c.title, ...(c.lines || []), ...(c.items || []).map(i => i.t + ' ' + i.v)].filter(Boolean).join(' / ').slice(0, 400)
