import { expect } from 'bun:test'
import { describe, divergent, test, useBackend } from '../src/harness.ts'
import { Phone } from '../src/phone.ts'

const FACE_KEYS = ['fg', 'accent', 'cheek', 'bg']
const PHONE_POSTS = ['/api/arm', '/api/alarm/stop', '/api/dream/seen', '/api/pet', '/api/wakeup']

describe('open routes (no token needed)', () => {
  const s = useBackend()

  test('GET /api/hello says it is Neo, with the pet name and face colours', async () => {
    const res = await s.anon.get('/api/hello')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('application/json')
    expect(res.json.app).toBe('neo')
    expect(typeof res.json.name).toBe('string')
    expect(typeof res.json.paired).toBe('boolean')
    expect(Object.keys(res.json.face).sort()).toEqual([...FACE_KEYS].sort())
    for (const colour of Object.values(res.json.face)) expect(colour).toMatch(/^#[0-9a-f]{6}$/i)
  })

  test('GET /neo.apk serves the APK without a token', async () => {
    const res = await fetch(s.backend.baseUrl + '/neo.apk', { headers: s.backend.phoneHeaders })
    if (!s.backend.apk) return expect([200, 404]).toContain(res.status)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/vnd.android.package-archive')
    expect(res.headers.get('content-disposition')).toContain('neo.apk')
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(s.backend.apk)
  })
})

describe('pairing', () => {
  const s = useBackend()
  const attempt = (code: string, name = 'Contract Phone') => s.anon.post('/api/pair', { code, name })

  test('a good code returns a 48-hex token, an id and the pet name', async () => {
    const code = await s.backend.getPairingCode()
    expect(code).toMatch(/^\d{6}$/)
    const res = await attempt(code)
    expect(res.status).toBe(200)
    expect(res.json.token).toMatch(/^[0-9a-f]{48}$/)
    expect(typeof res.json.id).toBe('string')
    expect(typeof res.json.name).toBe('string')
  })

  test('a code works once', async () => {
    const code = await s.backend.getPairingCode()
    expect((await attempt(code)).status).toBe(200)
    const again = await attempt(code)
    expect(again.status).toBe(400)
    expect(typeof again.json.error).toBe('string')
  })

  test('a wrong code is a 400 with a message, and the real code still works afterwards', async () => {
    const code = await s.backend.getPairingCode()
    const wrong = code === '000000' ? '000001' : '000000'
    const bad = await attempt(wrong)
    expect(bad.status).toBe(400)
    expect(typeof bad.json.error).toBe('string')
    expect((await attempt(code)).status).toBe(200)
  })

  test('a new code replaces the previous one', async () => {
    const first = await s.backend.getPairingCode()
    const second = await s.backend.getPairingCode()
    expect((await attempt(first)).status).toBe(400)
    expect((await attempt(second)).status).toBe(200)
  })

  test('after 5 wrong tries the code is burned, even the right one', async () => {
    const code = await s.backend.getPairingCode()
    const wrong = code === '000000' ? '000001' : '000000'
    for (let i = 0; i < 5; i++) await attempt(wrong)
    expect((await attempt(code)).status).toBe(400)
  })

  test('with no code requested, pairing is refused', async () => {
    // spend whatever code is active, then try an arbitrary one
    const code = await s.backend.getPairingCode()
    await attempt(code)
    expect((await attempt('123456')).status).toBe(400)
  })

  test('pairing announces itself to listening phones as a paired event', async () => {
    const watcher = await s.phone.events()
    await s.pair('Second Phone')
    const event = await watcher.waitFor('paired')
    expect(event.name).toBe('Second Phone')
    await watcher.close()
  })
})

describe('phone routes need a device token', () => {
  const s = useBackend()
  const stranger = () => new Phone(s.backend, 'f'.repeat(48))

  test('a paired token opens the event stream', async () => {
    const stream = await s.phone.events()
    expect(stream.status).toBe(200)
    await stream.close()
  })

  test('GET /api/events with no token is 401 with a message (NeoApp reads this as "unpaired")', async () => {
    const stream = await s.anon.events()
    expect(stream.status).toBe(401)
    expect(typeof JSON.parse(stream.body).error).toBe('string')
  })

  test('GET /api/events with an unknown token is 401', async () => {
    expect((await stranger().events()).status).toBe(401)
  })

  for (const path of PHONE_POSTS) {
    test(`POST ${path} with no token is 401`, async () => {
      const res = await s.anon.post(path)
      expect(res.status).toBe(401)
      expect(typeof res.json.error).toBe('string')
    })
    test(`POST ${path} with an unknown token is 401`, async () => {
      expect((await stranger().post(path)).status).toBe(401)
    })
  }

  test('POST /api/audio with no token is 401', async () => {
    const res = await s.anon.audio().end()
    expect(res.status).toBe(401)
  })

  test('a token that was valid in one backend life stays valid for the same device', async () => {
    const second = await s.pair('Another')
    for (const phone of [second, s.phone]) {
      const stream = await phone.events()
      expect(stream.status).toBe(200)
      await stream.close()
    }
  })
})

// The amended contract (spec §4.1): port 8000 has no localhost shortcut and serves only NeoApp's routes.
describe('amended contract: token on every phone route, even from localhost', () => {
  const s = useBackend()
  const bare = () => new Phone({ ...s.backend, phoneHeaders: {} }) // exactly what a process on the Mac sends

  divergent('localhost-needs-token', 'GET /api/events from localhost without a token is 401', async () => {
    expect((await bare().events()).status).toBe(401)
  })

  divergent('localhost-needs-token', 'POST /api/face from localhost without a token does not change the face', async () => {
    const before = (await s.anon.get('/api/hello')).json.face
    const res = await bare().post('/api/face', { fg: '#123456' })
    expect([401, 403, 404]).toContain(res.status)
    expect((await s.anon.get('/api/hello')).json.face).toEqual(before)
  })

  for (const path of PHONE_POSTS) {
    divergent('localhost-needs-token', `POST ${path} from localhost without a token is 401`, async () => {
      expect((await bare().post(path)).status).toBe(401)
    })
  }

  divergent('localhost-needs-token', 'POST /api/audio from localhost without a token is 401', async () => {
    expect((await bare().audio().end()).status).toBe(401)
  })

  divergent('phone-port-only-neoapp-routes', 'POST /api/ask is 404 for a paired phone', async () => {
    expect((await s.phone.post('/api/ask', { text: 'hello' })).status).toBe(404)
  })

  divergent('phone-port-only-neoapp-routes', 'POST /api/cancel is 404 for a paired phone', async () => {
    expect((await s.phone.post('/api/cancel')).status).toBe(404)
  })

  divergent('phone-port-only-neoapp-routes', 'an unknown path is a 404 {error} for a paired phone', async () => {
    const res = await s.phone.get('/api/nothing-here')
    expect(res.status).toBe(404)
    expect(typeof res.json.error).toBe('string')
  })

  test('Mac-only routes (say, pairing start, doctor) never answer 200 to a paired phone', async () => {
    for (const [method, path] of [['POST', '/api/say'], ['POST', '/api/pair/start'], ['GET', '/api/doctor']] as const) {
      const res = await s.phone.request(method, path, method === 'POST' ? { text: 'x' } : undefined)
      expect(res.status, `${method} ${path}`).toBeGreaterThanOrEqual(400)
    }
  })
})
