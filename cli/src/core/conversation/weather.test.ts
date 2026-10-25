import { expect, test } from 'bun:test'
import { FakeClock } from '../../../test/helpers'
import type { Answer, Brain, Reply } from '../brain/brain'
import { textCard } from '../cards/cards'
import { createEvents } from '../events/events'
import { createConversation } from './conversation'

function setup() {
  const clock = new FakeClock()
  const asked: string[] = []
  const asks: Array<{ text: string; notes: string[]; answer(a: Answer): void }> = []
  const brain: Brain = {
    label: 'Fake',
    ask: request => new Promise<Reply>(resolve => {
      asked.push(request.text)
      asks.push({ text: request.text, notes: request.context.notes, answer: answer => resolve({ answer, session: 's1' }) })
    }),
    runSkill: () => { throw new Error('unused') },
  }
  const forecasts: Array<{ intent: { place: string; day: number }; text: string }> = []
  const conversation = createConversation({
    events: createEvents({ clock }), clock, brain, settings: () => ({ requireName: true, followUp: true, bypass: true }),
    understandWeather: text => (text.includes('อากาศ') ? { place: '', day: text.includes('พรุ่งนี้') ? 1 : 0 } : null),
    intents: {
      weather: async (intent, text) => {
        forecasts.push({ intent, text })
        return textCard({ kind: 'weather', title: '30°C', lines: ['กรุงเทพฯ'] })
      },
    },
  })
  return { conversation, asked, asks, forecasts }
}

test('a weather phrase gets the weather card without asking the Brain', async () => {
  const t = setup()
  const outcome = await t.conversation.hear('นีโอ อากาศพรุ่งนี้เป็นไง')
  expect(outcome).toMatchObject({ outcome: 'card', card: { kind: 'weather', title: '30°C' } })
  expect(t.asked).toEqual([])
  expect(t.forecasts).toEqual([{ intent: { place: '', day: 1 }, text: 'อากาศพรุ่งนี้เป็นไง' }])
})

test('the answer is kept as a note for the next Brain turn', async () => {
  const t = setup()
  await t.conversation.hear('นีโอ อากาศพรุ่งนี้เป็นไง')
  const next = t.conversation.hear('นีโอ แล้วต้องพกร่มไหม')
  await Bun.sleep(0)
  expect(t.asks[0]!.notes).toHaveLength(1)
  expect(t.asks[0]!.notes[0]).toContain('อากาศพรุ่งนี้เป็นไง')
  expect(t.asks[0]!.notes[0]).toContain('30°C')
  t.asks[0]!.answer({ type: 'card', card: textCard({ title: 'พก', lines: ['พก'] }) })
  await next
})

test('a Brain answer with a weather intent becomes the same card and is noted', async () => {
  const t = setup()
  const outcome = t.conversation.hear('นีโอ ไปโตเกียวเอาร่มไปไหม')
  await Bun.sleep(0)
  t.asks[0]!.answer({ type: 'weather', place: 'โตเกียว', day: 0 })
  expect(await outcome).toMatchObject({ outcome: 'card', card: { kind: 'weather' } })
  expect(t.forecasts).toEqual([{ intent: { place: 'โตเกียว', day: 0 }, text: 'ไปโตเกียวเอาร่มไปไหม' }])
  expect(t.conversation.state().session.notes[0]).toContain('30°C')
})

test('a failed forecast is an error, not a hang', async () => {
  const t = setup()
  const clock = new FakeClock()
  const conversation = createConversation({
    events: createEvents({ clock }), clock, brain: { label: 'F', ask: async () => { throw new Error('unused') }, runSkill: async () => { throw new Error('unused') } },
    settings: () => ({ requireName: true, followUp: true, bypass: true }),
    understandWeather: () => ({ place: '', day: 0 }),
    intents: { weather: async () => { throw new Error('weather 503') } },
  })
  expect(await conversation.hear('นีโอ อากาศเป็นไง')).toEqual({ outcome: 'error', error: 'weather 503' })
  expect(t.asked).toEqual([])
})
