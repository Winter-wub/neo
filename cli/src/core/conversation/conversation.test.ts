import { expect, test } from 'bun:test'
import { FakeClock } from '../../../test/helpers'
import type { NeoEvent } from '../../protocol'
import type { Answer, AskRequest, Brain, Reply, SkillRequest } from '../brain/brain'
import { textCard } from '../cards/cards'
import { createEvents } from '../events/events'
import { SESSION_IDLE_MS, SESSION_MAX_TURNS, createConversation, type ConversationDeps } from './conversation'

/** A Brain the test controls: every ask waits until the test answers it. */
function fakeBrain() {
  const asks: Array<AskRequest & { answer(a: Answer, session?: string | null): void }> = []
  const skills: Array<SkillRequest & { answer(a: Answer): void }> = []
  let seq = 0
  const brain: Brain = {
    label: 'Fake',
    ask: request => new Promise<Reply>(resolve => {
      asks.push({ ...request, answer: (answer, session = `s${++seq}`) => resolve({ answer, session: answer.type === 'error' ? null : session }) })
    }),
    runSkill: request => new Promise<Reply>(resolve => {
      skills.push({ ...request, answer: answer => resolve({ answer, session: null }) })
    }),
  }
  return { brain, asks, skills }
}

const card = (title: string) => ({ type: 'card', card: textCard({ title, lines: [title] }) }) as const
const tick = () => Bun.sleep(0)

function setup(over: Partial<ConversationDeps> = {}, settings = { requireName: true, followUp: true, bypass: true }) {
  const clock = new FakeClock()
  const events = createEvents({ clock })
  const log: NeoEvent[] = []
  events.subscribe(e => log.push(e))
  const fake = fakeBrain()
  const busy: boolean[] = []
  const conversation = createConversation({ events, clock, brain: fake.brain, settings: () => settings, onBusy: on => void busy.push(on), ...over })
  const types = () => log.map(e => e.type)
  return { conversation, clock, log, types, busy, settings, ...fake }
}

test('the name plus a question: heard → thinking → session → tool → card, and the card is humanized', async () => {
  const t = setup()
  const outcome = t.conversation.hear('นีโอ ราคาทองวันนี้เท่าไหร่')
  await tick()
  expect(t.asks).toHaveLength(1)
  expect(t.asks[0]!.text).toBe('ราคาทองวันนี้เท่าไหร่')
  t.asks[0]!.onTool('WebSearch', '{}')
  t.asks[0]!.answer({ type: 'card', card: textCard({ title: '**ทอง**', lines: ['ดู [ที่นี่](https://x.com/a)'] }) })
  const done = await outcome
  expect(t.types()).toEqual(['heard', 'thinking', 'session', 'tool', 'card'])
  expect(done).toMatchObject({ outcome: 'card', card: { title: 'ทอง', lines: ['ดู ที่นี่'] } })
  expect(t.log.at(-1)).toMatchObject({ type: 'card', card: { title: 'ทอง' } })
  expect(t.busy).toEqual([true, false])
})

test('without the name nothing is asked while requireName is on; the name alone arms the next sentence for 15 s', async () => {
  const t = setup()
  expect(await t.conversation.hear('ราคาทองวันนี้เท่าไหร่')).toEqual({ outcome: 'heard', armed: false })
  expect(t.asks).toHaveLength(0)
  expect(await t.conversation.hear('นีโอ')).toEqual({ outcome: 'heard', armed: true })
  expect(t.types()).toContain('armed')
  t.clock.advance(5000)
  const outcome = t.conversation.hear('ขอข้อมูลหน่อย')
  await tick()
  expect(t.asks[0]!.text).toBe('ขอข้อมูลหน่อย')
  t.asks[0]!.answer(card('ok'))
  await outcome
})

test('an armed window that ran out does not ask', async () => {
  const t = setup()
  await t.conversation.hear('นีโอ')
  t.clock.advance(16_000)
  expect(await t.conversation.hear('ขอข้อมูลหน่อย')).toEqual({ outcome: 'heard', armed: false })
  expect(t.asks).toHaveLength(0)
})

test('after an answer, follow-up speech within 45 s needs no name (when followUp is on)', async () => {
  const t = setup()
  const first = t.conversation.hear('นีโอ ข่าววันนี้')
  await tick()
  t.asks[0]!.answer(card('ข่าว'))
  await first
  t.clock.advance(44_000)
  const second = t.conversation.hear('แล้วเรื่องกีฬาล่ะ')
  await tick()
  expect(t.asks).toHaveLength(2)
  t.asks[1]!.answer(card('กีฬา'))
  await second
  t.clock.advance(46_000)
  expect(await t.conversation.hear('แล้วเรื่องหุ้นล่ะ')).toEqual({ outcome: 'heard', armed: false })
})

test('followUp off: no follow-up without the name', async () => {
  const t = setup({}, { requireName: true, followUp: false, bypass: true })
  const first = t.conversation.hear('นีโอ ข่าววันนี้')
  await tick()
  t.asks[0]!.answer(card('ข่าว'))
  await first
  expect(await t.conversation.hear('แล้วเรื่องกีฬาล่ะ')).toMatchObject({ outcome: 'heard' })
})

test('requireName off: questions and weather are asked, other chatter is only heard', async () => {
  const t = setup({}, { requireName: false, followUp: true, bypass: true })
  expect(await t.conversation.hear('วันนี้กินข้าวแล้ว')).toMatchObject({ outcome: 'heard' })
  const q = t.conversation.hear('ร้านนี้เปิดกี่โมงบ้าง')
  await tick()
  expect(t.asks).toHaveLength(1)
  t.asks[0]!.answer(card('x'))
  await q
})

test('the Brain gets the pet name, memory, the time and bypass from Conversation', async () => {
  const t = setup({ pet: () => ({ name: 'จอห์น', variants: ['จอห์น', 'จอน'] }), memory: () => 'ชอบกาแฟ' })
  const outcome = t.conversation.hear('จอน ทำอะไรอยู่')
  await tick()
  expect(t.asks[0]!.context).toMatchObject({ petName: 'จอห์น', memory: 'ชอบกาแฟ', wakeVariants: ['จอห์น', 'จอน'], now: new Date(t.clock.now()) })
  expect(t.asks[0]!.bypass).toBe(true)
  t.asks[0]!.answer(card('x'))
  await outcome
})

async function turn(t: ReturnType<typeof setup>, text: string, answer: Answer = card('x')) {
  const outcome = t.conversation.hear('นีโอ ' + text)
  await tick()
  t.asks.at(-1)!.answer(answer)
  return outcome
}

test('session: first ask is fresh, the next resumes it', async () => {
  const t = setup()
  await turn(t, 'หนึ่งนะ')
  await turn(t, 'สองนะ')
  expect(t.asks.map(a => a.resume)).toEqual([null, 's1'])
  expect(t.log.filter(e => e.type === 'session')).toMatchObject([{ fresh: true, turn: 1, provider: 'Fake' }, { fresh: false, turn: 2 }])
})

test('session: 15 minutes of silence starts a new one', async () => {
  const t = setup()
  await turn(t, 'หนึ่งนะ')
  t.clock.advance(SESSION_IDLE_MS)
  await turn(t, 'สองนะ')
  expect(t.asks[1]!.resume).toBe('s1')
  t.clock.advance(SESSION_IDLE_MS + 1)
  await turn(t, 'สามนะ')
  expect(t.asks[2]!.resume).toBeNull()
})

test('session: after 20 turns the 21st starts a new session', async () => {
  const t = setup()
  for (let i = 0; i < SESSION_MAX_TURNS; i++) await turn(t, 'ข้อ' + i)
  expect(t.asks[SESSION_MAX_TURNS - 1]!.resume).not.toBeNull()
  await turn(t, 'ข้อสุดท้าย')
  expect(t.asks[SESSION_MAX_TURNS]!.resume).toBeNull()
  expect(t.log.filter(e => e.type === 'session').at(-1)).toMatchObject({ fresh: true, turn: 1 })
})

test('session: a reset phrase answers itself, forgets the session and the notes, and never reaches the Brain', async () => {
  const t = setup()
  await turn(t, 'หนึ่งนะ')
  const outcome = await t.conversation.hear('นีโอ เริ่มใหม่')
  expect(outcome).toMatchObject({ outcome: 'card', card: { title: 'เริ่มคุยใหม่แล้ว' } })
  expect(t.asks).toHaveLength(1)
  await turn(t, 'สองนะ')
  expect(t.asks[1]!.resume).toBeNull()
})

test('notes: an answer that did not come from the Brain is handed to the next ask once', async () => {
  const weather = async () => textCard({ title: 'อากาศ', lines: ['ฝนตก 70%'] })
  const t = setup({ intents: { weather } })
  const outcome = t.conversation.hear('นีโอ อากาศวันนี้เป็นไง')
  await tick()
  t.asks[0]!.answer({ type: 'weather', place: 'กรุงเทพ', day: 0 })
  expect(await outcome).toMatchObject({ outcome: 'card', card: { title: 'อากาศ' } })
  await turn(t, 'แล้วพรุ่งนี้ล่ะ')
  expect(t.asks[1]!.context.notes).toHaveLength(1)
  expect(t.asks[1]!.context.notes[0]).toContain('ฝนตก 70%')
  await turn(t, 'ขอบคุณนะ')
  expect(t.asks[2]!.context.notes).toEqual([])
})

test('weather and schedule intents with no owner yet fall back to a short apology card', async () => {
  const t = setup()
  const w = t.conversation.hear('นีโอ ฝนจะตกไหม')
  await tick()
  t.asks[0]!.answer({ type: 'weather', place: '', day: 0 })
  expect(await w).toMatchObject({ outcome: 'card', card: { title: 'ดูอากาศไม่ได้' } })
  const s = t.conversation.hear('นีโอ ปลุกพรุ่งนี้ตีห้า')
  await tick()
  t.asks[1]!.answer({ type: 'schedule', kind: 'alarm', title: 'ตื่น', prompt: '', at: '2026-10-27T05:00' })
  expect(await s).toMatchObject({ outcome: 'card', card: { title: 'ตั้งเวลาไม่ได้' } })
})

test('a Brain error becomes askerr and the session is untouched', async () => {
  const t = setup()
  const outcome = await turn(t, 'หนึ่งนะ', { type: 'error', error: 'no result' })
  expect(outcome).toEqual({ outcome: 'error', error: 'no result' })
  expect(t.log.at(-1)).toMatchObject({ type: 'askerr', error: 'no result' })
  expect(t.conversation.state().thinking).toBe(false)
  await turn(t, 'สองนะ')
  expect(t.asks[1]!.resume).toBeNull()
})

test('while thinking, other speech is ignored; "ยกเลิก" cancels, aborts the Brain and ends the turn', async () => {
  const t = setup()
  const first = t.conversation.hear('นีโอ ค้นหน่อย')
  await tick()
  expect(await t.conversation.hear('แล้วก็อีกเรื่อง')).toEqual({ outcome: 'heard', armed: false })
  expect(t.log.at(-1)).toMatchObject({ type: 'ignored', text: 'แล้วก็อีกเรื่อง' })
  const ask = t.asks[0]!
  expect(ask.signal.aborted).toBe(false)
  expect(await t.conversation.hear('ยกเลิก')).toEqual({ outcome: 'cancelled' })
  expect(await first).toEqual({ outcome: 'cancelled' })
  expect(ask.signal.aborted).toBe(true)
  expect(t.log.at(-1)).toMatchObject({ type: 'cancelled' })
  expect(t.busy).toEqual([true, false])
  ask.answer(card('late')) // a late answer must not surface
  await tick()
  expect(t.types().filter(x => x === 'card')).toEqual([])
})

test('cancel() with nothing running does nothing', async () => {
  const t = setup()
  expect(t.conversation.cancel()).toBe(false)
  expect(t.log).toEqual([])
})

const skill: Answer = { type: 'skill', skill: 'jenkins', plan: 'ดูสถานะ build', task: 'เปิด jenkins' }

test('a skill intent asks for confirmation; "ตกลง" within 30 s runs it and shows the result', async () => {
  const t = setup()
  const ask = t.conversation.hear('นีโอ เช็ค jenkins ให้หน่อย')
  await tick()
  t.asks[0]!.answer(skill)
  const confirm = await ask
  expect(confirm).toMatchObject({ outcome: 'card', card: { title: 'ใช้ jenkins?' } })
  expect(t.conversation.state().pending).toBe(true)

  t.clock.advance(10_000)
  const run = t.conversation.hear('ตกลง')
  await tick()
  expect(t.skills[0]).toMatchObject({ skill: 'jenkins', task: 'เปิด jenkins', petName: 'นีโอ' })
  t.skills[0]!.answer(card('build ผ่าน'))
  expect(await run).toMatchObject({ outcome: 'card', card: { title: 'build ผ่าน' } })
  expect(t.types().slice(-3)).toEqual(['heard', 'thinking', 'card'])
  // the result is remembered as a note for the next ask
  await turn(t, 'แล้วผลเป็นไง')
  expect(t.asks[1]!.context.notes[0]).toContain('(ยืนยันให้ใช้ jenkins) ดูสถานะ build')
})

test('a pending confirmation: "ยกเลิก" cancels, a late "ตกลง" runs nothing', async () => {
  const t = setup()
  const a = t.conversation.hear('นีโอ เช็ค jenkins')
  await tick()
  t.asks[0]!.answer(skill)
  await a
  expect(await t.conversation.hear('ยกเลิก')).toEqual({ outcome: 'cancelled' })
  expect(t.conversation.state().pending).toBe(false)

  const b = t.conversation.hear('นีโอ เช็ค jenkins')
  await tick()
  t.asks[1]!.answer(skill)
  await b
  t.clock.advance(31_000)
  expect(await t.conversation.hear('ตกลง')).toEqual({ outcome: 'heard', armed: false })
  expect(t.skills).toHaveLength(0)
})

test('"ยกเลิก" while a skill runs aborts it', async () => {
  const t = setup()
  const a = t.conversation.hear('นีโอ เช็ค jenkins')
  await tick()
  t.asks[0]!.answer(skill)
  await a
  const run = t.conversation.hear('ตกลง')
  await tick()
  await t.conversation.hear('หยุด')
  expect(await run).toEqual({ outcome: 'cancelled' })
  expect(t.skills[0]!.signal.aborted).toBe(true)
})

test('listen mode is requested when the name is said alone and on a tap, and the tap arms the next sentence for 15 s', async () => {
  let listens = 0
  const t = setup({ listen: () => void listens++ })
  await t.conversation.hear('นีโอ')
  expect(listens).toBe(1)
  t.clock.advance(16_000) // the name's window ran out
  t.conversation.arm()
  expect(listens).toBe(2)
  expect(t.types()).toEqual(['heard', 'armed']) // a tap says nothing on the stream
  const outcome = t.conversation.hear('ราคาทองวันนี้')
  await tick()
  expect(t.asks[0]!.text).toBe('ราคาทองวันนี้')
  t.asks[0]!.answer(card('ทอง'))
  expect(await outcome).toMatchObject({ outcome: 'card' })
})

test('a tap while thinking changes nothing; a tap window that ran out does not ask', async () => {
  let listens = 0
  const t = setup({ listen: () => void listens++ })
  void t.conversation.hear('นีโอ ขอดูอากาศหน่อย')
  await tick()
  t.conversation.arm()
  expect(listens).toBe(0)
  t.asks[0]!.answer(card('อากาศ'))
  await tick()
  t.clock.advance(46_000) // also past the follow-up window
  t.conversation.arm()
  t.clock.advance(16_000)
  expect(await t.conversation.hear('ราคาทองวันนี้')).toEqual({ outcome: 'heard', armed: false })
  expect(t.asks).toHaveLength(1)
})
