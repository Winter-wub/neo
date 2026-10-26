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

// ---- rename by voice (ticket 30): the fast-phrase order and the confirm / reply flow ----
import { textCard } from '../cards/cards'
import { createIdentity } from '../pet/identity'
import { createRename } from '../pet/rename'
import { CONFIRM_MS, FOLLOW_MS } from './conversation'

function renameSetup() {
  const clock = new FakeClock()
  const events = createEvents({ clock })
  const log: NeoEvent[] = []
  events.subscribe(e => log.push(e))
  const saved = new Map<string, unknown>()
  const identity = createIdentity({ events, store: { read: k => saved.get(k), write: async (k, v) => void saved.set(k, v) } })
  const asked: string[] = []
  const brain: Brain = { label: 'Fake', ask: async r => (asked.push(r.text), { answer: { type: 'card', card: textCard({ title: 'brain', lines: ['x'] }) }, session: null }), runSkill: async () => { throw new Error('no') } }
  const rename = createRename({ identity })
  const conversation = createConversation({ events, clock, brain, settings: () => ({ requireName: true, followUp: true, bypass: true }), pet: identity.wake, fast: [rename.understand] })
  const say = async (text: string) => (await conversation.hear(text), log.at(-1))
  return { conversation, clock, log, asked, identity, say }
}

test('rename: the phrase shows a confirm card with what was heard; ตกลง starts training; the Brain is never asked', async () => {
  const t = renameSetup()
  expect(await t.say('นีโอ เปลี่ยนชื่อเป็นมิว')).toMatchObject({ type: 'card', card: { title: 'เปลี่ยนชื่อเป็น “มิว” ใช่ไหม' } })
  expect(await t.say('ตกลง')).toMatchObject({ type: 'card', card: { title: expect.stringContaining('มิว') } })
  expect(t.identity.wake().training).toMatchObject({ name: 'มิว' })
  expect(t.asked).toEqual([])
})

test('rename: "ไม่" or too late cancels; the name is untouched', async () => {
  const t = renameSetup()
  await t.say('นีโอ เปลี่ยนชื่อเป็นมิว')
  expect(await t.say('ไม่')).toMatchObject({ type: 'cancelled' })
  await t.say('นีโอ เปลี่ยนชื่อเป็นมิว')
  t.clock.advance(CONFIRM_MS + 1)
  await t.say('ตกลง')
  expect(t.identity.wake()).toMatchObject({ name: 'นีโอ', training: null })
})

test('rename without a name asks, and the next sentence (no name needed) is the name', async () => {
  const t = renameSetup()
  expect(await t.say('นีโอ เปลี่ยนชื่อหน่อย')).toMatchObject({ card: { title: 'อยากให้ชื่ออะไร' } })
  expect(await t.say('มิว')).toMatchObject({ card: { title: 'เปลี่ยนชื่อเป็น “มิว” ใช่ไหม' } })
})

test('rename without a name: silence past the follow-up window drops the question', async () => {
  const t = renameSetup()
  await t.say('นีโอ เปลี่ยนชื่อหน่อย')
  t.clock.advance(FOLLOW_MS + 1)
  expect(await t.say('มิว')).toMatchObject({ type: 'heard' })
  expect(t.identity.wake().training).toBeNull()
})

test('"คุณชื่ออะไร" goes to the Brain, not the rename flow', async () => {
  const t = renameSetup()
  await t.say('นีโอ คุณชื่ออะไร')
  expect(t.asked).toEqual(['คุณชื่ออะไร'])
})
