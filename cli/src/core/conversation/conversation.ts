import type { Card, SayResult, ToolAnimation } from '../../protocol'
import type { Answer, Brain, PermissionRequest } from '../brain/brain'
import { cardText, confirmCard, humanize, textCard } from '../cards/cards'
import type { Clock } from '../clock'
import type { Events } from '../events/events'
import { CANCEL, CONFIRM, DEFAULT_PET_NAME, DEFAULT_WAKE, RESET, afterWake, countLetters, isQuestion, isWeather, makeWake } from './phrases'

const MINUTE = 60_000
/** A session is dropped after this much silence, or this many turns, or a reset phrase. */
export const SESSION_IDLE_MS = 15 * MINUTE
export const SESSION_MAX_TURNS = 20
export const CONFIRM_MS = 30_000
/** After the name alone (or a tap) the next sentence is the question. */
export const ARM_MS = 15_000
/** After an answer the user can keep talking without the name. */
export const FOLLOW_MS = 45_000
const NOTES_MAX = 6
const FOLLOW_MIN_CHARS = 4
const RESET_SECONDS = 8

export type Outcome = Exclude<SayResult, { outcome: 'accepted' }>

export interface ConversationDeps {
  events: Events
  clock: Clock
  brain: Brain
  settings(): { requireName: boolean; followUp: boolean; bypass: boolean }
  /** The pet's name and the ways the recogniser may write it. */
  pet?(): { name: string; variants: readonly string[] }
  memory?(): string
  /** One finished turn (answered, failed or cancelled), for the journal. */
  onTurn?(turn: { q: string; a: string; ok: boolean }): void
  /** Asked for when the next sentence is a command: the name alone, or a tap. Ears then waits 3 s of quiet instead of 0.9 s. */
  listen?(): void
  /** Tells the status owner when the Brain starts and stops being busy. */
  onBusy?(thinking: boolean): void
  /** Answers for intents the Brain returns; the owning modules plug in here. */
  intents?: {
    weather?(intent: { place: string; day: number }, text: string): Promise<Card>
    schedule?(intent: Extract<Answer, { type: 'schedule' }>): Promise<Card | FastAnswer>
  }
  /** Words said while an alarm rings (Jobs). A card when they were a stop or snooze; checked before everything else. */
  ringing?(text: string): Promise<Card | null>
  /** Pet commands (Pet.understand): only after the name or a tap; the action it returns runs at once, no card. */
  petPhrase?(text: string): (() => void) | null
  /** Fast phrases (Jobs, ...): asked in order once the name is removed, before the Brain. */
  fast?: Array<(text: string) => FastAnswer | null>
  /** Weather (Weather.understand): asked after the `fast` phrases and before the provider switch; the forecast comes from `intents.weather`. */
  understandWeather?(text: string): { place: string; day: number } | null
  /** A tool is being used (Animations): its key and the stored animation, or null while none is drawn yet. Goes into the `tool` event. */
  toolAnimation?(name: string, input: string): { key: string; animation: ToolAnimation | null }
  /** Spoken provider / model switches ("สลับไปใช้ X", "ใช้โมเดล X"). A card when it was one, after all `fast` phrases and before the Brain. */
  switchBrain?(text: string): Promise<Card | null>
}

/** What a fast phrase answers: a card, optionally waiting for the user to say ตกลง. */
export interface FastAnswer {
  card: Card
  /** Said "ตกลง": do it and return the card to show. */
  confirm?: () => Promise<Card>
  /** Asks a question instead: the next utterance (no name needed, within the follow-up window) goes here. null = it was not an answer. */
  reply?: (text: string) => FastAnswer | null
}

type Step = { card: Card; confirm?: Extract<Answer, { type: 'skill' }>; action?: { label: string; run: () => Promise<Card> }; reply?: { label: string; answer: (text: string) => FastAnswer | null } } | { error: string }

export function createConversation(deps: ConversationDeps) {
  const { events, clock, brain } = deps
  const pet = deps.pet ?? (() => ({ name: DEFAULT_PET_NAME, variants: DEFAULT_WAKE }))

  const session = { id: null as string | null, last: 0, turns: 0, notes: [] as string[] }
  let thinking = false
  let token = 0
  let current: { text: string; abort: AbortController; resolve(outcome: Outcome): void } | null = null
  let pending: (Extract<Answer, { type: 'skill' }> & { until: number }) | null = null
  /** An ACP agent waiting for ตกลง to run a tool; the Brain's ask is blocked on it. */
  let permission: { title: string; resolve(allowed: boolean): void; stop(): void } | null = null
  /** A fast phrase waiting for ตกลง (set a job, ...). */
  let pendingAction: { label: string; run: () => Promise<Card>; until: number } | null = null
  /** A fast phrase waiting for the answer to its question ("อยากให้ชื่ออะไร"). */
  let pendingReply: { label: string; answer: (text: string) => FastAnswer | null; until: number } | null = null
  let armedUntil = 0
  let followUntil = 0
  let wakeKey = ''
  let wake = makeWake([])

  const note = (question: string, card: Card) => {
    session.notes.push(`ผู้ใช้: "${question}" → ${pet().name} แสดง: ${cardText(card)}`)
    if (session.notes.length > NOTES_MAX) session.notes.shift()
  }

  function wakeFor(variants: readonly string[]) {
    const key = variants.join('\n')
    if (key !== wakeKey) {
      wakeKey = key
      wake = makeWake(variants)
    }
    return wake
  }

  function setThinking(on: boolean) {
    thinking = on
    deps.onBusy?.(on)
  }

  /** Ends the wait for ตกลง on a tool. `timedOut` tells the user it was not allowed. */
  function settlePermission(allowed: boolean, timedOut = false) {
    const waiting = permission
    if (!waiting) return
    permission = null
    waiting.stop()
    waiting.resolve(allowed)
    if (timedOut) events.publish({ type: 'thinking', text: `${waiting.title} (ไม่ได้รับอนุญาต)` })
  }

  /** An agent wants to run something that is not read-only: show the question and wait up to 30 s for ตกลง / ยกเลิก. */
  function askPermission(info: PermissionRequest): Promise<boolean> {
    settlePermission(false) // a newer question replaces the older one
    return new Promise<boolean>(resolve => {
      const until = clock.now() + CONFIRM_MS
      const stop = clock.every(1000, () => {
        if (clock.now() >= until) settlePermission(false, true)
      })
      permission = { title: info.title, resolve, stop }
      events.publish({ type: 'card', card: humanize(confirmCard({ skill: info.agent, plan: info.title })) })
    })
  }

  /** Run one piece of work as "thinking": events in, one outcome out. */
  function track(text: string, work: (signal: AbortSignal) => Promise<Step>): Promise<Outcome> {
    const mine = ++token
    const abort = new AbortController()
    setThinking(true)
    events.publish({ type: 'thinking', text })
    return new Promise<Outcome>(resolve => {
      current = { text, abort, resolve }
      const finish = (step: Step) => {
        if (mine !== token) return // cancelled meanwhile
        current = null
        settlePermission(false)
        setThinking(false)
        if ('error' in step) {
          events.publish({ type: 'askerr', error: step.error })
          deps.onTurn?.({ q: text, a: step.error, ok: false })
          return resolve({ outcome: 'error', error: step.error })
        }
        const card = humanize(step.card)
        if (step.confirm) pending = { ...step.confirm, until: clock.now() + CONFIRM_MS }
        else if (step.action) pendingAction = { ...step.action, until: clock.now() + CONFIRM_MS }
        else if (step.reply) pendingReply = { ...step.reply, until: clock.now() + FOLLOW_MS }
        else followUntil = clock.now() + FOLLOW_MS
        events.publish({ type: 'card', card })
        deps.onTurn?.({ q: text, a: cardText(card), ok: true })
        resolve({ outcome: 'card', card })
      }
      work(abort.signal).then(finish, e => finish({ error: String((e as Error)?.message ?? e) }))
    })
  }

  const onTool = (name: string, input: string) => events.publish({ type: 'tool', name, input, ...deps.toolAnimation?.(name, input) })

  async function askBrain(text: string, signal: AbortSignal): Promise<Step> {
    const now = clock.now()
    const fresh = !session.id || now - session.last > SESSION_IDLE_MS || session.turns >= SESSION_MAX_TURNS
    const turn = fresh ? 1 : session.turns + 1
    events.publish({ type: 'session', fresh, turn, provider: brain.label })
    const { name, variants } = pet()
    const reply = await brain.ask({
      text, resume: fresh ? null : session.id, bypass: deps.settings().bypass, signal, onTool, confirm: askPermission,
      context: { petName: name, wakeVariants: [...variants], memory: deps.memory?.() ?? '', notes: [...session.notes], now: new Date(now) },
    })
    if (signal.aborted) return { error: 'interrupted' }
    const { answer } = reply
    if (answer.type === 'error') return { error: answer.error }
    Object.assign(session, { id: reply.session, last: clock.now(), turns: turn, notes: [] })
    switch (answer.type) {
      case 'card':
        return { card: answer.card }
      case 'skill':
        return { card: confirmCard(answer), confirm: answer }
      case 'weather': {
        const card = deps.intents?.weather ? await deps.intents.weather({ place: answer.place, day: answer.day }, text) : textCard({ icon: 'cloud', title: 'ดูอากาศไม่ได้', lines: ['ยังดูสภาพอากาศไม่ได้ตอนนี้'], emotion: 'sad', sounds: ['sad'] })
        note(text, card)
        return { card }
      }
      case 'schedule': {
        const result = deps.intents?.schedule ? await deps.intents.schedule(answer) : textCard({ icon: 'clock', title: 'ตั้งเวลาไม่ได้', lines: ['ยังตั้งเวลาให้ไม่ได้ตอนนี้'], emotion: 'confused', sounds: ['confused'] })
        const { card, confirm } = 'card' in result ? result : { card: result, confirm: undefined }
        return confirm ? { card, action: { label: text, run: confirm } } : { card }
      }
    }
  }

  async function runSkill(skill: Extract<Answer, { type: 'skill' }>, signal: AbortSignal): Promise<Step> {
    const reply = await brain.runSkill({ ...skill, petName: pet().name, signal, onTool })
    if (signal.aborted) return { error: 'interrupted' }
    if (reply.answer.type === 'error') return { error: reply.answer.error }
    if (reply.answer.type !== 'card') return { error: 'bad json' }
    note('(ยืนยันให้ใช้ ' + (skill.skill || 'Claude Code') + ') ' + skill.plan, reply.answer.card)
    return { card: reply.answer.card }
  }

  /** A fast phrase's answer as a turn: its card, waiting for ตกลง or for a reply when it asks one. */
  function trackFast(text: string, answer: FastAnswer) {
    return track(text, async () => {
      note(text, answer.card)
      if (answer.confirm) return { card: answer.card, action: { label: text, run: answer.confirm } }
      if (answer.reply) return { card: answer.card, reply: { label: text, answer: answer.reply } }
      return { card: answer.card }
    })
  }

  function ask(text: string, fastPhrases = true) {
    if (RESET.test(text)) {
      return track(text, async () => {
        Object.assign(session, { id: null, turns: 0, notes: [] })
        return { card: textCard({ title: 'เริ่มคุยใหม่แล้ว', lines: ['ลืมเรื่องที่คุยกันก่อนหน้านี้แล้ว'], sounds: ['greet'], seconds: RESET_SECONDS }) }
      })
    }
    for (const understand of fastPhrases ? deps.fast ?? [] : []) {
      const answer = understand(text)
      if (answer) return trackFast(text, answer)
    }
    const weather = fastPhrases ? deps.understandWeather?.(text) : null
    if (weather && deps.intents?.weather) {
      const forecast = deps.intents.weather
      return track(text, async () => {
        const card = await forecast(weather, text)
        note(text, card)
        return { card }
      })
    }
    return track(text, async signal => {
      const switched = await deps.switchBrain?.(text)
      return switched ? { card: switched } : askBrain(text, signal)
    })
  }

  /** A new conversation: the next ask starts a fresh Brain session (a different provider cannot resume this one). */
  function reset() {
    Object.assign(session, { id: null, turns: 0, notes: [] })
  }

  function cancel() {
    if (!thinking || !current) return false
    token++
    const { text, abort, resolve } = current
    current = null
    settlePermission(false)
    abort.abort()
    setThinking(false)
    events.publish({ type: 'cancelled' })
    deps.onTurn?.({ q: text, a: 'ยกเลิก', ok: false })
    resolve({ outcome: 'cancelled' })
    return true
  }

  const heardOnly = (armed = false): Outcome => ({ outcome: 'heard', armed })

  /** A pet command (feed, hungry?, sleep): the phone reacts to its own event; there is no card and no thinking. */
  function doPet(action: () => void): Outcome {
    armedUntil = 0
    action()
    return heardOnly(true)
  }

  return {
    cancel,
    reset,
    /** Run a prompt as a turn of its own (no wake word, no fast phrases: a task's prompt must not be read as a new schedule). */
    ask: (text: string) => ask(text, false),
    /** A tap on the face: the next sentence is the question (15 s), no name needed. */
    arm() {
      if (thinking) return
      armedUntil = clock.now() + ARM_MS
      deps.listen?.()
    },
    /** What was said (typed or transcribed). Resolves when this utterance's turn is over. */
    async hear(text: string, startedAt = clock.now()): Promise<Outcome> {
      const now = clock.now()
      const rang = await deps.ringing?.(text)
      if (rang) return { outcome: 'card', card: rang }
      if (thinking) {
        if (permission && CONFIRM.test(text) && !CANCEL.test(text)) {
          // an agent is waiting for this ตกลง
          events.publish({ type: 'heard', text })
          const { title } = permission
          settlePermission(true)
          events.publish({ type: 'thinking', text: title })
          return heardOnly(true)
        }
        // busy: only "stop" gets through
        if (CANCEL.test(text)) {
          cancel()
          return { outcome: 'cancelled' }
        }
        events.publish({ type: 'ignored', text })
        return heardOnly()
      }
      if (pendingAction) {
        const waiting = pendingAction
        pendingAction = null
        if (now < waiting.until && CANCEL.test(text)) {
          events.publish({ type: 'heard', text })
          events.publish({ type: 'cancelled' })
          return { outcome: 'cancelled' }
        }
        if (now < waiting.until && CONFIRM.test(text)) {
          events.publish({ type: 'heard', text })
          return track(waiting.label, async () => ({ card: await waiting.run() }))
        }
        // something else, or too late: drop it and treat this as a new request
      }
      if (pendingReply) {
        const waiting = pendingReply
        pendingReply = null
        if (now < waiting.until) {
          events.publish({ type: 'heard', text })
          if (CANCEL.test(text)) {
            events.publish({ type: 'cancelled' })
            return { outcome: 'cancelled' }
          }
          const next = waiting.answer(text)
          if (next) return trackFast(text, next)
          // not an answer: treat this as a new request
        }
      }
      if (pending) {
        const waiting = pending
        pending = null
        if (now < waiting.until && CANCEL.test(text)) {
          events.publish({ type: 'heard', text })
          events.publish({ type: 'cancelled' })
          return { outcome: 'cancelled' }
        }
        if (now < waiting.until && CONFIRM.test(text)) {
          events.publish({ type: 'heard', text })
          return track(waiting.plan || waiting.skill, signal => runSkill(waiting, signal))
        }
        // something else, or too late: drop it and treat this as a new request
      }
      events.publish({ type: 'heard', text })
      const { requireName, followUp } = deps.settings()
      const said = afterWake(text, wakeFor(pet().variants))
      if (said !== null) {
        if (said.length < 2) {
          armedUntil = now + ARM_MS
          events.publish({ type: 'armed' })
          deps.listen?.()
          return heardOnly(true)
        }
        const petAction = deps.petPhrase?.(said)
        if (petAction) return doPet(petAction)
        return ask(said)
      }
      if (startedAt < armedUntil) {
        armedUntil = 0
        const petAction = deps.petPhrase?.(text)
        if (petAction) return doPet(petAction)
        return ask(text)
      }
      if (followUp && startedAt < followUntil && countLetters(text) >= FOLLOW_MIN_CHARS) return ask(text)
      if (requireName) return heardOnly()
      if (isWeather(text) || isQuestion(text) || RESET.test(text)) return ask(text)
      return heardOnly()
    },
    /** For tests and diagnostics. */
    state: () => ({ thinking, session: { ...session, notes: [...session.notes] }, pending: pending !== null || pendingAction !== null || pendingReply !== null }),
  }
}

export type Conversation = ReturnType<typeof createConversation>
