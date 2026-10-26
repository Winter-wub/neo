import type { Face, WakeInfo } from '../../protocol'
import { textCard } from '../cards/cards'
import { CANCEL, DEFAULT_PET_NAME, DEFAULT_WAKE } from '../conversation/phrases'
import type { Events } from '../events/events'
import { SettingsError } from '../settings/settings'

const DEFAULT_FACE = { fg: '#7fffd4', accent: '#ff7aa8', cheek: '#ff9a9a', bg: '#000000' } as const satisfies Face
const FACE_KEYS = Object.keys(DEFAULT_FACE) as Array<keyof Face>
const COLOUR = /^#[0-9a-f]{6}$/i
const NAME_MAX = 30
const VARIANTS_MAX = 20
/** How many transcripts of the name are collected. */
export const TRAINING_SAMPLES = 3
const TRAILING = /[\s,.!?ๆฯ]+$/g

export interface IdentityDeps {
  events: Events
  /** state.json, through Settings' raw store. */
  store: { read(key: string): unknown; write(key: string, value: unknown): Promise<void> }
}

/** The pet's name, the ways the recogniser writes it, and the face colours: what the phone shows and listens for. */
export function createIdentity({ events, store }: IdentityDeps) {
  let training: { name: string; got: string[]; introduce: boolean } | null = null

  const savedWake = (): { name: string; variants: string[] } => {
    const saved = store.read('wake') as { name?: unknown; variants?: unknown } | undefined
    if (typeof saved?.name === 'string' && Array.isArray(saved.variants)) return { name: saved.name, variants: saved.variants.map(String) }
    return { name: DEFAULT_PET_NAME, variants: [...DEFAULT_WAKE] }
  }

  const wake = (): WakeInfo => ({ ...savedWake(), training: training && { name: training.name, got: [...training.got] } })

  async function setWake(name: string, variants: readonly string[] = []) {
    const clean = String(name).trim().slice(0, NAME_MAX)
    if (!clean) throw new SettingsError('ต้องตั้งชื่อ')
    const next = { name: clean, variants: [...new Set([clean, ...variants].map(v => String(v).trim()).filter(Boolean))].slice(0, VARIANTS_MAX) }
    await store.write('wake', next)
    events.publish({ type: 'wake', ...next })
  }

  function face(): Face {
    const saved = (store.read('face') ?? {}) as Partial<Face>
    return { ...DEFAULT_FACE, ...Object.fromEntries(FACE_KEYS.filter(key => COLOUR.test(String(saved[key]))).map(key => [key, saved[key]])) }
  }

  return {
    wake,
    setWake,
    face,
    async setFace(patch: Partial<Face>) {
      const entries = Object.entries(patch)
      if (!entries.length) throw new SettingsError(`ต้องระบุสีอย่างน้อยหนึ่งสี: ${FACE_KEYS.join(', ')}`)
      for (const [key, value] of entries) {
        if (!(FACE_KEYS as string[]).includes(key)) throw new SettingsError(`ไม่มีส่วนของหน้า ${key} (มี ${FACE_KEYS.join(', ')})`)
        if (!COLOUR.test(String(value))) throw new SettingsError(`${key} ต้องเป็นสีแบบ #rrggbb`)
      }
      const next = { ...face(), ...patch }
      await store.write('face', next)
      events.publish({ type: 'face', ...next })
      return next
    },
    /** `neo name train`: the next three transcripts are the name as the recogniser writes it. */
    async train(name: string, { introduce = false } = {}) {
      const clean = String(name).trim().slice(0, NAME_MAX)
      if (!clean) throw new SettingsError('ต้องระบุชื่อที่จะฝึก')
      training = { name: clean, got: [], introduce }
      events.publish({ type: 'train', name: clean, n: 0 })
    },
    cancelTraining() {
      const was = training !== null
      training = null
      return was
    },
    /** A transcript while training is a sample, not a command. True when it was taken. */
    async hearing(text: string) {
      if (!training) return false
      const session = training
      if (CANCEL.test(text)) {
        training = null
        events.publish({ type: 'cancelled' })
        if (session.introduce) events.publish({ type: 'card', card: textCard({ title: 'ยกเลิกเปลี่ยนชื่อ', lines: [`ยังใช้ชื่อ ${savedWake().name} เหมือนเดิม`], emotion: 'neutral', sounds: ['greet'] }) })
        return true
      }
      session.got.push(text)
      events.publish({ type: 'train', name: session.name, n: session.got.length, text })
      if (session.got.length >= TRAINING_SAMPLES) {
        training = null
        await setWake(session.name, session.got.map(got => got.replace(TRAILING, '')))
        if (session.introduce) events.publish({ type: 'card', card: textCard({ title: `ฉันชื่อ ${session.name} นะ`, lines: ['จำชื่อใหม่ได้แล้ว', `เรียก “${session.name}” ได้เลย`], emotion: 'happy', sounds: ['happy'] }) })
      }
      return true
    },
  }
}

export type Identity = ReturnType<typeof createIdentity>
