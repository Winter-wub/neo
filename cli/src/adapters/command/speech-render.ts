import type { DoctorRow, NeoEvent, PhoneAudioResult } from '../../protocol'

type SpeechEvent = Extract<NeoEvent, { type: 'rec' | 'short' | 'loud' | 'stt' | 'nothing' | 'stterr' | 'listen_end' }>
const SPEECH = new Set(['rec', 'short', 'loud', 'stt', 'nothing', 'stterr', 'listen_end'])
export const isSpeechEvent = (event: NeoEvent): event is SpeechEvent => SPEECH.has(event.type)

/** One line per speech event for `neo events`. */
export function speechEventLine(event: SpeechEvent, time: string) {
  const row = (type: string, text: string) => `${time}  ${type.padEnd(9)} ${text}`.trimEnd()
  switch (event.type) {
    case 'rec': return row('rec', 'ได้ยินเสียงพูด')
    case 'short': return row('short', 'เสียงสั้นเกินไป')
    case 'loud': return row('loud', 'เสียงดังมาก')
    case 'stt': return row('stt', 'กำลังถอดเสียง')
    case 'nothing': return row('nothing', 'ไม่ได้ยินเป็นคำพูด')
    case 'stterr': return row('stterr', event.error)
    case 'listen_end': return row('listen_end', 'เลิกรอคำสั่ง')
  }
}

export const NOTHING_HEARD = 'ไม่ได้ยินเป็นคำพูดในไฟล์นี้'

/** The failure text for an outcome that is not a card, or null if it worked. */
export function audioFailure(result: PhoneAudioResult): string | null {
  const { outcome } = result
  switch (outcome.outcome) {
    case 'nothing': return NOTHING_HEARD
    case 'stterr': return `ถอดเสียงไม่สำเร็จ: ${outcome.error}`
    case 'error': return `Neo ตอบไม่ได้: ${outcome.error}`
    case 'cancelled': return 'ยกเลิกแล้ว'
    default: return null
  }
}

export function doctorMarkdown(rows: DoctorRow[]) {
  return [
    '# neo doctor',
    '',
    ...rows.map(row => {
      const found = Object.entries(row.found ?? {}).map(([tool, path]) => `\n  - ${tool}: ${path ?? 'ไม่พบ'}`).join('')
      return `- ${row.ok ? '✅' : row.optional ? '➖' : '⚠️'} **${row.label}** — ${row.detail}${found}${row.ok || !row.fix ? '' : `\n  - แก้: ${row.fix}`}`
    }),
  ].join('\n')
}
