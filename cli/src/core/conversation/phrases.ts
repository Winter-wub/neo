// Words Conversation itself understands (ported from app/voice.js). Thai: tone marks and spaces are ignored in names.

export const DEFAULT_WAKE = ['นีโอ', 'นิโอ', 'พี่โอ', 'เนโอ', 'นีโย', 'neo', 'nio', 'nee o']
export const DEFAULT_PET_NAME = 'นีโอ'

const TONES = /[่-์]/g
const ESCAPE = /[.*+?^${}()|[\]\\]/g

/** Matches the pet's name as the speech recogniser may write it. Latin names match whole words only. */
export function makeWake(variants: readonly string[]) {
  const parts = [...new Set(variants.map(v => String(v).toLowerCase().replace(TONES, '').replace(/\s+/g, '')).filter(v => v.length >= 2))]
    .sort((a, b) => b.length - a.length)
    .map(v =>
      /^[a-z0-9]+$/.test(v)
        ? '\\b' + v.split('').join('\\s?') + '\\b'
        : [...v].map(c => c.replace(ESCAPE, '\\$&') + '[\\u0E48-\\u0E4C]?').join('\\s?'))
  return new RegExp('(?:' + parts.join('|') + ')(?!เค|เวอร์|ลีฟ)', 'i') // "…โอเค" is not the name
}

/** null = the name was not said, '' = only the name, otherwise what was said after it. */
export function afterWake(text: string, wake: RegExp) {
  const m = text.match(wake)
  return m ? text.slice(m.index! + m[0].length).replace(/^[\s,.ฯ]+/, '').trim() : null
}

/** Said to a pending confirmation: go ahead. */
export const CONFIRM = /ตกลง|โอเค|\bok(?:ay)?\b|ยืนยัน|ทำเลย|เอาเลย|จัดไป|ใช่|ตั้งเลย|ได้เลย|ถูกต้อง/i
/** While working or waiting for a confirmation: stop. */
export const CANCEL = /ยกเลิก|ไม่ใช่|ไม่ตั้ง|ไม่เอา|หยุด|พอแล้ว|พอก่อน|ไม่เอาแล้ว|ไม่ต้องหา|เลิกหา|ไม่ต้องแล้ว|\bcancel\b|\bstop\b|^ไม่(?:ครับ|ค่ะ|คะ|นะ)?[\s.!]*$/i
/** "start over" phrases: a new Brain session and forgotten notes. */
export const RESET = /^(?:เริ่ม(?:คุย)?ใหม่|เริ่มบทสนทนาใหม่|ลืม(?:ที่คุย|ทั้งหมด)?)/

const WEATHER = /[อย]ากา|กาศ|สภาพ\s?[กอ]|ฝน|ร้อน|หนาว|อุณหภูมิ|weather|temperature/i
/** "air-conditioned" things are not weather questions. */
export const isWeather = (text: string) => WEATHER.test(text.replace(/(?:เครื่อง)?ปรับอากาศ|แอร์/g, ''))

const QUESTION = /ล่ะ|หละ|อะไร|ไร\s?บ้าง|ที่ไหน|ไหนบ้าง|ยังไง|อย่างไร|เท่าไ[รห]|กี่|ไหม|มั้ย|มั๊ย|ใคร|เมื่อไ[รห]|ทำไม|บ้าง|หรือเปล่า|รึเปล่า|ช่วย\s?(?:หา|ดู|บอก|เช็ก|เช็ค)|ขอ\s?(?:ดู|ข้อมูล)|บอก\s?(?:หน่อย|ที)|\?/
const MIN_QUESTION_CHARS = 6
export const countLetters = (text: string) => (text.match(/[฀-๿A-Za-z0-9]/g) || []).length
/** A sentence that is clearly a question may be asked without saying the name. */
export const isQuestion = (text: string) => QUESTION.test(text) && countLetters(text) >= MIN_QUESTION_CHARS
