import type { Card } from '../../protocol'
import type { Answer, DreamResult } from './brain'
import { chunk, textCard } from '../cards/cards'

const LINES_MAX = 14
const SECONDS = { min: 15, max: 90, base: 15, perLine: 4 } as const

type Json = Record<string, any>

/** The model's answer is one JSON line; take the first `{…}` span (contract.md §6.1). */
export function parseAnswer(output: string): Answer {
  const span = output.match(/\{[\s\S]*\}/)
  let json: Json
  try {
    json = JSON.parse(span?.[0] ?? '')
  } catch {
    return { type: 'error', error: 'bad json' }
  }
  switch (json.intent) {
    case undefined: return { type: 'card', card: toCard(json) }
    case 'skill': return { type: 'skill', skill: String(json.skill || ''), plan: String(json.plan || ''), task: String(json.task || '') }
    case 'weather': return { type: 'weather', place: String(json.place || ''), day: Number(json.day) || 0 }
    case 'schedule': {
      const answer: Answer = { type: 'schedule', kind: String(json.kind || ''), title: String(json.title || ''), prompt: String(json.prompt || '') }
      if (json.at) answer.at = String(json.at)
      if (json.cron) answer.cron = String(json.cron)
      return answer
    }
    default: return { type: 'error', error: 'bad json' }
  }
}

function toCard(json: Json): Card {
  const lines = (Array.isArray(json.lines) ? json.lines : []).slice(0, LINES_MAX).map(String)
  const items = (Array.isArray(json.items) ? json.items : []).slice(0, LINES_MAX).map((x: Json) => ({ t: String(x.t ?? x.text ?? ''), v: String(x.v ?? x.value ?? '') }))
  if (json.layout === 'pixel') return { kind: 'text', ...json, lines, items } as Card // humanize validates the picture
  const seconds = Math.max(SECONDS.min, Math.min(SECONDS.max, parseInt(json.seconds, 10) || SECONDS.base + SECONDS.perLine * Math.max(lines.length, items.length)))
  return { kind: 'text', ...json, layout: ['list', 'big'].includes(json.layout) ? json.layout : 'text', lines, items, seconds } as Card
}

const PLAIN_LINE = 30
const PLAIN_LINES = 10
const PLAIN_SECONDS = 30

/** For providers that may answer in plain words: JSON is read as usual, anything else still becomes a text card. */
export function parseLoose(output: string, petName: string): Answer {
  const parsed = parseAnswer(output)
  if (parsed.type !== 'error') return parsed
  const text = output.replace(/\s+/g, ' ').trim()
  return {
    type: 'card',
    card: text
      ? textCard({ title: petName, lines: chunk(text, PLAIN_LINE, PLAIN_LINES), seconds: PLAIN_SECONDS })
      : textCard({ title: petName, lines: ['ไม่มีคำตอบ'], emotion: 'confused', sounds: ['confused'] }),
  }
}

const INSIGHTS_MAX = 5
const CARD_ROWS_MAX = 12

/** A dream's answer: one JSON object with the new memory, what it found, and the card for waking up. */
export function parseDreamResult(output: string): DreamResult {
  const span = output.match(/\{[\s\S]*\}/)
  let json: Json
  try {
    json = JSON.parse(span?.[0] ?? '')
  } catch {
    return { type: 'error', error: 'ฝันแล้วจำไม่ได้ (คำตอบไม่ใช่ JSON)' }
  }
  const card: Json = json.card && typeof json.card === 'object' ? json.card : {}
  return {
    type: 'dream',
    memory: typeof json.memory === 'string' ? json.memory : '',
    insights: (Array.isArray(json.insights) ? json.insights : []).slice(0, INSIGHTS_MAX).map((i: Json) => ({ q: String(i?.q ?? ''), finding: String(i?.finding ?? i ?? '') })),
    patterns: (Array.isArray(json.patterns) ? json.patterns : []).slice(0, INSIGHTS_MAX).map(String),
    dream: String(json.dream ?? ''),
    card: {
      title: String(card.title ?? ''),
      lines: (Array.isArray(card.lines) ? card.lines : []).slice(0, CARD_ROWS_MAX).map(String),
      items: (Array.isArray(card.items) ? card.items : []).slice(0, CARD_ROWS_MAX).map((x: Json) => ({ t: String(x?.t ?? ''), v: String(x?.v ?? '') })),
    },
  }
}
