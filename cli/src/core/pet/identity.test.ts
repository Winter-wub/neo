import { expect, test } from 'bun:test'
import { FakeClock } from '../../../test/helpers'
import type { NeoEvent } from '../../protocol'
import { DEFAULT_PET_NAME, DEFAULT_WAKE } from '../conversation/phrases'
import { createEvents } from '../events/events'
import { SettingsError } from '../settings/settings'
import { createIdentity } from './identity'

function setup(initial: Record<string, unknown> = {}) {
  const clock = new FakeClock()
  const events = createEvents({ clock })
  const log: NeoEvent[] = []
  events.subscribe(e => log.push(e))
  const saved = new Map<string, unknown>(Object.entries(initial))
  const store = { read: (key: string) => saved.get(key), write: async (key: string, value: unknown) => void saved.set(key, value) }
  return { identity: createIdentity({ events, store }), log, saved, store, events }
}

test('out of the box: the name is นีโอ, the default spellings, the default colours', () => {
  const t = setup()
  expect(t.identity.wake()).toEqual({ name: DEFAULT_PET_NAME, variants: [...DEFAULT_WAKE], training: null })
  expect(t.identity.face()).toEqual({ fg: '#7fffd4', accent: '#ff7aa8', cheek: '#ff9a9a', bg: '#000000' })
})

test('set name: the name is always one of its variants, duplicates go, at most 20, saved and announced', async () => {
  const t = setup()
  await t.identity.setWake('จอห์น', ['จอน', ' จอห์น ', '', 'จอร์น'])
  expect(t.identity.wake()).toEqual({ name: 'จอห์น', variants: ['จอห์น', 'จอน', 'จอร์น'], training: null })
  expect(t.saved.get('wake')).toEqual({ name: 'จอห์น', variants: ['จอห์น', 'จอน', 'จอร์น'] })
  expect(t.log).toEqual([{ type: 'wake', name: 'จอห์น', variants: ['จอห์น', 'จอน', 'จอร์น'], at: expect.any(Number) }])
  await t.identity.setWake('x', Array.from({ length: 40 }, (_, i) => `v${i}`))
  expect(t.identity.wake().variants).toHaveLength(20)
})

test('an empty name is refused', async () => {
  const t = setup()
  await expect(t.identity.setWake('  ', [])).rejects.toBeInstanceOf(SettingsError)
})

test('the name survives a restart', async () => {
  const t = setup()
  await t.identity.setWake('จอห์น', ['จอน'])
  const again = createIdentity({ events: t.events, store: t.store })
  expect(again.wake().variants).toEqual(['จอห์น', 'จอน'])
})

test('training: the next three transcripts become the variants and are not commands', async () => {
  const t = setup()
  await t.identity.train('จอห์น')
  expect(t.identity.wake().training).toEqual({ name: 'จอห์น', got: [] })
  expect(await t.identity.hearing('จอน.')).toBe(true)
  expect(await t.identity.hearing('จอห์น ')).toBe(true)
  expect(t.identity.wake().training).toEqual({ name: 'จอห์น', got: ['จอน.', 'จอห์น '] })
  expect(await t.identity.hearing('ชอน')).toBe(true)
  expect(t.identity.wake()).toEqual({ name: 'จอห์น', variants: ['จอห์น', 'จอน', 'ชอน'], training: null })
  expect(t.log.map(e => e.type === 'train' ? `train:${e.n}:${e.text ?? ''}` : e.type)).toEqual(['train:0:', 'train:1:จอน.', 'train:2:จอห์น ', 'train:3:ชอน', 'wake'])
  expect(await t.identity.hearing('ราคาทอง')).toBe(false)
})

test('cancelling training leaves the name alone and stops swallowing transcripts', async () => {
  const t = setup()
  await t.identity.train('จอห์น')
  await t.identity.hearing('จอน')
  expect(t.identity.cancelTraining()).toBe(true)
  expect(t.identity.cancelTraining()).toBe(false)
  expect(await t.identity.hearing('จอน')).toBe(false)
  expect(t.identity.wake().name).toBe(DEFAULT_PET_NAME)
})

test('face: partial colours merge, saved, announced with the whole face', async () => {
  const t = setup()
  expect(await t.identity.setFace({ fg: '#FFFFFF' })).toEqual({ fg: '#FFFFFF', accent: '#ff7aa8', cheek: '#ff9a9a', bg: '#000000' })
  expect(t.saved.get('face')).toEqual({ fg: '#FFFFFF', accent: '#ff7aa8', cheek: '#ff9a9a', bg: '#000000' })
  expect(t.log).toEqual([{ type: 'face', fg: '#FFFFFF', accent: '#ff7aa8', cheek: '#ff9a9a', bg: '#000000', at: expect.any(Number) }])
})

test('face: a colour that is not #rrggbb, or an unknown part, is refused and nothing changes', async () => {
  const t = setup()
  await expect(t.identity.setFace({ fg: 'white' })).rejects.toBeInstanceOf(SettingsError)
  await expect(t.identity.setFace({ nose: '#ffffff' } as never)).rejects.toBeInstanceOf(SettingsError)
  await expect(t.identity.setFace({})).rejects.toBeInstanceOf(SettingsError)
  expect(t.identity.face().fg).toBe('#7fffd4')
  expect(t.log).toEqual([])
})
