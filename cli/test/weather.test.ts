// Ticket 08 end to end: neo say → Conversation → Weather → card, with a fake open-meteo and the fake `claude`.
import { afterEach, expect, test } from 'bun:test'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { runCli } from '../src/adapters/command/cli'
import { startCommandServer } from '../src/adapters/command/server'
import type { Answer, AskRequest, Brain } from '../src/core/brain/brain'
import { createCore } from '../src/core/core'
import { FakeClock, golden, tempHome } from './helpers'

const FAKE_BIN = join(import.meta.dir, 'fake-bin')
const cleanups: Array<() => Promise<unknown>> = []
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map(c => c()))
})

const FORECAST = {
  current: { temperature_2m: 31.4, apparent_temperature: 36.2, relative_humidity_2m: 70, weather_code: 2 },
  daily: { weather_code: [2, 61, 95], precipitation_probability_max: [20, 80, 90], temperature_2m_max: [34.2, 30.1, 29.6], temperature_2m_min: [26.4, 25.2, 24.8] },
}

async function running(state?: unknown, brain?: Brain) {
  const { dir, cleanup } = await tempHome()
  cleanups.push(cleanup)
  if (state) await writeFile(join(dir, 'state.json'), JSON.stringify(state))
  const urls: URL[] = []
  const weatherFetch = (async (input: string | URL | Request) => {
    const url = new URL(String(input))
    urls.push(url)
    if (url.hostname.startsWith('geocoding')) return Response.json({ results: [{ latitude: 18.79, longitude: 98.98, name: 'เชียงใหม่', country_code: 'TH' }] })
    return Response.json(FORECAST)
  }) as typeof fetch
  const clock = new FakeClock()
  const core = await createCore({
    home: dir, clock, pid: 1, weatherFetch, brain,
    env: { PATH: `${FAKE_BIN}:${process.env.PATH}`, FAKE_CLAUDE_LOG: join(dir, 'calls.jsonl'), FAKE_CLAUDE_PIDS: join(dir, 'pids') },
  })
  const server = await startCommandServer({ core, clock, home: dir })
  cleanups.unshift(() => server.stop())
  return { dir, core, urls }
}

async function neo(dir: string, args: string[]) {
  const out: string[] = []
  const err: string[] = []
  const code = await runCli([...args, '--home', dir], { out: t => void out.push(t), err: t => void err.push(t), env: {} })
  return { code, stdout: out.join(''), stderr: err.join('') }
}

const claudeCalls = (dir: string) => readFile(join(dir, 'calls.jsonl'), 'utf8').then(t => t.split('\n').filter(Boolean), () => [])

test('"อากาศพรุ่งนี้เป็นไง" returns a weather card and never spawns claude', async () => {
  const { dir, urls } = await running()
  const said = await neo(dir, ['say', 'นีโอ อากาศพรุ่งนี้เป็นไง', '--json'])
  expect(said.code).toBe(0)
  const result = JSON.parse(said.stdout)
  expect(result).toMatchObject({ outcome: 'card', card: { kind: 'weather', icon: 'rain', title: '30°C', lines: ['กรุงเทพฯ · พรุ่งนี้', 'ฝนตก', 'ต่ำสุด 25° ฝน 80%'] } }) // humanize squeezes double spaces
  expect(await claudeCalls(dir)).toEqual([])
  expect(urls.map(u => u.hostname)).toEqual(['api.open-meteo.com'])
  expect(urls[0]!.searchParams.get('latitude')).toBe('13.75')
  await golden('say-weather', result)
})

test('the human rendering shows the card', async () => {
  const { dir } = await running()
  const said = await neo(dir, ['say', 'นีโอ อากาศเป็นไง'])
  expect(said.stdout).toContain('31°C')
  expect(said.stdout).toContain('รู้สึกเหมือน 36° ชื้น 70%')
})

test('setting home changes what "here" means', async () => {
  const { dir, urls } = await running({ home: { city: 'ลำปาง', lat: 18.29, lon: 99.49 } })
  const said = await neo(dir, ['say', 'นีโอ ฝนตกไหม', '--json'])
  expect(JSON.parse(said.stdout).card.lines[0]).toStartWith('ลำปาง ·')
  expect(urls[0]!.searchParams.get('latitude')).toBe('18.29')
})

test('a Brain answer with a weather intent is turned into the same card, and the next turn is told about it', async () => {
  const asks: AskRequest[] = []
  const answers: Answer[] = [
    { type: 'weather', place: 'เชียงใหม่', day: 1 },
    { type: 'card', card: { kind: 'text', layout: 'text', icon: 'text', title: 'ยินดี', lines: ['ยินดี'], items: [], emotion: 'happy', sounds: [], seconds: 10 } },
  ]
  const brain: Brain = {
    label: 'Fake',
    ask: async request => {
      asks.push(request)
      return { answer: answers.shift()!, session: 's1' }
    },
    runSkill: async () => { throw new Error('unused') },
  }
  const { dir, urls } = await running(undefined, brain)
  const said = await neo(dir, ['say', 'นีโอ พรุ่งนี้ไปเที่ยวไหนดี', '--json'])
  const { card } = JSON.parse(said.stdout)
  expect(card).toMatchObject({ kind: 'weather', title: '30°C' })
  expect(card.lines[0]).toBe('เชียงใหม่ · พรุ่งนี้')
  expect(urls.map(u => u.hostname)).toEqual(['geocoding-api.open-meteo.com', 'api.open-meteo.com'])

  await neo(dir, ['say', 'นีโอ ขอบคุณนะ'])
  expect(asks).toHaveLength(2)
  expect(asks[1]!.context.notes).toHaveLength(1)
  expect(asks[1]!.context.notes[0]).toContain('พรุ่งนี้ไปเที่ยวไหนดี')
  expect(asks[1]!.context.notes[0]).toContain('30°C')
})

test('the weather card goes out as a card event', async () => {
  const { dir, core } = await running()
  const seen: any[] = []
  core.attach(e => void seen.push(e))
  await neo(dir, ['say', 'นีโอ อากาศพรุ่งนี้เป็นไง'])
  const event = seen.find(e => e.type === 'card')
  expect(event.card.kind).toBe('weather')
  await golden('event-card-weather', event)
})
