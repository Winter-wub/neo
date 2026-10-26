// Ticket 13: `neo doctor` end to end against a real core and socket. Nothing real is probed: claude --version and Full Disk Access are injected.
import { afterEach, expect, test } from 'bun:test'
import { join } from 'node:path'
import { runCli } from '../src/adapters/command/cli'
import { startCommandServer } from '../src/adapters/command/server'
import { createCore } from '../src/core/core'
import type { FdaProbe } from '../src/core/doctor/doctor'
import type { DoctorRow } from '../src/protocol'
import { FakeClock, golden, tempHome } from './helpers'

const FAKE_BIN = join(import.meta.dir, 'fake-bin')
const cleanups: Array<() => Promise<unknown>> = []
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map(c => c()))
})

async function running(fda: FdaProbe = 'granted') {
  const { dir, cleanup } = await tempHome()
  cleanups.push(cleanup)
  const clock = new FakeClock()
  const core = await createCore({
    home: dir, clock, pid: 1,
    env: { PATH: `${FAKE_BIN}:/usr/bin:/bin`, HOME: dir },
    doctorProbes: { claudeVersion: async () => '2.1.0 (Claude Code)', fda: async () => fda },
  })
  const server = await startCommandServer({ core, clock, home: dir })
  cleanups.unshift(() => server.stop(), () => core.stop())
  return { dir, core }
}

async function neo(dir: string, args: string[]) {
  const out: string[] = []
  const err: string[] = []
  const code = await runCli([...args, '--home', dir], { out: t => void out.push(t), err: t => void err.push(t), env: {} })
  return { code, stdout: out.join(''), stderr: err.join('') }
}

test('neo doctor --json: every check in order, with where claude was found; golden fixture', async () => {
  const { dir } = await running()
  const { code, stdout } = await neo(dir, ['doctor', '--json'])
  expect(code).toBe(0)
  const rows = JSON.parse(stdout) as DoctorRow[]
  expect(rows.map(r => r.id)).toEqual(['claude', 'stt', 'network', 'agents', 'phone', 'fda', 'jobs'])
  expect(rows[0]).toMatchObject({ ok: true, found: { claude: join(FAKE_BIN, 'claude') } })
  expect(rows.find(r => r.id === 'fda')).toMatchObject({ ok: true })
  expect(rows.find(r => r.id === 'phone')).toMatchObject({ ok: false, fix: 'neo devices pair' })
  // the fake bin reads as /usr/local/bin in the fixture
  const local = (v: string) => v.replaceAll(FAKE_BIN, '/usr/local/bin')
  const portable = rows.map(r => ({ ...r, detail: r.detail && local(r.detail), found: r.found && Object.fromEntries(Object.entries(r.found).map(([k, v]) => [k, v && local(v)])) }))
  await golden('doctor', portable)
})

test('a claudeConfigDir that does not exist is warned about, with the fix; unsetting clears it', async () => {
  const { dir } = await running()
  await neo(dir, ['settings', 'set', 'claudeConfigDir', join(dir, 'missing')])
  const warned = JSON.parse((await neo(dir, ['doctor', '--json'])).stdout)[0] as DoctorRow
  expect(warned).toMatchObject({ id: 'claude', ok: false })
  expect(warned.detail).toContain('claudeConfigDir ไม่มีอยู่')
  expect(warned.fix).toContain('neo settings set claudeConfigDir')
  await neo(dir, ['settings', 'set', 'claudeConfigDir', 'unset'])
  expect(JSON.parse((await neo(dir, ['doctor', '--json'])).stdout)[0]).toMatchObject({ ok: true })
})

test('without Full Disk Access the fda row says how to grant it; the markdown shows where tools were found', async () => {
  const { dir } = await running('denied')
  const rows = JSON.parse((await neo(dir, ['doctor', '--json'])).stdout) as DoctorRow[]
  expect(rows.find(r => r.id === 'fda')).toMatchObject({ ok: false, optional: true, fix: expect.stringContaining('Full Disk Access') })
  const text = (await neo(dir, ['doctor'])).stdout
  expect(text).toContain(`claude: ${join(FAKE_BIN, 'claude')}`)
  expect(text).toContain('tailscale: ไม่พบ')
})
