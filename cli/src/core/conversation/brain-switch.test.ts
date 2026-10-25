// Ticket 06 in Conversation: an agent asking permission (30 s window), spoken provider switches, and starting over after a switch.
import { expect, test } from 'bun:test'
import { FakeClock } from '../../../test/helpers'
import type { NeoEvent } from '../../protocol'
import type { Answer, AskRequest, Brain, Reply } from '../brain/brain'
import { textCard } from '../cards/cards'
import { createEvents } from '../events/events'
import { createConversation, type ConversationDeps } from './conversation'

function setup(over: Partial<ConversationDeps> = {}) {
  const clock = new FakeClock()
  const events = createEvents({ clock })
  const log: NeoEvent[] = []
  events.subscribe(e => log.push(e))
  const asks: Array<AskRequest & { answer(a: Answer, session?: string): void }> = []
  const brain: Brain = {
    label: 'Fake',
    ask: request => new Promise<Reply>(resolve => {
      asks.push({ ...request, answer: (answer, session = 's1') => resolve({ answer, session }) })
    }),
    runSkill: async () => ({ answer: { type: 'error', error: 'no' }, session: null }),
  }
  const conversation = createConversation({ events, clock, brain, settings: () => ({ requireName: false, followUp: true, bypass: false }), ...over })
  return { conversation, clock, log, asks, types: () => log.map(e => e.type) }
}
const card = (title: string) => ({ type: 'card', card: textCard({ title, lines: [title] }) }) as const
const tick = () => Bun.sleep(0)

test('an agent asking to run a tool shows a question card; ตกลง lets it, and the turn goes on', async () => {
  const t = setup()
  const turn = t.conversation.hear('นีโอ แก้ไฟล์ให้หน่อย')
  await tick()
  const allowed = t.asks[0]!.confirm!({ title: 'Edit README.md', kind: 'edit', agent: 'OpenCode' })
  const question = t.log.at(-1)
  expect(question).toMatchObject({ type: 'card', card: { title: 'ใช้ OpenCode?', lines: ['Edit README.md', 'พูด “ตกลง” เพื่อทำ หรือ “ยกเลิก”'] } })
  const said = await t.conversation.hear('ตกลง')
  expect(said).toEqual({ outcome: 'heard', armed: true })
  expect(await allowed).toBe(true)
  expect(t.log.slice(-2).map(e => e.type)).toEqual(['heard', 'thinking'])
  expect(t.log.at(-1)).toMatchObject({ text: 'Edit README.md' })
  t.asks[0]!.answer(card('แก้แล้ว'))
  expect(await turn).toMatchObject({ outcome: 'card', card: { title: 'แก้แล้ว' } })
})

test('ยกเลิก denies the tool and stops the whole run', async () => {
  const t = setup()
  const turn = t.conversation.hear('นีโอ ลบไฟล์')
  await tick()
  const allowed = t.asks[0]!.confirm!({ title: 'rm -rf', kind: 'execute', agent: 'Agent' })
  expect(await t.conversation.hear('ยกเลิก')).toEqual({ outcome: 'cancelled' })
  expect(await allowed).toBe(false)
  expect(await turn).toEqual({ outcome: 'cancelled' })
  expect(t.types().at(-1)).toBe('cancelled')
})

test('no answer within 30 s denies the tool and says so; the run continues', async () => {
  const t = setup()
  void t.conversation.hear('นีโอ แก้ไฟล์')
  await tick()
  const allowed = t.asks[0]!.confirm!({ title: 'Edit a.txt', kind: 'edit', agent: 'Agent' })
  t.clock.advance(29_000)
  expect(t.log.at(-1)?.type).toBe('card')
  t.clock.advance(2_000)
  expect(await allowed).toBe(false)
  expect(t.log.at(-1)).toMatchObject({ type: 'thinking', text: 'Edit a.txt (ไม่ได้รับอนุญาต)' })
  expect(t.conversation.state().thinking).toBe(true)
})

test('other words while a tool waits are ignored, and a newer question replaces the older one', async () => {
  const t = setup()
  void t.conversation.hear('นีโอ ทำงาน')
  await tick()
  const first = t.asks[0]!.confirm!({ title: 'one', kind: 'edit', agent: 'A' })
  expect(await t.conversation.hear('คุยเล่นอยู่')).toEqual({ outcome: 'heard', armed: false })
  expect(t.types().at(-1)).toBe('ignored')
  const second = t.asks[0]!.confirm!({ title: 'two', kind: 'edit', agent: 'A' })
  expect(await first).toBe(false)
  await t.conversation.hear('ตกลง')
  expect(await second).toBe(true)
})

test('a spoken switch is answered by the switch hook, not the Brain, and is a turn with a card', async () => {
  const asked: string[] = []
  const t = setup({ switchBrain: async text => (asked.push(text), /^สลับไปใช้ opencode$/.test(text) ? textCard({ title: 'ใช้ OpenCode', lines: [] }) : null) })
  const outcome = await t.conversation.hear('นีโอ สลับไปใช้ opencode')
  expect(outcome).toMatchObject({ outcome: 'card', card: { title: 'ใช้ OpenCode' } })
  expect(t.asks).toHaveLength(0)
  expect(t.types()).toEqual(['heard', 'thinking', 'card'])
  // not a switch → the Brain
  const turn = t.conversation.hear('นีโอ สลับไปใช้ไฟล์สอง')
  await tick()
  expect(t.asks).toHaveLength(1)
  t.asks[0]!.answer(card('ok'))
  await turn
  expect(asked).toEqual(['สลับไปใช้ opencode', 'สลับไปใช้ไฟล์สอง'])
})

test('reset starts a new Brain session: the next ask resumes nothing', async () => {
  const t = setup()
  const first = t.conversation.hear('นีโอ หนึ่ง')
  await tick()
  t.asks[0]!.answer(card('a'), 'sess-1')
  await first
  const second = t.conversation.hear('นีโอ สอง')
  await tick()
  expect(t.asks[1]!.resume).toBe('sess-1')
  t.asks[1]!.answer(card('b'), 'sess-1')
  await second
  t.conversation.reset()
  const third = t.conversation.hear('นีโอ สาม')
  await tick()
  expect(t.asks[2]!.resume).toBeNull()
  t.asks[2]!.answer(card('c'))
  await third
  expect(t.log.filter(e => e.type === 'session').map(e => e.type === 'session' && [e.fresh, e.turn])).toEqual([[true, 1], [false, 2], [true, 1]])
})
