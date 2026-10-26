// Ticket 24: a paired phone can do over port 8000 what Neo Console does through the neo command.
// Routes are the command-socket routes under /api (same bodies, same replies). Spec §4.1 amendment 2026-10-26.
import { expect } from 'bun:test'
import { describe, divergent, test, useBackend } from '../src/harness.ts'
import type { Phone } from '../src/phone.ts'

const SECRET = 'sk-contract-SECRET-0123456789'

/** Every route this ticket puts on the phone port: [method, path]. */
const SETTINGS_ROUTES = [
  ['GET', '/api/status'],
  ['GET', '/api/settings'], ['POST', '/api/settings'], ['POST', '/api/settings/set'],
  ['GET', '/api/devices'], ['POST', '/api/devices/revoke'],
  ['GET', '/api/providers'], ['POST', '/api/providers/use'], ['POST', '/api/providers/discover'],
  ['GET', '/api/providers/config'], ['POST', '/api/providers/config'],
  ['POST', '/api/models/list'], ['POST', '/api/models/use'],
  ['GET', '/api/name'], ['POST', '/api/name/set'], ['POST', '/api/name/train'], ['POST', '/api/name/train/cancel'],
  ['GET', '/api/face'], ['POST', '/api/face'],
  ['GET', '/api/jobs'], ['POST', '/api/jobs/parse'], ['POST', '/api/jobs/add'], ['POST', '/api/jobs/edit'],
  ['POST', '/api/jobs/enable'], ['POST', '/api/jobs/remove'], ['POST', '/api/jobs/test'],
  ['GET', '/api/memory'], ['POST', '/api/memory'], ['POST', '/api/memory/add'], ['POST', '/api/memory/forget'],
  ['GET', '/api/journal'], ['POST', '/api/journal/show'], ['POST', '/api/journal/forget'],
  ['GET', '/api/dream'], ['POST', '/api/dream/now'], ['POST', '/api/dream/enable'],
  ['GET', '/api/dreams'], ['POST', '/api/dreams/show'], ['POST', '/api/dreams/rm'],
] as const

/** What stays Mac-only (command socket): sending speech, cancel, pairing, doctor, bulk wipes, raw file edits. */
const MAC_ONLY_ROUTES = [
  ['POST', '/api/say'], ['POST', '/api/pair/start'], ['POST', '/api/devices/pair'], ['GET', '/api/doctor'],
  ['POST', '/api/memory/clear'], ['POST', '/api/journal/clear'], ['POST', '/api/dreams/clear'], ['POST', '/api/jobs/clear'],
  ['GET', '/api/daemon/info'],
] as const

const nowMs = () => Date.now()

/** Change something as `phone`, and see it arrive on `watcher`'s stream. */
async function watch(s: ReturnType<typeof useBackend>) {
  const watcher = await s.pair('Watcher')
  const stream = await watcher.events()
  await stream.waitFor('hello')
  return stream
}

describe('phone settings API: access', () => {
  const s = useBackend()

  for (const [method, path] of SETTINGS_ROUTES) {
    test(`${method} ${path} without a device token is 401`, async () => {
      const res = await s.anon.request(method, path, method === 'POST' ? {} : undefined)
      expect(res.status).toBe(401)
      expect(typeof res.json.error).toBe('string')
    })
  }

  for (const [method, path] of MAC_ONLY_ROUTES) {
    divergent('phone-settings-api', `${method} ${path} stays off the phone port (404 even with a token)`, async () => {
      const res = await s.phone.request(method, path, method === 'POST' ? {} : undefined)
      expect(res.status, `${method} ${path}`).toBe(404)
    })
  }

  divergent('phone-settings-api', 'every phone-port route with a token is a real route (not 401/403, not "not found")', async () => {
    for (const [method, path] of SETTINGS_ROUTES) {
      if (path === '/api/devices/revoke' || path === '/api/dream/now' || path === '/api/jobs/test' || path === '/api/name/train') continue
      const res = await s.phone.request(method, path, method === 'POST' ? {} : undefined)
      expect([401, 403], `${method} ${path} -> ${res.text}`).not.toContain(res.status)
      if (res.status === 404) expect(res.json?.error, `${method} ${path} is not a route`).not.toBe('not found')
    }
  })
})

describe('phone settings API: status and settings', () => {
  const s = useBackend()

  divergent('phone-settings-api', 'GET /api/status has provider, thinking, ringing, bypass, requireName, pid', async () => {
    const res = await s.phone.get('/api/status')
    expect(res.status).toBe(200)
    expect(res.json).toMatchObject({ phone: expect.any(Boolean), provider: expect.any(String), thinking: false, ringing: false, busy: false, bypass: expect.any(Boolean), requireName: expect.any(Boolean) })
    expect(typeof res.json.pid).toBe('number')
  })

  divergent('phone-settings-api', 'GET /api/settings lists every setting', async () => {
    const res = await s.phone.get('/api/settings')
    expect(res.status).toBe(200)
    for (const key of ['requireName', 'followUp', 'bypass', 'tailscale', 'lan', 'idle', 'dream', 'onboarded', 'claudeConfigDir', 'home', 'mcpServers']) expect(res.json, key).toHaveProperty(key)
    expect(res.json.idle).toEqual({ sleepAfter: expect.any(Number), clock: expect.any(Boolean) })
    expect(res.json.home).toMatchObject({ city: expect.any(String), lat: expect.any(Number), lon: expect.any(Number) })
  })

  divergent('phone-settings-api', 'POST /api/settings/set changes a boolean (bypass too) and the other phone hears a settings event', async () => {
    const stream = await watch(s)
    for (const name of ['requireName', 'followUp', 'bypass', 'dream', 'onboarded', 'lan']) {
      const before = (await s.phone.get('/api/settings')).json[name] as boolean
      const from = stream.events.length
      const res = await s.phone.post('/api/settings/set', { name, args: [String(!before)] })
      expect(res.status, `${name}: ${res.text}`).toBe(200)
      expect(res.json[name]).toBe(!before)
      const event = await stream.waitFor((e) => e.type === 'settings' && e[name] === !before, 5000, from)
      expect(typeof event.at).toBe('number')
      expect((await s.phone.get('/api/settings')).json[name]).toBe(!before)
    }
    await stream.close()
  })

  divergent('phone-settings-api', 'idle.sleepAfter / idle.clock change the idle behaviour and publish idle', async () => {
    const stream = await watch(s)
    const res = await s.phone.post('/api/settings/set', { name: 'idle.sleepAfter', args: ['600'] })
    expect(res.status).toBe(200)
    expect(res.json.idle.sleepAfter).toBe(600)
    expect(await stream.waitFor((e) => e.type === 'idle' && e.sleepAfter === 600)).toMatchObject({ clock: expect.any(Boolean) })
    await s.phone.post('/api/settings/set', { name: 'idle.clock', args: ['false'] })
    await stream.waitFor((e) => e.type === 'idle' && e.clock === false)
    await stream.close()
  })

  divergent('phone-settings-api', 'POST /api/settings applies a patch, including a partial idle', async () => {
    const res = await s.phone.post('/api/settings', { followUp: false, idle: { sleepAfter: 300 } })
    expect(res.status).toBe(200)
    expect(res.json).toMatchObject({ followUp: false, idle: { sleepAfter: 300 } })
  })

  divergent('phone-settings-api', 'claudeConfigDir, home and mcpServers can be set and unset', async () => {
    let res = await s.phone.post('/api/settings/set', { name: 'claudeConfigDir', args: ['/tmp/contract-claude'] })
    expect(res.json.claudeConfigDir).toBe('/tmp/contract-claude')
    res = await s.phone.post('/api/settings/set', { name: 'claudeConfigDir', args: ['unset'] })
    expect(res.json.claudeConfigDir).toBeNull()
    res = await s.phone.post('/api/settings/set', { name: 'home', args: ['เชียงใหม่', '18.79', '98.98'] })
    expect(res.json.home).toEqual({ city: 'เชียงใหม่', lat: 18.79, lon: 98.98 })
    res = await s.phone.post('/api/settings/set', { name: 'mcpServers', args: ['peekaboo,orca'] })
    expect(res.json.mcpServers).toEqual(['peekaboo', 'orca'])
  })

  divergent('phone-settings-api', 'a bad value is a 400 with a message and nothing changes', async () => {
    const before = (await s.phone.get('/api/settings')).json
    const res = await s.phone.post('/api/settings/set', { name: 'bypass', args: ['maybe'] })
    expect(res.status).toBe(400)
    expect(typeof res.json.error).toBe('string')
    expect((await s.phone.get('/api/settings')).json).toEqual(before)
    expect((await s.phone.post('/api/settings/set', { name: 'nope', args: ['1'] })).status).toBe(400)
  })

  divergent('phone-settings-api', 'invalid JSON is a 400', async () => {
    const res = await s.phone.request('POST', '/api/settings', '{not json')
    expect(res.status).toBe(400)
  })
})

describe('phone settings API: brains, keys and models', () => {
  const s = useBackend()
  const config = { type: 'openai', label: 'Contract LLM', baseUrl: 'http://127.0.0.1:9/v1', model: 'm-one', models: { fast: 'm-two' } }

  /** Nothing the phone can read may contain the key. */
  async function expectNoKey(phone: Phone) {
    for (const path of ['/api/providers', '/api/providers/config', '/api/settings', '/api/status']) {
      const res = await phone.get(path)
      expect(res.text, path).not.toContain(SECRET)
    }
  }

  divergent('phone-settings-api', 'GET /api/providers lists the brains and the current one', async () => {
    const res = await s.phone.get('/api/providers')
    expect(res.status).toBe(200)
    expect(res.json.current).toBe('claude')
    expect(res.json.list.find((p: any) => p.name === 'claude')).toMatchObject({ label: expect.any(String), found: expect.any(Boolean) })
  })

  divergent('phone-settings-api', 'a custom provider with an API key is added; the key never comes back, only "has key"', async () => {
    const res = await s.phone.post('/api/providers/config', { name: 'contract-llm', cfg: config, apiKey: SECRET })
    expect(res.status, res.text).toBe(200)
    expect(res.json).toEqual({ ok: true })
    const view = (await s.phone.get('/api/providers/config')).json
    expect(view.keys['contract-llm']).toBe(true)
    expect(view.overrides['contract-llm']).toMatchObject({ baseUrl: config.baseUrl, model: 'm-one' })
    expect(JSON.stringify(view.overrides['contract-llm'])).not.toContain(SECRET)
    await expectNoKey(s.phone)
    expect((await s.phone.get('/api/providers')).json.list.some((p: any) => p.name === 'contract-llm')).toBe(true)
  })

  divergent('phone-settings-api', 'the key is also absent from the events other phones receive', async () => {
    const stream = await watch(s)
    await s.phone.post('/api/providers/config', { name: 'contract-llm', cfg: { ...config, label: 'Contract LLM 2' }, apiKey: SECRET })
    await s.phone.post('/api/providers/use', { name: 'contract-llm' })
    await stream.waitFor('provider')
    await Bun.sleep(200)
    expect(stream.raw.join('\n')).not.toContain(SECRET)
    await s.phone.post('/api/providers/use', { name: 'claude' })
    await stream.close()
  })

  divergent('phone-settings-api', 'switching brain publishes provider and answers with the card', async () => {
    const stream = await watch(s)
    const res = await s.phone.post('/api/providers/use', { name: 'contract-llm' })
    expect(res.status, res.text).toBe(200)
    expect(res.json.current).toBe('contract-llm')
    expect(res.json.card).toMatchObject({ layout: expect.any(String), lines: expect.any(Array) })
    expect(await stream.waitFor('provider')).toMatchObject({ name: 'contract-llm', label: expect.any(String) })
    expect((await s.phone.get('/api/status')).json.provider).toBe('Contract LLM 2') // status shows the label
    await stream.close()
  })

  divergent('phone-settings-api', 'models: list the brain\'s models and pick one (publishes model)', async () => {
    const stream = await watch(s)
    const list = await s.phone.post('/api/models/list', { name: 'contract-llm' })
    expect(list.status).toBe(200)
    expect(list.json.name).toBe('contract-llm')
    expect(list.json.mapped).toEqual([{ alias: 'fast', id: 'm-two' }])
    const use = await s.phone.post('/api/models/use', { name: 'contract-llm', model: 'fast' })
    expect(use.status, use.text).toBe(200)
    expect(use.json.card).toBeDefined()
    expect(await stream.waitFor('model')).toMatchObject({ name: 'contract-llm' })
    expect((await s.phone.get('/api/status')).json.model).toBe('fast')
    await s.phone.post('/api/models/use', { name: 'contract-llm', model: null })
    await stream.close()
  })

  divergent('phone-settings-api', 'POST /api/providers/discover answers a list', async () => {
    const res = await s.phone.post('/api/providers/discover')
    expect(res.status).toBe(200)
    expect(Array.isArray(res.json)).toBe(true)
  })

  divergent('phone-settings-api', 'an unknown brain is a 400', async () => {
    const res = await s.phone.post('/api/providers/use', { name: 'no-such-brain' })
    expect(res.status).toBe(400)
    expect(typeof res.json.error).toBe('string')
  })

  divergent('phone-settings-api', 'a provider is removed again', async () => {
    await s.phone.post('/api/providers/use', { name: 'claude' })
    const res = await s.phone.post('/api/providers/config', { name: 'contract-llm', remove: true })
    expect(res.status, res.text).toBe(200)
    expect((await s.phone.get('/api/providers')).json.list.some((p: any) => p.name === 'contract-llm')).toBe(false)
    expect((await s.phone.get('/api/providers/config')).json.keys['contract-llm'] ?? false).toBe(false)
    await expectNoKey(s.phone)
  })
})

describe('phone settings API: pet name, wake word and face', () => {
  const s = useBackend()

  divergent('phone-settings-api', 'POST /api/face changes colours and publishes face; GET reads them', async () => {
    const stream = await watch(s)
    const res = await s.phone.post('/api/face', { accent: '#112233' })
    expect(res.status).toBe(200)
    expect(res.json.accent).toBe('#112233')
    expect(await stream.waitFor('face')).toMatchObject({ accent: '#112233' })
    expect((await s.phone.get('/api/face')).json).toEqual(res.json)
    expect((await s.anon.get('/api/hello')).json.face.accent).toBe('#112233')
    await stream.close()
  })

  divergent('phone-settings-api', 'POST /api/name/set renames the pet and publishes wake', async () => {
    const stream = await watch(s)
    const res = await s.phone.post('/api/name/set', { name: 'โมจิ', variants: ['โมจิ', 'โหมจิ'] })
    expect(res.status, res.text).toBe(200)
    expect(res.json).toMatchObject({ name: 'โมจิ', variants: ['โมจิ', 'โหมจิ'] })
    expect(await stream.waitFor('wake')).toMatchObject({ name: 'โมจิ' })
    expect((await s.phone.get('/api/name')).json.name).toBe('โมจิ')
    expect((await s.anon.get('/api/hello')).json.name).toBe('โมจิ')
    await stream.close()
  })

  divergent('phone-settings-api', 'wake-word training starts (publishes train n=0) and can be cancelled', async () => {
    const stream = await watch(s)
    const res = await s.phone.post('/api/name/train', { name: 'ฮานะ' })
    expect(res.status, res.text).toBe(200)
    expect(res.json.training).toMatchObject({ name: 'ฮานะ', got: [] })
    expect(await stream.waitFor('train')).toMatchObject({ name: 'ฮานะ', n: 0 })
    const cancelled = await s.phone.post('/api/name/train/cancel')
    expect(cancelled.status).toBe(200)
    expect(cancelled.json.training).toBeNull()
    await stream.close()
  })
})

describe('phone settings API: devices', () => {
  const s = useBackend()

  divergent('phone-settings-api', 'GET /api/devices lists paired phones and marks the caller', async () => {
    const other = await s.pair('Second')
    const res = await s.phone.get('/api/devices')
    expect(res.status).toBe(200)
    expect(res.json.length).toBeGreaterThanOrEqual(2)
    const self = res.json.filter((d: any) => d.self)
    expect(self).toHaveLength(1)
    expect(self[0].name).toBe('CONTRACT Test')
    expect(Object.keys(self[0])).toEqual(expect.arrayContaining(['id', 'name', 'paired', 'lastSeen']))
    expect((await other.get('/api/devices')).json.find((d: any) => d.self).name).toBe('Second')
  })

  divergent('phone-settings-api', 'a phone revokes another: that token is 401 and the Console list drops it', async () => {
    const other = await s.pair('To revoke')
    const id = (await other.get('/api/devices')).json.find((d: any) => d.self).id
    const stream = await watch(s)
    const res = await s.phone.post('/api/devices/revoke', { id })
    expect(res.status, res.text).toBe(200)
    expect(res.json).toEqual({ ok: true })
    await stream.waitFor('devices')
    expect((await other.get('/api/settings')).status).toBe(401)
    expect((await s.phone.get('/api/devices')).json.some((d: any) => d.id === id)).toBe(false)
    expect((await s.phone.post('/api/devices/revoke', { id })).status).toBe(404)
    await stream.close()
  })

  divergent('phone-settings-api', 'a phone revokes itself: its event stream ends and it is 401 from then on', async () => {
    const me = await s.pair('Suicidal')
    const id = (await me.get('/api/devices')).json.find((d: any) => d.self).id
    const mine = await me.events()
    await mine.waitFor('hello')
    const res = await me.post('/api/devices/revoke', { id })
    expect(res.status, res.text).toBe(200)
    await mine.waitFor('devices').catch(() => {})
    // the stream must end by itself: close() only resolves once the body is done
    await Promise.race([mine.close(), Bun.sleep(3000).then(() => { throw new Error('the revoked phone\'s stream stayed open') })])
    expect((await me.get('/api/settings')).status).toBe(401)
    expect((await me.events()).status).toBe(401)
    expect((await s.phone.get('/api/settings')).status).toBe(200)
  })
})

describe('phone settings API: jobs', () => {
  const s = useBackend()
  const inAnHour = () => nowMs() + 3600e3

  divergent('phone-settings-api', 'parse understands a sentence without saving anything', async () => {
    const res = await s.phone.post('/api/jobs/parse', { speech: 'ปลุกพรุ่งนี้ตีห้าครึ่ง' })
    expect(res.status, res.text).toBe(200)
    expect(res.json.draft).toMatchObject({ kind: 'alarm', when: expect.any(String), at: expect.any(Number) })
    expect((await s.phone.get('/api/jobs')).json.jobs).toEqual([])
  })

  divergent('phone-settings-api', 'add, list, edit, off/on, test and remove a job; each change publishes jobs', async () => {
    const stream = await watch(s)
    const added = await s.phone.post('/api/jobs/add', { kind: 'alarm', title: 'ทดสอบจากมือถือ', at: inAnHour() })
    expect(added.status, added.text).toBe(200)
    expect(added.json).toMatchObject({ kind: 'alarm', title: 'ทดสอบจากมือถือ', enabled: true, next: expect.any(Number) })
    await stream.waitFor('jobs')
    const id = added.json.id as string

    const list = (await s.phone.get('/api/jobs')).json
    expect(list.jobs.map((j: any) => j.id)).toContain(id)
    expect(list).toMatchObject({ ringing: null, problems: [] })

    const edited = await s.phone.post('/api/jobs/edit', { ref: id, title: 'เปลี่ยนชื่อ' })
    expect(edited.json.title).toBe('เปลี่ยนชื่อ')

    const off = await s.phone.post('/api/jobs/enable', { ref: id, enabled: false })
    expect(off.json).toMatchObject({ enabled: false, next: null })
    expect((await s.phone.post('/api/jobs/enable', { ref: id, enabled: true })).json.enabled).toBe(true)

    const from = stream.events.length
    expect((await s.phone.post('/api/jobs/test', { ref: id })).status).toBe(200)
    await stream.waitFor('alarm', 5000, from)
    expect((await s.phone.get('/api/status')).json.ringing).toBe(true)
    expect((await s.phone.post('/api/alarm/stop', {})).json).toEqual({ stopped: true })

    const removed = await s.phone.post('/api/jobs/remove', { ref: 'เปลี่ยนชื่อ' })
    expect(removed.json.removed.id).toBe(id)
    expect((await s.phone.get('/api/jobs')).json.jobs).toEqual([])
    await stream.close()
  })

  divergent('phone-settings-api', 'a task job needs a prompt; bad input is a 400, an unknown ref a 404', async () => {
    const bad = await s.phone.post('/api/jobs/add', { kind: 'bogus' })
    expect(bad.status).toBe(400)
    expect(typeof bad.json.error).toBe('string')
    expect((await s.phone.post('/api/jobs/enable', { ref: 'nope', enabled: true })).status).toBe(404)
  })
})

describe('phone settings API: memory, journal and dreams', () => {
  const s = useBackend()

  divergent('phone-settings-api', 'memory: add, show, save (conflict-checked) and forget', async () => {
    const stream = await watch(s)
    const added = await s.phone.post('/api/memory/add', { text: 'ชอบชาเย็น', section: 'ความชอบ' })
    expect(added.status, added.text).toBe(200)
    expect(added.json.items.some((i: any) => i.text === 'ชอบชาเย็น')).toBe(true)
    await stream.waitFor((e) => e.type === 'changed' && e.file === 'memory')

    const doc = (await s.phone.get('/api/memory')).json
    // (bun's toMatchObject with expect.any rewrites the object it checks: look with typeof)
    expect([typeof doc.text, typeof doc.version]).toEqual(['string', 'string'])
    const saved = await s.phone.post('/api/memory', { text: doc.text + '- ชอบแมว\n', since: doc.version })
    expect(saved.status, saved.text).toBe(200)
    expect(saved.json.items.some((i: any) => i.text === 'ชอบแมว')).toBe(true)

    // the old version is stale now
    const stale = await s.phone.post('/api/memory', { text: 'overwrite', since: doc.version })
    expect(stale.status).toBe(409)
    expect(typeof stale.json.error).toBe('string')

    const forgot = await s.phone.post('/api/memory/forget', { text: 'ชอบแมว' })
    expect(forgot.status).toBe(200)
    expect(forgot.json.removed.map((i: any) => i.text)).toEqual(['ชอบแมว'])
    await stream.close()
  })

  divergent('phone-settings-api', 'journal: list days, show a day, forget an entry', async () => {
    await s.backend.say?.('นีโอ ทดสอบบันทึกประจำวัน @card:echo')
    const days = await s.phone.get('/api/journal')
    expect(days.status).toBe(200)
    expect(days.json.length).toBeGreaterThanOrEqual(1)
    const shown = await s.phone.post('/api/journal/show', { day: 'today' })
    expect(shown.status, shown.text).toBe(200)
    expect(shown.json.entries.length).toBeGreaterThanOrEqual(1)
    const q = shown.json.entries[0].q as string
    const forgot = await s.phone.post('/api/journal/forget', { text: q.slice(0, 20), all: true })
    expect(forgot.status).toBe(200)
    expect(forgot.json.removed.length).toBeGreaterThanOrEqual(1)
  })

  divergent('phone-settings-api', 'dreams: status, on/off, list, show and rm', async () => {
    const status = await s.phone.get('/api/dream')
    expect(status.json).toMatchObject({ enabled: expect.any(Boolean), running: false })
    const off = await s.phone.post('/api/dream/enable', { enabled: false })
    expect(off.json.enabled).toBe(false)
    expect((await s.phone.post('/api/dream/enable', { enabled: true })).json.enabled).toBe(true)

    await s.backend.say?.('นีโอ ขอทดสอบความฝันหน่อย @card:echo')
    const dreamt = await s.phone.post('/api/dream/now')
    expect(dreamt.status, dreamt.text).toBe(200)
    const id = dreamt.json.id as string

    const list = (await s.phone.get('/api/dreams')).json
    expect(list.map((d: any) => d.id)).toContain(id)
    const shown = await s.phone.post('/api/dreams/show', { id })
    expect(shown.json).toMatchObject({ id, dream: expect.any(String) })
    expect((await s.phone.post('/api/dreams/show', { id: 'last' })).json.id).toBe(id)
    const removed = await s.phone.post('/api/dreams/rm', { id })
    expect(removed.json.removed.id).toBe(id)
    expect((await s.phone.get('/api/dreams')).json).toEqual([])
    expect((await s.phone.post('/api/dreams/show', { id })).status).toBe(404)
  })
})

describe('phone settings API: NeoApp routes are unchanged', () => {
  const s = useBackend()

  divergent('phone-settings-api', 'POST /api/pet is still the phone\'s own report, and POST /api/face needs a token', async () => {
    expect((await s.phone.post('/api/pet', { hunger: 0.2, affection: 0.3 })).json).toEqual({ ok: true })
    expect((await s.anon.post('/api/face', { fg: '#abcdef' })).status).toBe(401)
    expect((await s.phone.post('/api/face', { fg: '#abcdef' })).json.fg).toBe('#abcdef')
  })
})
