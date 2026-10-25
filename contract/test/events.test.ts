import { expect } from 'bun:test'
import { describe, test, useBackend } from '../src/harness.ts'

describe('GET /api/events', () => {
  const s = useBackend()

  test('is an NDJSON stream that opens with a hello', async () => {
    const stream = await s.phone.events()
    expect(stream.status).toBe(200)
    expect(stream.headers.get('content-type')).toContain('application/x-ndjson')
    const hello = await stream.waitFor('hello')
    expect(stream.events[0]).toBe(hello)
    expect(typeof hello.thinking).toBe('boolean')
    expect(hello.thinking).toBe(false)
    expect(typeof hello.provider).toBe('string')
    expect(typeof hello.name).toBe('string')
    expect(Object.keys(hello.face).sort()).toEqual(['accent', 'bg', 'cheek', 'fg'])
    expect(hello.idle).toEqual({ sleepAfter: expect.any(Number), clock: expect.any(Boolean) })
    expect(hello.ringing).toBeNull()
    expect(hello.at).toBeUndefined()
    await stream.close()
  })

  test('every new connection gets its own hello', async () => {
    const [a, b] = [await s.phone.events(), await s.phone.events()]
    await a.waitFor('hello')
    await b.waitFor('hello')
    await Promise.all([a.close(), b.close()])
  })

  test('every event written by the backend carries a millisecond "at"', async () => {
    const stream = await s.phone.events()
    await stream.waitFor('hello')
    const before = Date.now()
    await s.phone.post('/api/pet', { hunger: 0.5, affection: 0.5 })
    const pet = await stream.waitFor('pet')
    expect(pet.at).toBeGreaterThanOrEqual(before - 1000)
    expect(pet.at).toBeLessThanOrEqual(Date.now() + 1000)
    await stream.close()
  })

  test('events go to every listener, identically', async () => {
    const [a, b] = [await s.phone.events(), await s.phone.events()]
    await Promise.all([a.waitFor('hello'), b.waitFor('hello')])
    await s.phone.post('/api/pet', { hunger: 0.25, affection: 0.75 })
    const [petA, petB] = await Promise.all([a.waitFor('pet'), b.waitFor('pet')])
    expect(petA).toEqual(petB)
    expect(a.rawOf('pet')).toBe(b.rawOf('pet'))
    await Promise.all([a.close(), b.close()])
  })

  test('a ping, exactly {"type":"ping"}, arrives every 15 s so the stream is never idle-cut', async () => {
    const stream = await s.phone.events()
    await stream.waitFor('hello')
    const started = Date.now()
    await stream.waitFor('ping', 20000)
    expect(Date.now() - started).toBeGreaterThan(10000)
    expect(stream.raw).toContain('{"type":"ping"}')
    await stream.close()
  }, 30000)

  test('the stream stays open for longer than a default HTTP idle timeout', async () => {
    const stream = await s.phone.events()
    await stream.waitFor('hello')
    await Bun.sleep(12000)
    await s.phone.post('/api/pet', { hunger: 0.1, affection: 0.1 })
    await stream.waitFor('pet', 3000)
    await stream.close()
  }, 30000)
})

describe('a dream that nobody has seen yet', () => {
  const s = useBackend()

  test('is re-sent as dream_done right after hello on every connect, until POST /api/dream/seen', async () => {
    await s.backend.makeDream()

    for (let connect = 1; connect <= 2; connect++) {
      const stream = await s.phone.events()
      const dream = await stream.waitFor('dream_done')
      expect(stream.types.slice(0, 2)).toEqual(['hello', 'dream_done'])
      expect(dream.card.dream).toBe(true)
      expect(dream.card.title).toBe('ฝันแล้ว')
      expect(dream.card.lines).toContain('ฝันถึงปลาทอง')
      expect(typeof dream.at).toBe('number')
      await stream.close()
    }

    const seen = await s.phone.post('/api/dream/seen')
    expect(seen.status).toBe(200)
    expect(seen.json).toEqual({ ok: true })

    const after = await s.phone.events()
    await after.waitFor('hello')
    await after.expectNone('dream_done', 700)
    await after.close()
  })
})
