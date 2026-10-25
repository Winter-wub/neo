import { expect, test } from 'bun:test'
import { FakeClock } from '../../../test/helpers'
import type { NeoEvent } from '../../protocol'
import type { Brain } from '../brain/brain'
import { createEvents } from '../events/events'
import { createPet } from '../pet/pet'
import { createConversation } from './conversation'

function setup(settings = { requireName: true, followUp: true, bypass: true }) {
  const clock = new FakeClock()
  const events = createEvents({ clock })
  const log: NeoEvent[] = []
  events.subscribe(e => log.push(e))
  const asked: string[] = []
  const brain: Brain = { label: 'Fake', ask: async r => (asked.push(r.text), { answer: { type: 'error', error: 'no brain in this test' }, session: null }), runSkill: async () => { throw new Error('no') } }
  const pet = createPet({ clock, events, store: { read: () => undefined, write: async () => {} } })
  const conversation = createConversation({ events, clock, brain, settings: () => settings, petPhrase: pet.understand })
  return { conversation, clock, log, asked, types: () => log.map(e => e.type) }
}

test('"นีโอ ให้ปลาหน่อย" feeds fish: heard, feed; no thinking, the Brain is never asked', async () => {
  const t = setup()
  expect(await t.conversation.hear('นีโอ ให้ปลาหน่อย')).toEqual({ outcome: 'heard', armed: true })
  expect(t.types()).toEqual(['heard', 'feed'])
  expect(t.log[1]).toMatchObject({ food: 'fish' })
  expect(t.asked).toEqual([])
})

test('"นีโอ หิวไหม" → pet_ask and "นีโอ ไปนอนได้แล้ว" → sleep', async () => {
  const t = setup()
  await t.conversation.hear('นีโอ หิวไหม')
  await t.conversation.hear('นีโอ ไปนอนได้แล้ว')
  expect(t.types()).toEqual(['heard', 'pet_ask', 'heard', 'sleep'])
})

test('after the name alone (armed) the next sentence needs no name', async () => {
  const t = setup()
  await t.conversation.hear('นีโอ')
  await t.conversation.hear('ให้นมหน่อย')
  expect(t.types()).toEqual(['heard', 'armed', 'heard', 'feed'])
  // and the armed window is used up
  await t.conversation.hear('ให้นมหน่อย')
  expect(t.types().filter(x => x === 'feed')).toHaveLength(1)
})

test('without the name (or an armed window) a pet phrase is only heard', async () => {
  const t = setup()
  expect(await t.conversation.hear('ให้ปลาหน่อย')).toEqual({ outcome: 'heard', armed: false })
  expect(t.types()).toEqual(['heard'])
})

test('a tap arms the next sentence for pet phrases too', async () => {
  const t = setup()
  t.conversation.arm()
  await t.conversation.hear('ไปนอนได้แล้ว')
  expect(t.types()).toEqual(['heard', 'sleep'])
})

test('an ordinary question after the name still goes to the Brain', async () => {
  const t = setup()
  await t.conversation.hear('นีโอ ราคาทองวันนี้เท่าไหร่')
  expect(t.asked).toEqual(['ราคาทองวันนี้เท่าไหร่'])
})
