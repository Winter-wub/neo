import { afterEach, beforeEach, expect } from 'bun:test'
import { ask, describe, divergent, test, useBackend } from '../src/harness.ts'
import type { EventStream } from '../src/phone.ts'
import { Mic } from '../src/voice.ts'

/** Each test gets a fresh event stream and mic on the shared backend. */
function useConversation() {
  const s = useBackend()
  const c = {} as { s: typeof s; events: EventStream; mic: Mic }
  c.s = s
  beforeEach(async () => {
    c.events = await s.phone.events()
    await c.events.waitFor('hello')
    c.mic = new Mic(s.backend, s.phone)
  })
  afterEach(async () => {
    c.mic.close()
    await c.events.close()
  })
  return c
}

const lastCard = (events: EventStream) => events.events.filter((e) => e.type === 'card').at(-1)!.card

describe('asking a question by voice', () => {
  const c = useConversation()

  test('wake word + question: heard, then thinking and session, then tool, then card', async () => {
    c.mic.say(ask('@tool:WebSearch'))
    await c.events.waitFor('card')
    const at = (type: string) => c.events.types.indexOf(type)
    expect(at('heard')).toBeLessThan(at('thinking'))
    expect(at('thinking')).toBeLessThan(at('tool'))
    expect(at('session')).toBeLessThan(at('tool'))
    expect(at('tool')).toBeLessThan(at('card'))

    expect(c.events.events.find((e) => e.type === 'heard')!.text).toBe(ask('@tool:WebSearch'))
    const thinking = c.events.events.find((e) => e.type === 'thinking')!
    expect(thinking.text).toBe('ทดสอบระบบการ์ดสำหรับสัญญาหลังบ้านเรียบร้อย @tool:WebSearch') // the question, wake word removed
    expect(c.events.events.find((e) => e.type === 'session')).toMatchObject({ fresh: true, turn: 1, provider: expect.any(String) })
    expect(c.events.events.find((e) => e.type === 'tool')).toMatchObject({ name: 'WebSearch', input: expect.any(String) })
    expect(lastCard(c.events)).toMatchObject({ kind: 'text', layout: 'text', title: 'ตอบแล้ว', emotion: 'happy', sounds: ['happy'] })
  })

  test('claude is run with stream-json, the prompt on stdin, and the bypass flag set', async () => {
    c.mic.say(ask())
    await c.events.waitFor('card')
    const call = (await c.s.backend.claudeLog()).filter((e) => e.event === 'call').at(-1)!
    expect(call.argv).toEqual(expect.arrayContaining(['-p', '--output-format', 'stream-json', '--verbose', '--permission-mode', 'bypassPermissions', '--mcp-config']))
    expect(call.argv!.join(' ')).not.toContain('สัญญาหลังบ้าน') // the question is on stdin, not argv
    expect(call.prompt).toContain('สัญญาหลังบ้าน')
  })

  test('the card is made fit for a small screen (title, big value, line count and length, seconds)', async () => {
    c.mic.say(ask('@card:long'))
    await c.events.waitFor('card')
    const card = lastCard(c.events)
    expect([...card.title].length).toBeLessThanOrEqual(30)
    expect([...card.big].length).toBeLessThanOrEqual(14)
    expect(card.lines.length).toBeLessThanOrEqual(14)
    for (const line of card.lines) expect([...line].length).toBeLessThanOrEqual(40)
    expect(card.seconds).toBeLessThanOrEqual(90)
  })

  test('list, big and pixel layouts arrive with their fields', async () => {
    c.mic.say(ask('@card:list'))
    await c.events.waitFor('card')
    expect(lastCard(c.events)).toMatchObject({ layout: 'list', items: [{ t: 'ข้อหนึ่ง', v: '1' }, { t: 'ข้อสอง', v: '2' }] })

    const seen = c.events.events.length
    c.mic.say(ask('@card:big'))
    await c.events.waitFor('card', 5000, seen)
    expect(lastCard(c.events)).toMatchObject({ layout: 'big', big: '42' })

    const seen2 = c.events.events.length
    c.mic.say(ask('@card:pixel'))
    await c.events.waitFor('card', 5000, seen2)
    expect(lastCard(c.events)).toMatchObject({ layout: 'pixel', w: 4, h: 4, palette: { g: '#00ff00' }, fps: 2, frames: [['gggg', 'g..g', 'g..g', 'gggg']] })
  })

  test('a failing brain is an "askerr" with the reason', async () => {
    c.mic.say(ask('@fail'))
    const failed = await c.events.waitFor('askerr')
    expect(typeof failed.error).toBe('string')
    expect(c.events.types).not.toContain('card')
  })

  test('the follow-up needs no wake word, resumes the same claude session, and counts the turn', async () => {
    c.mic.say(ask())
    await c.events.waitFor('card')
    const seen = c.events.events.length
    c.mic.say('แล้วอีกเรื่องล่ะว่ายังไงต่อไป')
    await c.events.waitFor((e) => e.type === 'session' && e.fresh === false, 5000, seen)
    const session = c.events.events.slice(seen).find((e) => e.type === 'session')!
    expect(session.turn).toBeGreaterThanOrEqual(2)
    await c.events.waitFor('card', 5000, seen)
    const calls = (await c.s.backend.claudeLog()).filter((e) => e.event === 'call')
    const [first, second] = calls.slice(-2)
    expect(second!.argv).toContain('--resume')
    expect(second!.argv![second!.argv!.indexOf('--resume') + 1]).toBe(first!.session)
  })

  test('"เริ่มคุยใหม่" forgets the conversation without calling claude', async () => {
    c.mic.say(ask())
    await c.events.waitFor('card')
    const calls = (await c.s.backend.claudeLog()).length
    const seen = c.events.events.length
    c.mic.say('นีโอ เริ่มคุยใหม่')
    await c.events.waitFor('card', 5000, seen)
    expect(lastCard(c.events).title).toBe('เริ่มคุยใหม่แล้ว')
    expect((await c.s.backend.claudeLog()).length).toBe(calls)
    const next = c.events.events.length
    c.mic.say(ask())
    expect((await c.events.waitFor('session', 5000, next)).fresh).toBe(true)
  })
})

// These two read the backend's "who is listening for what" state, so each gets a backend of its own
// (a wake word alone arms a 15 s window, and every answer opens a 45 s follow-up window).
describe('a wake word alone', () => {
  const c = useConversation()

  test('is "armed", and nothing is asked yet', async () => {
    c.mic.say('นีโอ')
    await c.events.waitFor('armed')
    await c.events.expectNone('thinking', 400)
  })
})

describe('speech without the wake word', () => {
  const c = useConversation()

  test('is only heard, never asked', async () => {
    const from = c.events.events.length
    c.mic.say('วันนี้อากาศดีจังเลยนะ')
    await c.events.waitFor('heard')
    await c.events.expectNone((e) => e.type === 'thinking' || e.type === 'card', 500, from)
  })
})

describe('cancelling and interrupting', () => {
  const c = useConversation()

  test('saying "ยกเลิก" while thinking kills claude and says "cancelled"', async () => {
    c.mic.say(ask('@slow'))
    await c.events.waitFor('thinking')
    await Bun.sleep(500) // let claude start
    c.mic.say('ยกเลิก')
    await c.events.waitFor('cancelled')
    expect(c.events.types).not.toContain('card')
    for (let i = 0; i < 30; i++) {
      if ((await c.s.backend.claudeLog()).some((e) => e.event === 'sigterm')) return
      await Bun.sleep(100)
    }
    throw new Error('claude was never told to stop')
  })

  test('anything else said while thinking is "ignored"', async () => {
    c.mic.say(ask('@slow'))
    await c.events.waitFor('thinking')
    c.mic.say('พูดอะไรสักอย่างระหว่างรอ')
    expect(await c.events.waitFor('ignored')).toMatchObject({ text: 'พูดอะไรสักอย่างระหว่างรอ' })
    c.mic.say('ยกเลิก')
    await c.events.waitFor('cancelled')
  })
})

describe('fast phrases never reach the brain', () => {
  const c = useConversation()
  const claudeCalls = async () => (await c.s.backend.claudeLog()).filter((e) => e.event === 'call').length

  test('feeding: "นีโอ ให้ปลาหน่อย" -> feed fish', async () => {
    const before = await claudeCalls()
    c.mic.say('นีโอ ให้ปลาหน่อย')
    expect(await c.events.waitFor('feed')).toMatchObject({ food: 'fish' })
    expect(await claudeCalls()).toBe(before)
  })

  test('"นีโอ หิวไหม" -> pet_ask', async () => {
    c.mic.say('นีโอ หิวไหม')
    await c.events.waitFor('pet_ask')
    await c.events.expectNone('thinking', 300)
  })

  test('"นีโอ ไปนอนได้แล้ว" -> sleep', async () => {
    c.mic.say('นีโอ ไปนอนได้แล้ว')
    await c.events.waitFor('sleep')
    await c.events.expectNone('thinking', 300)
  })

  test('"นีโอ สลับไปใช้ Claude Code" switches the brain with a card and a provider event', async () => {
    const before = await claudeCalls()
    c.mic.say('นีโอ สลับไปใช้ Claude Code')
    expect(await c.events.waitFor('provider')).toMatchObject({ name: 'claude', label: 'Claude Code' })
    await c.events.waitFor('card')
    expect(await claudeCalls()).toBe(before)
  })
})

describe('the brain asks to schedule something or to run a skill', () => {
  const c = useConversation()

  test('a schedule intent becomes a confirm card; "ตกลง" sets it and says so', async () => {
    c.mic.say(ask('@intent:schedule'))
    await c.events.waitFor('card')
    const confirm = lastCard(c.events)
    expect(confirm.title).toBe('ตั้งเตือนไหม?')
    expect(confirm.lines.join(' ')).toContain('ตกลง')
    expect(c.events.types).not.toContain('schedule') // nothing is set yet

    const seen = c.events.events.length
    c.mic.say('ตกลง')
    expect(await c.events.waitFor('schedule', 5000, seen)).toMatchObject({ action: 'add', title: 'ทดสอบปลุก', when: expect.any(String) })
    await c.events.waitFor((e) => e.type === 'card' && e.card.title === 'ตั้งแล้ว', 5000, seen)
  })

  test('"ยกเลิก" instead of "ตกลง" sets nothing', async () => {
    c.mic.say(ask('@intent:schedule'))
    await c.events.waitFor('card')
    const seen = c.events.events.length
    c.mic.say('ยกเลิก')
    await c.events.waitFor('cancelled', 5000, seen)
    await c.events.expectNone('schedule', 300, seen)
  })

  test('a skill intent becomes a confirm card; "ตกลง" runs it in a fresh claude (sonnet, no resume)', async () => {
    c.mic.say(ask('@intent:skill'))
    await c.events.waitFor('card')
    expect(lastCard(c.events).lines.join(' ')).toContain('ตกลง')

    const seen = c.events.events.length
    c.mic.say('ตกลง')
    expect(await c.events.waitFor('thinking', 5000, seen)).toMatchObject({ text: 'ทำเดโมให้ดู' })
    await c.events.waitFor('card', 5000, seen)
    const call = (await c.s.backend.claudeLog()).filter((e) => e.event === 'call').at(-1)!
    expect(call.argv).toEqual(expect.arrayContaining(['--model', 'sonnet', '--permission-mode', 'bypassPermissions']))
    expect(call.argv).not.toContain('--resume')
    expect(call.prompt).toContain('ทำเดโม')
  })
})

describe('amended contract: "ping" inside a payload', () => {
  const c = useConversation()

  divergent('ping-token-escaped', 'a card whose text is "ping" is not mistaken for the keep-alive by NeoApp\'s line filter', async () => {
    // typed when the backend can (NeoCli's voice path is a later ticket than its ping escape)
    if (c.s.backend.say) await c.s.backend.say(ask('@card:ping'))
    else c.mic.say(ask('@card:ping'))
    await c.events.waitFor((e) => e.type === 'card')
    const line = c.events.raw.find((l) => JSON.parse(l).type === 'card')!
    // NeoApp (Link.kt) drops any line that contains the JSON token "ping"
    expect(line.includes('"ping"')).toBe(false)
    // the receiver still reads the same text once it decodes the JSON
    const card = JSON.parse(line).card
    expect(card.title).toBe('ping')
    expect(card.lines).toEqual(['ping'])
  })

  test('the real keep-alive stays exactly {"type":"ping"}', async () => {
    const stream = await c.s.phone.events()
    await stream.waitFor('ping', 20000)
    expect(stream.raw.filter((l) => l.includes('"ping"'))).toEqual(['{"type":"ping"}'])
    await stream.close()
  }, 30000)
})
