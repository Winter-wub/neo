import { expect, test } from 'bun:test'
import { sttRow } from './doctor'

const checking = (status: string, onDevice = true) => ({
  check: async () => ({ status, onDevice }),
  authorize: async () => ({ status: 'authorized', onDevice }),
})

test('allowed with the Thai on-device model: ok', async () => {
  expect(await sttRow(checking('authorized'))).toMatchObject({ id: 'stt', ok: true })
})

test('permission not asked yet: not ok, and the fix is `neo doctor --fix stt`', async () => {
  expect(await sttRow(checking('notDetermined'))).toMatchObject({ ok: false, fix: 'neo doctor --fix stt' })
})

test('permission denied: not ok, points at System Settings', async () => {
  const row = await sttRow(checking('denied'))
  expect(row.ok).toBe(false)
  expect(row.fix).toContain('System Settings')
})

test('allowed but no Thai model on the Mac: not ok, says what to install', async () => {
  const row = await sttRow(checking('authorized', false))
  expect(row.ok).toBe(false)
  expect(row.detail).toContain('th-TH')
})

test('helper missing or crashing: not ok with the reason', async () => {
  expect(await sttRow({ check: async () => { throw new Error('เปิด neo-stt ไม่ได้ (/x/neo-stt)') } })).toMatchObject({ ok: false, detail: expect.stringContaining('neo-stt') })
  expect(await sttRow({})).toMatchObject({ ok: false })
})

test('fixing asks for the permission and reports the new state', async () => {
  const fake = { ...checking('notDetermined'), authorize: async () => ({ status: 'denied', onDevice: true }) }
  expect(await sttRow(fake, { fix: true })).toMatchObject({ ok: false, detail: expect.stringContaining('ปิดไว้') })
  expect(await sttRow(checking('notDetermined'), { fix: true })).toMatchObject({ ok: true })
})
