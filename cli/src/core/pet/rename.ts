import { confirmCard, textCard } from '../cards/cards'
import type { FastAnswer } from '../conversation/conversation'
import { TRAINING_SAMPLES, type Identity } from './identity'

const NAME_MAX = 24
const QUOTES = /["'“”‘’「」]/g
const POLITE = /(?:นะ|ครับ|ค่ะ|คะ|จ้า|จ้ะ|เถอะ|สิ|ซะ|หน่อย|แล้วกัน|ก็ได้|เลย)+$/
const PUNCT = /[\s,.!?ๆฯ]+$/g
/** "เปลี่ยนชื่อเป็นมิว", "ตั้งชื่อใหม่ว่ามิว": the rename verb, then เป็น/ว่า and the name. */
const VERB_NAME = /^(?:(?:เปลี่ยน|ตั้ง)ชื่อ(?:ใหม่)?(?:ให้)?(?:ฉัน|เรา|ผม)?|(?:ต่อไปนี้|จากนี้(?:ไป)?|ตั้งแต่นี้ไป)(?:ให้)?(?:ชื่อ|เรียก))\s*(?:เป็น|ว่า)?\s*(.+)$/
/** "เปลี่ยนชื่อหน่อย": the verb with nothing but politeness after it. */
const VERB_ONLY = /^(?:เปลี่ยน|ตั้ง)ชื่อ(?:ใหม่)?(?:ให้)?(?:หน่อย|ที|ได้(?:ไหม|มั้ย)|นะ|ครับ|ค่ะ|คะ|เถอะ|สิ|ซะ|เลย|ดี(?:กว่า|ไหม)?|หน่อยนะ|\s)*$/
const NOT_A_NAME = /^(?:ไฟล์|ของ|ฉัน|เรา|ผม|คุณ|เธอ|ให้|หน่อย)/

/** What was said as a name: no quotes, politeness, or leading "ชื่อ / ว่า / เป็น". Null when nothing usable is left. */
function cleanName(raw: string) {
  const name = raw.replace(QUOTES, '').replace(PUNCT, '').replace(POLITE, '').replace(PUNCT, '').replace(/^(?:ชื่อ|ว่า|เป็น)\s*/, '').trim()
  return name.length >= 1 && name.length <= NAME_MAX && name.split(/\s+/).length <= 3 ? name : null
}

/** Renaming the pet by voice (a fast phrase, handled before the Brain): confirm, then the same training as `neo name train`. */
export function createRename({ identity }: { identity: Pick<Identity, 'train'> }) {
  const confirmName = (name: string): FastAnswer => ({
    card: confirmCard({ icon: 'user', verb: 'เปลี่ยน', plan: `เปลี่ยนชื่อเป็น “${name}”`, title: `เปลี่ยนชื่อเป็น “${name}” ใช่ไหม`, lines: [`ได้ยินว่า “${name}”`, 'ถ้าไม่ใช่ พูด “ไม่”'] }),
    confirm: async () => {
      await identity.train(name, { introduce: true })
      return textCard({
        icon: 'mic', title: `พูดว่า “${name}” ${TRAINING_SAMPLES} ครั้ง`,
        lines: [`ฉันจะจำชื่อใหม่จากเสียงของคุณ`, 'ระหว่างนี้ชื่อเดิมยังเรียกได้', 'พูด “ยกเลิก” เพื่อเลิก'], emotion: 'curious', sounds: ['greet'], seconds: 20,
      })
    },
  })

  return {
    /** The words after the pet's name. null = not a rename. */
    understand(said: string): FastAnswer | null {
      const text = said.trim().replace(PUNCT, '')
      if (VERB_ONLY.test(text)) {
        return {
          card: textCard({ icon: 'user', title: 'อยากให้ชื่ออะไร', lines: ['พูดชื่อใหม่ได้เลย'], emotion: 'curious', sounds: ['greet'] }),
          reply: answer => {
            const name = cleanName(answer)
            return name ? confirmName(name) : null
          },
        }
      }
      const raw = VERB_NAME.exec(text)?.[1]
      if (!raw || NOT_A_NAME.test(raw)) return null
      const name = cleanName(raw)
      return name ? confirmName(name) : null
    },
  }
}

export type Rename = ReturnType<typeof createRename>
