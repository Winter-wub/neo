import { afterEach, expect, test } from 'bun:test'
import { readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { FakeClock, golden, tempHome } from '../../../test/helpers'
import type { NeoEvent } from '../../protocol'
import { createEvents } from '../events/events'
import { createSettings, SettingsError } from './settings'

const homes: Array<() => Promise<void>> = []
afterEach(async () => {
  await Promise.all(homes.splice(0).map(c => c()))
})
async function setup(initial?: unknown) {
  const { dir, cleanup } = await tempHome()
  homes.push(cleanup)
  if (initial) await writeFile(join(dir, 'state.json'), JSON.stringify(initial))
  const events = createEvents({ clock: new FakeClock() })
  const settings = await createSettings({ home: dir, events })
  return { dir, events, settings }
}

const DEFAULTS = {
  requireName: true, followUp: true, bypass: true, tailscale: true, lan: false,
  idle: { sleepAfter: 150, clock: true }, dream: true, onboarded: false,
  claudeConfigDir: null, home: { city: 'กรุงเทพฯ', lat: 13.75, lon: 100.52 }, mcpServers: null,
}

test('defaults match the old backend: wake word required, follow-up on, bypass on', async () => {
  const { settings } = await setup()
  expect(settings.get()).toEqual(DEFAULTS)
})

test('reads the existing state.json and keeps keys it does not own when saving', async () => {
  const { dir, settings } = await setup({ requireName: false, provider: 'claude', model: { claude: 'opus' } })
  expect(settings.get().requireName).toBe(false)
  await settings.set({ bypass: false })
  const saved = JSON.parse(await readFile(join(dir, 'state.json'), 'utf8'))
  expect(saved).toMatchObject({ requireName: false, bypass: false, provider: 'claude', model: { claude: 'opus' } })
  expect((await stat(join(dir, 'state.json'))).mode & 0o777).toBe(0o600)
})

test('a change publishes a settings event; setting the same value does not', async () => {
  const { events, settings } = await setup()
  const seen: unknown[] = []
  events.subscribe(ev => seen.push(ev))
  await settings.set({ followUp: false })
  await settings.set({ followUp: false })
  expect(seen).toEqual([{ type: 'settings', at: 1_700_000_000_000, ...DEFAULTS, followUp: false }])
})

test('rejects unknown keys and non-boolean values without changing anything', async () => {
  const { settings } = await setup()
  await expect(settings.set({ requireName: 'yes' } as never)).rejects.toThrow('requireName')
  await expect(settings.set({ nope: true } as never)).rejects.toThrow('nope')
  expect(settings.get()).toEqual(DEFAULTS)
})

test('every key is reachable by name with string arguments, as `neo settings set` sends them', async () => {
  const { settings } = await setup()
  await settings.setByKey('onboarded', ['true'])
  await settings.setByKey('dream', ['false'])
  await settings.setByKey('idle.sleepAfter', ['300'])
  await settings.setByKey('idle.clock', ['false'])
  await settings.setByKey('claudeConfigDir', ['/Users/me/.ccs/instances/personal'])
  await settings.setByKey('home', ['เชียงใหม่', '18.79', '98.98'])
  await settings.setByKey('mcpServers', ['MCP_DOCKER,peekaboo'])
  expect(settings.get()).toEqual({
    ...DEFAULTS, onboarded: true, dream: false, idle: { sleepAfter: 300, clock: false },
    claudeConfigDir: '/Users/me/.ccs/instances/personal', home: { city: 'เชียงใหม่', lat: 18.79, lon: 98.98 },
    mcpServers: ['MCP_DOCKER', 'peekaboo'],
  })
})

test('sleepAfter is clamped to 15..3600 seconds', async () => {
  const { settings } = await setup()
  expect((await settings.setByKey('idle.sleepAfter', ['5'])).idle.sleepAfter).toBe(15)
  expect((await settings.setByKey('idle.sleepAfter', ['99999'])).idle.sleepAfter).toBe(3600)
})

test('claudeConfigDir, home and mcpServers can be unset again', async () => {
  const { settings } = await setup()
  await settings.setByKey('claudeConfigDir', ['/x'])
  await settings.setByKey('home', ['เชียงใหม่', '18.79', '98.98'])
  await settings.setByKey('mcpServers', ['a'])
  const after = await settings.setByKey('claudeConfigDir', ['unset'])
  expect(after.claudeConfigDir).toBeNull()
  expect((await settings.setByKey('home', ['unset'])).home).toEqual(DEFAULTS.home)
  expect((await settings.setByKey('mcpServers', ['unset'])).mcpServers).toBeNull()
})

test('home also takes one JSON argument', async () => {
  const { settings } = await setup()
  const after = await settings.setByKey('home', ['{"city":"ภูเก็ต","lat":7.88,"lon":98.39}'])
  expect(after.home).toEqual({ city: 'ภูเก็ต', lat: 7.88, lon: 98.39 })
})

test.each([
  ['requireName', ['yes'], 'true หรือ false'],
  ['idle.sleepAfter', ['soon'], 'ตัวเลข'],
  ['idle.clock', ['1'], 'true หรือ false'],
  ['claudeConfigDir', ['relative/dir'], 'path เต็ม'],
  ['home', ['เชียงใหม่', '91', '98'], 'lat'],
  ['home', ['เชียงใหม่', '18', '181'], 'lon'],
  ['home', ['เชียงใหม่'], 'city lat lon'],
  ['mcpServers', [], 'ชื่อ'],
  ['nope', ['true'], 'nope'],
  ['idle', ['3'], 'idle.sleepAfter'],
])('%s %j is rejected in Thai and changes nothing', async (key, args, mention) => {
  const { settings } = await setup()
  const error = await settings.setByKey(key, args).catch(e => e)
  expect(error).toBeInstanceOf(SettingsError)
  expect(error.message).toContain(mention)
  expect(settings.get()).toEqual(DEFAULTS)
})

test('a changed idle publishes an idle event next to the settings event', async () => {
  const { events, settings } = await setup()
  const seen: NeoEvent[] = []
  events.subscribe(ev => seen.push(ev))
  await settings.setByKey('idle.sleepAfter', ['600'])
  await settings.setByKey('idle.sleepAfter', ['600'])
  expect(seen.map(e => e.type)).toEqual(['settings', 'idle'])
  expect(seen[1]).toEqual({ type: 'idle', at: 1_700_000_000_000, sleepAfter: 600, clock: true })
  await golden('event-idle', seen[1])
})

test('malformed saved values fall back to the defaults', async () => {
  const { settings } = await setup({ idle: { sleepAfter: 'x' }, home: { city: 3 }, claudeConfigDir: 5, mcpServers: 'a' })
  expect(settings.get()).toEqual(DEFAULTS)
})
