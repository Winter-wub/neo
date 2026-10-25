import { expect } from 'bun:test'
import { describe, test, useBackend } from '../src/harness.ts'
import { phrase } from '../src/pcm.ts'

/** Say something to Neo the way NeoApp does: PCM on /api/audio, the fake STT hears `text`. */
async function speak(s: ReturnType<typeof useBackend>, upload: ReturnType<typeof s.phone.audio>, text: string) {
  s.backend.stt.reply(text)
  upload.write(phrase())
}

describe('POST /api/arm', () => {
  const s = useBackend()

  test('answers {ok:true}', async () => {
    const res = await s.phone.post('/api/arm')
    expect(res.status).toBe(200)
    expect(res.json).toEqual({ ok: true })
  })

  test('the next sentence needs no wake word', async () => {
    const stream = await s.phone.events()
    await stream.waitFor('hello')
    await s.phone.post('/api/arm')
    const upload = s.phone.audio()
    s.backend.stt.reply('ขอดูหน่อยว่ามีอะไรบ้าง')
    // armed => listen mode: the sentence ends after 3 s of quiet (30 frames), not 0.9 s
    upload.write(phrase(6, 32))
    await stream.waitFor((e) => e.type === 'heard' && e.text === 'ขอดูหน่อยว่ามีอะไรบ้าง')
    const asked = await stream.waitFor('thinking')
    expect(asked.text).toBe('ขอดูหน่อยว่ามีอะไรบ้าง')
    await stream.waitFor('card')
    upload.destroy()
    await stream.close()
  })
})

describe('POST /api/pet', () => {
  const s = useBackend()

  test('stores hunger and affection and announces a pet event', async () => {
    const stream = await s.phone.events()
    await stream.waitFor('hello')
    const res = await s.phone.post('/api/pet', { hunger: 0.4, affection: 0.9 })
    expect(res.status).toBe(200)
    expect(res.json).toEqual({ ok: true })
    const pet = await stream.waitFor('pet')
    expect(pet).toMatchObject({ hunger: 0.4, affection: 0.9 })
    expect(typeof pet.at).toBe('number')
    await stream.close()
  })

  test('clamps to 0..1', async () => {
    const stream = await s.phone.events()
    await stream.waitFor('hello')
    await s.phone.post('/api/pet', { hunger: 5, affection: -3 })
    expect(await stream.waitFor('pet')).toMatchObject({ hunger: 1, affection: 0 })
    await stream.close()
  })
})

describe('POST /api/wakeup', () => {
  const s = useBackend()

  test('without a deep sleep pending says dreamCancelled:false', async () => {
    const stream = await s.phone.events()
    await stream.waitFor('hello')
    const res = await s.phone.post('/api/wakeup')
    expect(res.status).toBe(200)
    expect(res.json).toEqual({ ok: true })
    expect(await stream.waitFor('wakeup')).toMatchObject({ dreamCancelled: false })
    await stream.close()
  })

  test('after "นีโอ ไปนอน" (deep sleep) it cancels the pending dream', async () => {
    const stream = await s.phone.events()
    await stream.waitFor('hello')
    const upload = s.phone.audio()
    await speak(s, upload, 'นีโอ ไปนอนได้แล้ว')
    await stream.waitFor('sleep')
    await s.phone.post('/api/wakeup')
    expect(await stream.waitFor('wakeup')).toMatchObject({ dreamCancelled: true })
    // a second tap has nothing left to cancel
    await s.phone.post('/api/wakeup')
    await Bun.sleep(300)
    expect(stream.events.filter((e) => e.type === 'wakeup').map((e) => e.dreamCancelled)).toEqual([true, false])
    upload.destroy()
    await stream.close()
  })
})

describe('POST /api/dream/seen', () => {
  const s = useBackend()

  test('answers {ok:true} even when there is no dream', async () => {
    const res = await s.phone.post('/api/dream/seen')
    expect(res.status).toBe(200)
    expect(res.json).toEqual({ ok: true })
  })
})

describe('POST /api/alarm/stop', () => {
  const s = useBackend()

  test('with nothing ringing says stopped:false', async () => {
    const res = await s.phone.post('/api/alarm/stop')
    expect(res.status).toBe(200)
    expect(res.json).toEqual({ stopped: false })
  })

  test('a ringing alarm shows in events and in the next hello; a tap stops it', async () => {
    const stream = await s.phone.events()
    await stream.waitFor('hello')
    const alarm = await s.backend.ringAlarm()
    const rang = await stream.waitFor('alarm')
    expect(rang).toMatchObject({ id: alarm.id, title: alarm.title })
    expect(rang.card).toMatchObject({ layout: 'big', icon: 'clock', title: alarm.title })
    expect(rang.card.big).toMatch(/^\d\d:\d\d$/)

    const late = await s.phone.events()
    expect((await late.waitFor('hello')).ringing).toBe(alarm.title)
    await late.close()

    const res = await s.phone.post('/api/alarm/stop', {})
    expect(res.json).toEqual({ stopped: true })
    expect(await stream.waitFor('alarm_off')).toMatchObject({ id: alarm.id, why: 'แตะปิด' })

    expect((await s.phone.post('/api/alarm/stop', {})).json).toEqual({ stopped: false })
    await stream.close()
  })

  test('{snooze:N} stops it as "เลื่อน" and rings again later', async () => {
    const stream = await s.phone.events()
    await stream.waitFor('hello')
    const alarm = await s.backend.ringAlarm()
    await stream.waitFor('alarm')
    const res = await s.phone.post('/api/alarm/stop', { snooze: 10 })
    expect(res.json).toEqual({ stopped: true })
    expect(await stream.waitFor('alarm_off')).toMatchObject({ id: alarm.id, why: 'เลื่อน', snooze: 10 })
    await stream.close()
  })

  test('a snooze longer than an hour is capped at 60 minutes', async () => {
    const stream = await s.phone.events()
    await stream.waitFor('hello')
    await s.backend.ringAlarm()
    await stream.waitFor('alarm')
    await s.phone.post('/api/alarm/stop', { snooze: 999 })
    expect((await stream.waitFor('alarm_off')).snooze).toBe(60)
    await stream.close()
  })

  test('saying "หยุด" while it rings stops it too; "ขออีก 7 นาที" snoozes', async () => {
    const stream = await s.phone.events()
    await stream.waitFor('hello')
    const upload = s.phone.audio()

    await s.backend.ringAlarm()
    await stream.waitFor('alarm')
    await speak(s, upload, 'หยุด')
    expect(await stream.waitFor('alarm_off')).toMatchObject({ why: 'ปิด' })

    const second = stream.events.length
    await s.backend.ringAlarm()
    await stream.waitFor('alarm', 5000, second)
    await speak(s, upload, 'ขออีก 7 นาที')
    expect(await stream.waitFor((e) => e.type === 'alarm_off' && e.why === 'เลื่อน')).toMatchObject({ snooze: 7 })
    upload.destroy()
    await stream.close()
  })
})

describe('bodies', () => {
  const s = useBackend()

  test('malformed JSON is a 400 with an error message', async () => {
    const res = await s.phone.post('/api/pet', '{not json')
    expect(res.status).toBe(400)
    expect(typeof res.json.error).toBe('string')
  })

  test('an empty body counts as {}', async () => {
    const res = await s.phone.request('POST', '/api/arm')
    expect(res.status).toBe(200)
  })

  test('a body over 20000 bytes is never answered with success', async () => {
    const outcome = await s.phone.post('/api/pet', { hunger: 0.1, junk: 'x'.repeat(21000) }).then(
      (r) => r.status,
      () => 'closed',
    )
    expect(outcome === 'closed' || outcome >= 400).toBe(true)
  })
})
