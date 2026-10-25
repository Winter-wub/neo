// Ticket 15 on a real `neo daemon run`: an old NEO_HOME is converted at start, a second start leaves it alone,
// and the phone that was paired before still is afterwards.
import { afterEach, expect, test } from 'bun:test'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createDevices } from '../src/core/devices/devices'
import { createEvents } from '../src/core/events/events'
import { parseJournal } from '../src/core/memory/journal-doc'
import { systemClock } from '../src/core/clock'
import { tempHome } from './helpers'

const MAIN = join(import.meta.dir, '..', 'src', 'main.ts')
const cleanups: Array<() => Promise<unknown>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

async function start(dir: string, home: string) {
  const [logs, userHome] = [join(dir, 'logs'), join(dir, 'home')]
  await mkdir(logs, { recursive: true })
  await mkdir(userHome, { recursive: true })
  const port = 20_000 + Math.floor(Math.random() * 30_000)
  const proc = Bun.spawn([process.execPath, MAIN, 'daemon', 'run', '--home', home, '--port', String(port)], {
    env: { PATH: `${process.execPath.replace(/\/[^/]*$/, '')}:/usr/bin:/bin`, HOME: userHome, NEO_LOG_DIR: logs, NEO_DISCOVER: '0', CLAUDE_CONFIG_DIR: '/Users/x/.ccs/instances/personal' },
    stdout: 'ignore', stderr: 'ignore',
  })
  cleanups.push(async () => { proc.kill(); await proc.exited })
  // ready = the phone port answers. (A SIGTERM that lands while the daemon is still starting is not honoured until a ~5 s timeout.)
  for (let i = 0; i < 100 && !(await fetch(`http://127.0.0.1:${port}/api/hello`, { headers: { Connection: 'close' } }).then(r => r.ok, () => false)); i++) await Bun.sleep(50)
  await Bun.sleep(100)
  return { port, stop: async () => { proc.kill(); await proc.exited } }
}

test('an old home is converted when the daemon starts; the paired phone still gets in; a restart changes nothing', async () => {
  const { dir, cleanup } = await tempHome()
  cleanups.push(cleanup)
  const home = join(dir, 'h')
  await mkdir(home, { recursive: true })
  await writeFile(join(home, 'journal.jsonl'), JSON.stringify({ at: new Date(2026, 9, 26, 9, 41).getTime(), q: 'q', a: 'a', ok: true }) + '\n')
  await writeFile(join(home, 'schedule.json'), '[]')
  // a phone paired in the old home
  const events = createEvents({ clock: systemClock })
  const devices = await createDevices({ home, clock: systemClock, events })
  const { code } = devices.startPairing()
  const paired = devices.pair(code, 'A7') as { token: string }
  await Bun.sleep(100)
  const devicesFile = await readFile(join(home, 'devices.json'), 'utf8')
  const withoutLastSeen = (text: string) => Object.values(JSON.parse(text) as Record<string, Record<string, unknown>>).map(({ lastSeen: _, ...rest }) => rest)

  const first = await start(dir, home)
  // /api/dream/seen needs a device token: 401 without one, anything else with the pre-migration token
  const statusWith = async (port: number, token?: string) =>
    (await fetch(`http://127.0.0.1:${port}/api/dream/seen`, { method: 'POST', body: '{}', headers: { Connection: 'close', ...(token ? { Authorization: `Bearer ${token}` } : {}) } })).status
  expect(await statusWith(first.port)).toBe(401)
  expect(await statusWith(first.port, paired.token)).not.toBe(401)
  expect(parseJournal(await readFile(join(home, 'journal', '2026-10-26.md'), 'utf8'))).toHaveLength(1)
  expect(await readdir(join(home, 'legacy'))).toEqual(['journal.jsonl', 'schedule.json'])
  expect(JSON.parse(await readFile(join(home, 'state.json'), 'utf8')).claudeConfigDir).toBe('/Users/x/.ccs/instances/personal')
  // the phone's own use updates lastSeen; nothing else in the entry may change
  expect(withoutLastSeen(await readFile(join(home, 'devices.json'), 'utf8'))).toEqual(withoutLastSeen(devicesFile))
  await first.stop()

  const journal = await readFile(join(home, 'journal', '2026-10-26.md'), 'utf8')
  const second = await start(dir, home)
  expect(await statusWith(second.port, paired.token)).not.toBe(401)
  expect(await readFile(join(home, 'journal', '2026-10-26.md'), 'utf8')).toBe(journal)
  expect(await readdir(join(home, 'legacy'))).toEqual(['journal.jsonl', 'schedule.json'])
  await second.stop()
})
