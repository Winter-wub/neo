// Tool animations: one small pixel loop per exact tool name, drawn by the Brain in use the first time the tool is seen and kept in
// NEO_HOME/animations/<tool>.json until the user asks for another. Drawing is queued, one at a time, in the background:
// it never runs while Neo is answering the user and gives way (is put back first in the queue) when the user asks something.
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type { AnimationInfo, ToolAnimation } from '../../protocol'
import { SettingsError } from '../settings/settings'
import type { Brain } from '../brain/brain'
import { drawToolRequest } from '../brain/draw-prompt'
import { pixelArt, textCard } from '../cards/cards'
import type { Clock } from '../clock'
import type { Events } from '../events/events'
import { readText, writeAtomic } from '../memory/files'

/** A tool that is unknown, ambiguous or never seen; shown to the user as it is. */
export class AnimationError extends SettingsError {}

const MINUTE = 60_000
/** A failed drawing is tried once more, no sooner than this, the next time the tool is seen. */
export const RETRY_AFTER_MS = 10 * MINUTE
const SIZE = { minW: 24, maxW: 48, minH: 24, maxH: 32, colours: 12, minFrames: 2, maxFrames: 8, minFill: 0.04 } as const
const FPS = { min: 2, max: 8, fallback: 4 } as const
const FILE_SAFE = /^[A-Za-z0-9._-]+$/
const NO_ANIMATION_YET = 'ยังไม่เคยใช้เครื่องมือ'

/** The key an animation is kept under: the tool's exact name; `Skill:<skill>` for the Skill tool. */
export function toolKey(name: string, input: string) {
  if (name !== 'Skill') return name
  try {
    const skill = (JSON.parse(input) as { skill?: unknown }).skill
    return typeof skill === 'string' && skill ? `Skill:${skill}` : name
  } catch {
    return name
  }
}

/** A file name for any key: unchanged when it is already safe, else a safe form plus a hash so two keys never share a file. */
function fileOf(key: string) {
  if (FILE_SAFE.test(key) && !key.startsWith('.')) return `${key}.json`
  return `${key.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^\.+/, '_').slice(0, 80)}-${Bun.hash(key).toString(36)}.json`
}

const REDO_PHRASE = /(?:วาด|เปลี่ยน|ทำ)ท่า(?:ใหม่|นี้ใหม่|อื่น)?|วาดแอนิเมชั่?น(?:นี้)?ใหม่|เปลี่ยนแอนิเมชั่?น/

/** Checks a pixel card a Brain drew as an animation; null when it is not usable. */
function validate(raw: unknown): Pick<ToolAnimation, 'w' | 'h' | 'palette' | 'frames' | 'fps'> | null {
  if (!raw || typeof raw !== 'object') return null
  const card = raw as Record<string, unknown>
  const colours = card.palette && typeof card.palette === 'object' ? Object.keys(card.palette).length : 0
  if (colours > SIZE.colours) return null
  const art = pixelArt(card)
  if (!art) return null
  const { w, h, frames } = art
  if (w < SIZE.minW || w > SIZE.maxW || h < SIZE.minH || h > SIZE.maxH) return null
  if (frames.length < SIZE.minFrames || frames.length > SIZE.maxFrames) return null
  if (new Set(frames.map(frame => frame.join('\n'))).size < 2) return null // nothing moves
  const filled = (frame: string[]) => frame.join('').replace(/\./g, '').length / (w * h)
  if (frames.some(frame => filled(frame) < SIZE.minFill)) return null // a few dots are not a picture
  return { w, h, palette: art.palette, frames, fps: Math.max(FPS.min, Math.min(FPS.max, art.fps || FPS.fallback)) }
}

const isAnimation = (value: unknown): value is ToolAnimation => {
  const a = value as ToolAnimation
  return !!a && typeof a.tool === 'string' && Array.isArray(a.frames) && typeof a.w === 'number' && typeof a.h === 'number' && !!a.palette
}

const infoOf = ({ tool, label, w, h, frames, fps, createdBy, at }: ToolAnimation): AnimationInfo => ({ tool, label, w, h, frames: frames.length, fps, createdBy, at })

export interface AnimationsDeps {
  /** NEO_HOME */
  home: string
  clock: Clock
  events: Events
  /** The Brain in use now (looked up for every drawing: the provider can change). */
  brain: Brain
  /** "provider / model" of the Brain in use now, recorded in the file. */
  createdBy(): string
  /** Neo is answering the user (or running a job): do not draw meanwhile. */
  busy(): boolean
  log?(message: string): void
}

export function createAnimations(deps: AnimationsDeps) {
  const { clock, events } = deps
  const log = deps.log ?? ((message: string) => console.error(message))
  const dir = join(deps.home, 'animations')
  const store = new Map<string, ToolAnimation>()
  const seen = new Set<string>()
  const queue: string[] = []
  const failed = new Map<string, { count: number; retryAt: number }>()
  let last: string | null = null
  let flight: { key: string; abort: AbortController; done: Promise<void> } | null = null
  let waiters: Array<() => void> = []

  if (existsSync(dir)) {
    for (const name of readdirSync(dir).filter(n => n.endsWith('.json'))) {
      try {
        const value = JSON.parse(readText(join(dir, name)))
        if (isAnimation(value)) store.set(value.tool, value)
      } catch {
        log(`animations/${name}: อ่านไม่ได้ ข้ามไป`)
      }
    }
  }

  const blocked = () => deps.busy()

  const settleWaiters = () => {
    if (flight || queue.length && !blocked()) return
    for (const resolve of waiters.splice(0)) resolve()
  }

  /** The Brain draws `key`; the result is kept and announced. Never throws. */
  async function draw(key: string, signal: AbortSignal): Promise<'done' | 'interrupted' | 'failed'> {
    const createdBy = deps.createdBy()
    try {
      const reply = await deps.brain.ask({
        text: drawToolRequest(key), resume: null, bypass: false, side: true, signal, onTool: () => {},
        context: { petName: '', wakeVariants: [], memory: '', notes: [], now: new Date(clock.now()) },
      })
      if (signal.aborted) return 'interrupted'
      if (reply.answer.type !== 'card') throw new Error(reply.answer.type === 'error' ? reply.answer.error : 'ไม่ได้ภาพ')
      const picture = validate(reply.answer.card)
      if (!picture) throw new Error('ภาพที่วาดอ่านไม่ออก')
      const animation: ToolAnimation = { tool: key, label: key, ...picture, createdBy, at: clock.now() }
      mkdirSync(dir, { recursive: true })
      writeAtomic(join(dir, fileOf(key)), JSON.stringify(animation, null, 1) + '\n')
      store.set(key, animation)
      failed.delete(key)
      events.publish({ type: 'animation', tool: key, animation })
      return 'done'
    } catch (e) {
      if (signal.aborted) return 'interrupted'
      const count = (failed.get(key)?.count ?? 0) + 1
      failed.set(key, { count, retryAt: clock.now() + RETRY_AFTER_MS })
      log(`วาดแอนิเมชันของ ${key} ไม่สำเร็จ (ครั้งที่ ${count}): ${(e as Error)?.message ?? e}`)
      return 'failed'
    }
  }

  function pump() {
    if (flight || blocked()) return settleWaiters()
    const key = queue.shift()
    if (key === undefined) return settleWaiters()
    const abort = new AbortController()
    const done = draw(key, abort.signal).then(result => {
      flight = null
      if (result === 'interrupted') queue.unshift(key)
      if (result !== 'interrupted') queueMicrotask(pump)
      else settleWaiters()
    })
    flight = { key, abort, done }
  }

  function enqueue(key: string) {
    if (flight?.key === key || queue.includes(key)) return
    queue.push(key)
    queueMicrotask(pump)
  }

  /** Whole key, else the one stored (or seen) key that contains the text, ignoring case. */
  function resolve(ref: string, { includeSeen = false } = {}): string {
    const text = ref.trim()
    const keys = new Set([...store.keys(), ...(includeSeen ? seen : [])])
    if (keys.has(text)) return text
    const hits = [...keys].filter(k => k.toLowerCase().includes(text.toLowerCase()))
    if (!text || !hits.length) throw new AnimationError(`ไม่พบแอนิเมชันของ ${text || '(ว่าง)'} (ดู neo animation list)`)
    if (hits.length > 1) throw new AnimationError(`${text} ตรงหลายอัน: ${hits.join(', ')}`)
    return hits[0]!
  }

  return {
    /** A tool is being used: the key and the stored animation (null = none yet, one is queued). */
    onTool(name: string, input: string): { key: string; animation: ToolAnimation | null } {
      const key = toolKey(name, input)
      last = key
      seen.add(key)
      const animation = store.get(key) ?? null
      if (!animation) {
        const earlier = failed.get(key)
        if (!earlier || (earlier.count < 2 && clock.now() >= earlier.retryAt)) enqueue(key)
      }
      return { key, animation }
    },
    /** Neo started (true) or stopped (false) answering. A drawing in flight gives way to the user. */
    onBusy(thinking: boolean) {
      if (thinking) flight?.abort.abort()
      else queueMicrotask(pump)
    },
    list: (): AnimationInfo[] => [...store.values()].map(infoOf).sort((a, b) => a.at - b.at || a.tool.localeCompare(b.tool)),
    show: (ref: string): ToolAnimation => store.get(resolve(ref))!,
    /** Queue a new drawing; the old one stays until it is replaced. Returns the tool key at once. */
    async redo(ref: string): Promise<string> {
      const key = resolve(ref, { includeSeen: true })
      failed.delete(key)
      enqueue(key)
      return key
    },
    async rm(ref: string): Promise<AnimationInfo> {
      const key = resolve(ref)
      const info = infoOf(store.get(key)!)
      store.delete(key)
      rmSync(join(dir, fileOf(key)), { force: true })
      failed.delete(key)
      events.publish({ type: 'animation', tool: key, animation: null })
      return info
    },
    /** Fast phrase ("วาดท่าใหม่", "เปลี่ยนท่า"): redraws the animation of the tool used last. */
    understand(text: string) {
      if (!REDO_PHRASE.test(text) || text.length > 40) return null
      if (!last) return { card: textCard({ title: NO_ANIMATION_YET, lines: ['ยังไม่เคยใช้เครื่องมืออะไรเลย'], emotion: 'confused', sounds: ['confused'] }) }
      const key = last
      failed.delete(key)
      enqueue(key)
      return { card: textCard({ title: 'วาดท่าใหม่', lines: [`จะวาดท่าใหม่ให้ ${key}`, 'รอสักครู่นะ'], emotion: 'happy', sounds: ['happy'] }) }
    },
    /** Resolves when nothing is in flight and nothing can start now. For tests and shutdown. */
    settled(): Promise<void> {
      return new Promise(resolve => {
        waiters.push(resolve)
        queueMicrotask(pump)
      })
    },
    stop() {
      queue.length = 0
      flight?.abort.abort()
    },
  }
}

export type Animations = ReturnType<typeof createAnimations>
