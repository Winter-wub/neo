import { FOODS, type Food, type Pet } from '../../protocol'
import type { Clock } from '../clock'
import type { Events } from '../events/events'

/** After this long in deep sleep Memory is asked to dream. */
export const DEEP_SLEEP_DREAM_MS = 15 * 60_000
export const DEEP_SLEEP_DREAM_REASON = 'สั่งให้นอนครบ 15 นาที'
const TIMER_TICK_MS = 1000
const STATE_KEY = 'pet'

// ---- fast phrases (ported from app/server.js) ----
const FOOD_WORDS: ReadonlyArray<readonly [RegExp, Food]> = [[/ปลา/, 'fish'], [/ขนม|คุกกี้|บิสกิต/, 'cookie'], [/นม/, 'milk']]
const FEED = /^(?:(?:มา)?(?:ให้|ป้อน|เอา)\s*(?:อาหาร|ข้าว|ปลา|ขนม|นม|คุกกี้|ของกิน)\s*(?:มา)?\s*(?:ให้)?\s*(?:กิน)?\s*(?:หน่อย|นะ|เลย|กัน|ซะ|แล้ว)?\s*$|(?:มา)?กิน\s*(?:ข้าว|ปลา|ขนม|นม|คุกกี้)\s*(?:กัน|ไหม|มั้ย|หน่อย|นะ|สิ|ซะ|เถอะ|เลย)?\s*$|ข้าวมาแล้ว|อาหารมาแล้ว)/
const HUNGRY_ASK = /^(?:หิว\s*(?:ไหม|มั้ย|ยัง|รึยัง|หรือยัง|หรือเปล่า|ป่ะ|อะป่าว)|อิ่ม\s*(?:ไหม|มั้ย|ยัง|รึยัง|หรือยัง)|ท้องว่างไหม)/
const SLEEP = /^(?:ไป|เข้า)?(?:นอน|หลับ)(?:หลับ|พัก)?\s*(?:ได้แล้ว|เถอะ|ซะ|เลย|ไป|ก่อน|กัน|นะ)*\s*$|^ฝันดี(?:นะ)?$|^(?:ไป)?พักผ่อน(?:ได้แล้ว|เถอะ|ซะ|ก่อน)?$|^ราตรีสวัสดิ์/
const TRAILING = /[\s,.!?ๆฯ]+$/g
const POLITE_END = /(?:นะ|ครับ|ค่ะ|คะ|จ้า)$/

const foodIn = (text: string): Food => FOOD_WORDS.find(([word]) => word.test(text))?.[1] ?? 'fish'
const clamp01 = (n: number) => Math.min(1, Math.max(0, n))

export interface PetDeps {
  clock: Clock
  events: Events
  /** The pet's last report is kept in state.json (Settings' raw store). */
  store: { read(key: string): unknown; write(key: string, value: unknown): Promise<void> }
  /** Memory's dream, once it exists. Called after 15 minutes of deep sleep. */
  dream?(reason: string): unknown
}

/** The pet: what the phone reports, feeding, and deep sleep. */
export function createPet({ clock, events, store, dream }: PetDeps) {
  const saved = store.read(STATE_KEY) as Partial<Pet> | undefined
  let current: Pet | null =
    saved && typeof saved.hunger === 'number' && typeof saved.affection === 'number' && typeof saved.at === 'number'
      ? { hunger: saved.hunger, affection: saved.affection, at: saved.at }
      : null
  let dreamAt: number | null = null
  let stopTimer: (() => void) | null = null
  let sleeping = false

  const clearTimer = () => {
    stopTimer?.()
    stopTimer = null
    dreamAt = null
  }

  function feed(food: Food = 'fish') {
    events.publish({ type: 'feed', food: (FOODS as readonly string[]).includes(food) ? food : 'fish' })
  }

  function sleep() {
    clearTimer()
    sleeping = true
    events.publish({ type: 'sleep' })
    dreamAt = clock.now() + DEEP_SLEEP_DREAM_MS
    stopTimer = clock.every(TIMER_TICK_MS, () => {
      if (dreamAt === null || clock.now() < dreamAt) return
      clearTimer()
      void Promise.resolve(dream?.(DEEP_SLEEP_DREAM_REASON)).catch(e => console.error('dream failed:', e))
    })
  }

  return {
    current: () => (current ? { ...current } : null),
    sleeping: () => sleeping,
    feed,
    ask: () => events.publish({ type: 'pet_ask' }),
    sleep,
    /** The phone is awake again. True when a pending dream was cancelled by it. */
    wake() {
      const cancelled = dreamAt !== null
      clearTimer()
      sleeping = false
      events.publish({ type: 'wakeup', dreamCancelled: cancelled })
      return cancelled
    },
    /** What NeoApp reports about itself (at most once a minute and after eating). */
    async report(hunger: number, affection: number) {
      if (typeof hunger !== 'number' || typeof affection !== 'number' || !Number.isFinite(hunger) || !Number.isFinite(affection)) return
      current = { hunger: clamp01(hunger), affection: clamp01(affection), at: clock.now() }
      await store.write(STATE_KEY, current)
      events.publish({ type: 'pet', hunger: current.hunger, affection: current.affection })
    },
    /** Fast phrase (the name already removed): the action to run, or null when it is not about the pet. */
    understand(text: string): (() => void) | null {
      const said = text.replace(TRAILING, '').replace(POLITE_END, '').trim()
      if (SLEEP.test(said)) return sleep
      if (FEED.test(said)) return () => feed(foodIn(said))
      if (HUNGRY_ASK.test(said)) return () => events.publish({ type: 'pet_ask' })
      return null
    },
    stop: clearTimer,
  }
}

export type PetModule = ReturnType<typeof createPet>
