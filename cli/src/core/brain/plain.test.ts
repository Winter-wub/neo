import { afterEach, expect, test } from 'bun:test'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tempHome } from '../../../test/helpers'
import type { AskRequest } from './brain'
import { createHttpBrain, createOpenAiBrain } from './plain'

const cleanups: Array<() => Promise<unknown> | void> = []
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map(c => c()))
})

function request(text: string, over: Partial<AskRequest> = {}): AskRequest {
  return {
    text, resume: null, bypass: false, signal: new AbortController().signal, onTool() {},
    context: { petName: 'จอห์น', wakeVariants: ['จอห์น'], memory: '', notes: [], now: new Date(2026, 9, 26, 9, 5) },
    ...over,
  }
}

interface Seen { url: string; body: any; headers: Headers }
function endpoint(handler: (seen: Seen) => Response | Promise<Response>) {
  const seen: Seen[] = []
  const server = Bun.serve({
    port: 0, hostname: '127.0.0.1',
    async fetch(req) {
      const body = req.method === 'POST' ? await req.json() : null
      const entry = { url: new URL(req.url).pathname, body, headers: req.headers }
      seen.push(entry)
      return handler(entry)
    },
  })
  cleanups.push(() => server.stop(true))
  return { seen, base: `http://127.0.0.1:${server.port}` }
}

const chat = (content: string) => Response.json({ choices: [{ message: { content } }] })

test('OpenAI-compatible: history is sent each turn, the key and headers come from the config, tools are not offered', async () => {
  const { dir, cleanup } = await tempHome()
  cleanups.push(cleanup)
  await writeFile(join(dir, 'k.key'), 'sk-test\n')
  const { seen, base } = endpoint(({ body }) => chat(JSON.stringify({ layout: 'text', title: 'msgs ' + body.messages.length, lines: [] })))
  const brain = createOpenAiBrain({ name: 'local', cfg: { type: 'openai', baseUrl: `${base}/v1/`, model: 'x', apiKeyFile: join(dir, 'k.key'), headers: { 'X-Title': 'Neo companion' } }, env: {} })
  const a = await brain.ask(request('a'))
  expect(a.answer).toMatchObject({ card: { title: 'msgs 1' } })
  const b = await brain.ask(request('b', { resume: a.session }))
  expect(b.answer).toMatchObject({ card: { title: 'msgs 3' } })
  expect(seen[0]!.url).toBe('/v1/chat/completions')
  expect(seen[0]!.body.messages[0].content).toContain('คุณไม่มีเครื่องมือค้นหา') // the plain (no tools) prompt
  expect(seen[1]!.body.messages[2].content).toContain('ผู้ใช้พูดต่อ: "b"')
  expect(seen[0]!.headers.get('authorization')).toBe('Bearer sk-test')
  expect(seen[0]!.headers.get('x-title')).toBe('Neo companion')
  const fresh = await brain.ask(request('c')) // no resume: a new conversation
  expect(fresh.answer).toMatchObject({ card: { title: 'msgs 1' } })
})

test('OpenAI-compatible: the model is the chosen one (changes mid-conversation, history stays), listing uses /models', async () => {
  let model: string | null = 'x/fast'
  const { seen, base } = endpoint(({ url }) =>
    url === '/v1/models' ? Response.json({ data: [{ id: 'x/fast' }, { id: 'y/smart', name: 'Smart' }] }) : chat('{"title":"ok","lines":[]}'))
  const brain = createOpenAiBrain({ name: 'or', cfg: { type: 'openai', baseUrl: `${base}/v1` }, env: {}, model: () => model })
  expect(await brain.listModels()).toEqual([{ id: 'x/fast', name: 'x/fast' }, { id: 'y/smart', name: 'y/smart — Smart' }])
  const first = await brain.ask(request('a'))
  model = 'y/smart'
  await brain.ask(request('b', { resume: first.session }))
  const posts = seen.filter(s => s.body)
  expect(posts.map(s => s.body.model)).toEqual(['x/fast', 'y/smart'])
  expect(posts[1]!.body.messages).toHaveLength(3)
})

test('OpenAI-compatible: no model chosen is a clear error; the key is only the named env var', async () => {
  const { seen, base } = endpoint(() => chat('{"title":"ok","lines":[]}'))
  const none = createOpenAiBrain({ name: 'or', cfg: { type: 'openai', baseUrl: base, label: 'OR' }, env: {} })
  expect((await none.ask(request('a'))).answer).toEqual({ type: 'error', error: 'OR: ยังไม่ได้เลือกโมเดล — เลือกด้วย neo model use' })
  expect(seen).toHaveLength(0)
  const keyed = createOpenAiBrain({ name: 'or', cfg: { type: 'openai', baseUrl: base, model: 'm', apiKeyEnv: 'OR_KEY' }, env: { OR_KEY: 'from-env', OTHER_KEY: 'nope' } })
  await keyed.ask(request('a'))
  expect(seen[0]!.headers.get('authorization')).toBe('Bearer from-env')
})

test('OpenAI-compatible: errors are typed, name the status, drop the failed turn and never leak the key', async () => {
  let status = 401
  const { base } = endpoint(() => new Response('bad key', { status }))
  const brain = createOpenAiBrain({ name: 'or', cfg: { type: 'openai', baseUrl: base, model: 'm', label: 'OR', apiKeyEnv: 'K' }, env: { K: 'sk-secret' } })
  const reply = await brain.ask(request('a'))
  expect(reply.answer).toEqual({ type: 'error', error: 'OR ตอบ 401 (ไม่มี/ผิด API key) bad key' })
  expect(JSON.stringify(reply)).not.toContain('sk-secret')
  status = 500
  expect((await brain.ask(request('a'))).answer).toMatchObject({ type: 'error', error: expect.stringContaining('OR ตอบ 500') })

  const down = createOpenAiBrain({ name: 'd', cfg: { type: 'openai', baseUrl: 'http://127.0.0.1:1', model: 'm', label: 'D' }, env: {} })
  expect((await down.ask(request('a'))).answer).toMatchObject({ type: 'error', error: expect.stringMatching(/^D: /) })
})

test('OpenAI-compatible: aborting answers "interrupted" and the failed turn is not kept', async () => {
  let hold = true
  const { base } = endpoint(async () => {
    while (hold) await Bun.sleep(10)
    return chat('{"title":"late","lines":[]}')
  })
  const brain = createOpenAiBrain({ name: 'or', cfg: { type: 'openai', baseUrl: base, model: 'm' }, env: {} })
  const abort = new AbortController()
  const pending = brain.ask(request('a', { signal: abort.signal }))
  await Bun.sleep(50)
  abort.abort()
  expect((await pending).answer).toEqual({ type: 'error', error: 'interrupted' })
  hold = false
  const next = await brain.ask(request('b'))
  expect(next.answer).toMatchObject({ card: { title: 'late' } })
})

test('a plain-words answer still becomes a text card; intents come back typed', async () => {
  let reply = 'สวัสดีครับ'
  const { base } = endpoint(() => chat(reply))
  const brain = createOpenAiBrain({ name: 'or', cfg: { type: 'openai', baseUrl: base, model: 'm' }, env: {} })
  expect((await brain.ask(request('a'))).answer).toMatchObject({ card: { title: 'จอห์น', lines: ['สวัสดีครับ'] } })
  reply = '{"intent":"weather","place":"เชียงใหม่","day":1}'
  expect((await brain.ask(request('b'))).answer).toEqual({ type: 'weather', place: 'เชียงใหม่', day: 1 })
})

test('custom HTTP endpoint: sends text, prompt, session and model; reads card or text; keeps the session id it returns', async () => {
  const { seen, base } = endpoint(({ body }) =>
    body.text === 'card' ? Response.json({ card: { layout: 'text', title: 'จากเรา', lines: ['x'] }, sessionId: 'abc' }) : Response.json({ text: 'สวัสดี ' + (body.sessionId ?? 'ใหม่'), sessionId: 'abc' }))
  const brain = createHttpBrain({ name: 'mine', cfg: { type: 'http', url: `${base}/neo`, headers: { 'X-Team': 'a' } }, env: {}, model: () => 'big' })
  const first = await brain.ask(request('hi'))
  expect(first).toMatchObject({ answer: { card: { lines: ['สวัสดี ใหม่'] } }, session: 'abc' })
  const second = await brain.ask(request('again', { resume: first.session }))
  expect(second.answer).toMatchObject({ card: { lines: ['สวัสดี abc'] } })
  expect(seen[0]!.body).toMatchObject({ text: 'hi', sessionId: null, fresh: true, model: 'big' })
  expect(seen[0]!.body.prompt).toContain('คุณคือ "จอห์น"')
  expect(seen[1]!.body).toMatchObject({ sessionId: 'abc', fresh: false })
  expect(seen[0]!.headers.get('x-team')).toBe('a')
  expect((await brain.ask(request('card'))).answer).toMatchObject({ card: { title: 'จากเรา' } })
  expect(await brain.listModels()).toEqual([])
})

test('custom HTTP endpoint: a bad status is a typed error', async () => {
  const { base } = endpoint(() => new Response('no', { status: 503 }))
  const brain = createHttpBrain({ name: 'mine', cfg: { type: 'http', url: base, label: 'Mine' }, env: {} })
  expect((await brain.ask(request('hi'))).answer).toEqual({ type: 'error', error: 'Mine ตอบ 503 no' })
})
