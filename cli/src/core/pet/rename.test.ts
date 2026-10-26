import { expect, test } from 'bun:test'
import { FakeClock } from '../../../test/helpers'
import type { NeoEvent } from '../../protocol'
import { createEvents } from '../events/events'
import { createIdentity } from './identity'
import { createRename } from './rename'

function setup() {
  const clock = new FakeClock()
  const events = createEvents({ clock })
  const log: NeoEvent[] = []
  events.subscribe(e => log.push(e))
  const saved = new Map<string, unknown>()
  const store = { read: (key: string) => saved.get(key), write: async (key: string, value: unknown) => void saved.set(key, value) }
  const identity = createIdentity({ events, store })
  return { rename: createRename({ identity }), identity, log }
}

test.each([
  ['เปลี่ยนชื่อเป็นมิว', 'มิว'],
  ['เปลี่ยนชื่อเป็น มิว นะ', 'มิว'],
  ['ต่อไปนี้ชื่อมิวนะ', 'มิว'],
  ['ต่อไปนี้ให้ชื่อมิว', 'มิว'],
  ['ตั้งชื่อใหม่ว่ามิว', 'มิว'],
  ['ตั้งชื่อใหม่เป็น "มิว"', 'มิว'],
  ['เปลี่ยนชื่อใหม่เป็นคุกกี้ค่ะ.', 'คุกกี้'],
])('"%s" asks to confirm the name "%s", showing what was heard', (said, name) => {
  const t = setup()
  const answer = t.rename.understand(said)!
  expect(answer.card.title).toBe(`เปลี่ยนชื่อเป็น “${name}” ใช่ไหม`)
  expect(answer.confirm).toBeFunction()
})

test.each(['คุณชื่ออะไร', 'ชื่อฉันคือจอห์น', 'ชื่อมิวน่ารักดี', 'เปลี่ยนชื่อไฟล์เป็นมิว', 'ราคาทองวันนี้'])('"%s" is not a rename', said => {
  expect(setup().rename.understand(said)).toBeNull()
})

test('no name in the phrase: asks for it, and the next utterance is the name', () => {
  const t = setup()
  const ask = t.rename.understand('เปลี่ยนชื่อหน่อย')!
  expect(ask.card.title).toBe('อยากให้ชื่ออะไร')
  expect(ask.confirm).toBeUndefined()
  expect(ask.reply!('ชื่อมิวแล้วกัน')!.card.title).toBe('เปลี่ยนชื่อเป็น “มิว” ใช่ไหม')
  expect(ask.reply!('  ')).toBeNull()
})

test('confirm starts training for the new name (old name stays until three takes are heard)', async () => {
  const t = setup()
  const card = await t.rename.understand('เปลี่ยนชื่อเป็นมิว')!.confirm!()
  expect(card.title).toContain('มิว')
  expect(t.identity.wake()).toMatchObject({ name: 'นีโอ', training: { name: 'มิว', got: [] } })
  expect(t.log.map(e => e.type)).toEqual(['train'])
})

test('after the third take the new name is saved and a happy card introduces it; ยกเลิก mid-way keeps the old name', async () => {
  const t = setup()
  await t.rename.understand('เปลี่ยนชื่อเป็นมิว')!.confirm!()
  await t.identity.hearing('มิว')
  await t.identity.hearing('หมิว.')
  await t.identity.hearing('มิ้ว')
  expect(t.identity.wake()).toMatchObject({ name: 'มิว', variants: ['มิว', 'หมิว', 'มิ้ว'], training: null })
  const intro = t.log.at(-1)
  expect(intro).toMatchObject({ type: 'card', card: { title: expect.stringContaining('มิว'), emotion: 'happy' } })

  await t.rename.understand('เปลี่ยนชื่อเป็นโมจิ')!.confirm!()
  await t.identity.hearing('โมจิ')
  expect(await t.identity.hearing('ยกเลิก')).toBe(true)
  expect(t.identity.wake()).toMatchObject({ name: 'มิว', training: null })
  expect(t.log.at(-1)).toMatchObject({ type: 'card', card: { title: expect.stringContaining('ยกเลิก') } })
})
