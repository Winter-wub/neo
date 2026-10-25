import { expect, test } from 'bun:test'
import { FakeClock } from '../../../test/helpers'
import type { Brain, Reply } from '../brain/brain'
import { textCard } from '../cards/cards'
import { createConversation } from '../conversation/conversation'
import { createEvents } from '../events/events'

function setup() {
  const clock = new FakeClock()
  const turns: Array<{ q: string; a: string; ok: boolean }> = []
  const answers: Array<(r: Reply) => void> = []
  const brain: Brain = {
    label: 'Fake',
    ask: () => new Promise<Reply>(resolve => void answers.push(resolve)),
    runSkill: () => new Promise<Reply>(() => {}),
  }
  const conversation = createConversation({
    events: createEvents({ clock }), clock, brain, settings: () => ({ requireName: true, followUp: true, bypass: true }),
    onTurn: t => void turns.push(t),
  })
  return { conversation, turns, answers }
}

test('onTurn gets the question and the card text when a turn is answered', async () => {
  const { conversation, turns, answers } = setup()
  const done = conversation.hear('นีโอ ข่าววันนี้')
  await Bun.sleep(0)
  answers[0]!({ answer: { type: 'card', card: textCard({ title: 'ข่าว', lines: ['มีข่าวดี'] }) }, session: 's1' })
  await done
  expect(turns).toEqual([{ q: 'ข่าววันนี้', a: expect.stringContaining('มีข่าวดี'), ok: true }])
})

test('onTurn gets a failed turn and a cancelled turn with ok=false; a name alone is not a turn', async () => {
  const { conversation, turns, answers } = setup()
  await conversation.hear('นีโอ')
  expect(turns).toEqual([])
  const failed = conversation.hear('นีโอ ข่าววันนี้')
  await Bun.sleep(0)
  answers[0]!({ answer: { type: 'error', error: 'boom' }, session: null })
  await failed
  const cancelled = conversation.hear('นีโอ ฝนตกไหม')
  await Bun.sleep(0)
  conversation.cancel()
  await cancelled
  expect(turns).toEqual([
    { q: 'ข่าววันนี้', a: 'boom', ok: false },
    { q: 'ฝนตกไหม', a: 'ยกเลิก', ok: false },
  ])
})
