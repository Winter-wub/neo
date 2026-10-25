import { afterEach, expect, test } from 'bun:test'
import { chmod, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { agentsRow, claudeRow, fdaRow, locate, networkRow, phoneRow, probeProtected } from './doctor'

const dirs: string[] = []
afterEach(async () => {
  for (const dir of dirs.splice(0)) {
    await chmod(join(dir, 'locked'), 0o700).catch(() => {})
    await rm(dir, { recursive: true, force: true })
  }
})
async function temp() {
  const dir = await mkdtemp(join(tmpdir(), 'nd-'))
  dirs.push(dir)
  return dir
}
async function binDir(...names: string[]) {
  const dir = await temp()
  for (const name of names) {
    await writeFile(join(dir, name), '#!/bin/sh\n', { mode: 0o755 })
  }
  return dir
}

test('locate finds a tool on the given PATH and says null when it is missing', async () => {
  const bin = await binDir('claude')
  expect(locate('claude', bin)).toBe(await realpath(join(bin, 'claude')))
  expect(locate('acpx', bin)).toBeNull()
})

test('claude row: found, version and the config dir that exists', async () => {
  const bin = await binDir('claude')
  const configDir = await temp()
  const row = await claudeRow({ path: bin, configDir, version: async () => '2.1.0 (Claude Code)' })
  expect(row).toMatchObject({ id: 'claude', ok: true })
  expect(row.detail).toContain('2.1.0')
  expect(row.found?.claude).toContain('claude')
})

test('claude row: not on PATH says where it looked and how to fix it', async () => {
  const row = await claudeRow({ path: '/nowhere', configDir: null, version: async () => '' })
  expect(row).toMatchObject({ ok: false, found: { claude: null } })
  expect(row.detail).toContain('PATH')
  expect(row.fix).toContain('neo daemon restart')
})

test('claude row: found but --version fails shows the reason', async () => {
  const bin = await binDir('claude')
  const row = await claudeRow({ path: bin, configDir: null, version: async () => { throw new Error('หมดเวลา') } })
  expect(row).toMatchObject({ ok: false })
  expect(row.detail).toContain('หมดเวลา')
})

test('claude row: warns when claudeConfigDir does not exist, even though claude works', async () => {
  const bin = await binDir('claude')
  const row = await claudeRow({ path: bin, configDir: '/no/such/dir', version: async () => '2.1.0' })
  expect(row.ok).toBe(false)
  expect(row.detail).toContain('/no/such/dir')
  expect(row.fix).toContain('neo settings set claudeConfigDir')
  expect(row.found?.claude).toContain('claude')
})

test('fda row: reads a protected path for real, tells granted / denied / unknown', async () => {
  const dir = await temp()
  const readable = join(dir, 'readable')
  const locked = join(dir, 'locked')
  await mkdir(readable)
  await mkdir(locked)
  await chmod(locked, 0o000)
  expect(await probeProtected([join(dir, 'missing'), readable])).toBe('granted')
  expect(await probeProtected([join(dir, 'missing'), locked, readable])).toBe('denied')
  expect(await probeProtected([join(dir, 'missing')])).toBe('unknown')

  expect(await fdaRow({ probe: async () => 'granted' })).toMatchObject({ id: 'fda', ok: true })
  const denied = await fdaRow({ probe: async () => 'denied' })
  expect(denied).toMatchObject({ id: 'fda', ok: false })
  expect(denied.fix).toContain('Full Disk Access')
  expect(await fdaRow({ probe: async () => 'unknown' })).toMatchObject({ ok: true, detail: expect.stringContaining('ตรวจไม่ได้') })
})

test('phone row: paired and connected / paired but away / nobody paired', () => {
  const device = { id: 'a', name: 'A7', paired: '2026-10-01T00:00:00.000Z', lastSeen: null }
  expect(phoneRow({ devices: [device], connected: true })).toMatchObject({ id: 'phone', ok: true, detail: expect.stringContaining('เชื่อมต่ออยู่') })
  expect(phoneRow({ devices: [device], connected: false })).toMatchObject({ ok: true, detail: expect.stringContaining('ไม่ได้เชื่อมต่อ') })
  expect(phoneRow({ devices: [], connected: false })).toMatchObject({ ok: false, fix: 'neo devices pair' })
})

test('network row: a Tailscale or LAN address is ok; localhost only is optional with the setting to change', () => {
  const tailscale = { method: 'Tailscale', url: 'http://mac.ts.net:8000', note: '' }
  const usb = { method: 'USB', url: 'http://localhost:8000', note: '' }
  const base = { tailscaleBin: '/opt/homebrew/bin/tailscale', settings: { tailscale: true, lan: false } }
  expect(networkRow({ ...base, addresses: [tailscale, usb] })).toMatchObject({ id: 'network', ok: true, found: { tailscale: '/opt/homebrew/bin/tailscale' } })
  const none = networkRow({ ...base, tailscaleBin: null, addresses: [usb] })
  expect(none).toMatchObject({ ok: false, optional: true, found: { tailscale: null } })
  expect(none.fix).toContain('Tailscale')
  const off = networkRow({ tailscaleBin: null, settings: { tailscale: false, lan: false }, addresses: [usb] })
  expect(off.fix).toContain('neo settings set')
})

test('agents row: lists the agents found and where acpx, orca and ego-browser are', () => {
  const found = { acpx: '/bin/acpx', orca: null, 'ego-browser': null }
  const providers = [
    { name: 'claude', label: 'Claude Code', type: 'claude-code' as const, found: true, model: null },
    { name: 'gemini', label: 'Gemini', type: 'acp' as const, found: true, model: null },
    { name: 'codex', label: 'Codex', type: 'acp' as const, found: false, model: null },
  ]
  const row = agentsRow({ providers, found })
  expect(row).toMatchObject({ id: 'agents', ok: true, found })
  expect(row.detail).toContain('Gemini')
  expect(row.detail).not.toContain('Codex')
  expect(agentsRow({ providers: providers.slice(0, 1), found })).toMatchObject({ ok: false, optional: true })
})
