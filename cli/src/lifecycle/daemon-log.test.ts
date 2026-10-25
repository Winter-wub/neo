import { afterEach, expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { FakeClock, tempHome } from '../../test/helpers'
import { teeConsoleToLog } from './daemon-log'

const cleanups: Array<() => Promise<unknown>> = []
afterEach(async () => void (await Promise.all(cleanups.splice(0).map(c => c()))))

test("the daemon's console output lands in daemon.log with a timestamp, and stderr stays quiet when launchd owns it", async () => {
  const { dir, cleanup } = await tempHome()
  cleanups.push(cleanup)
  const stderr: string[] = []
  const log = teeConsoleToLog({ logDir: dir, clock: new FakeClock(Date.UTC(2026, 9, 26, 3, 4, 5)), passThrough: false, stderr: t => void stderr.push(t) })
  console.error('พร้อมแล้ว', { port: 8123 })
  console.log('line two')
  await log.flush()
  log.restore()
  expect(await readFile(join(dir, 'daemon.log'), 'utf8')).toBe(
    "2026-10-26T03:04:05.000Z พร้อมแล้ว { port: 8123 }\n2026-10-26T03:04:05.000Z line two\n",
  )
  expect(stderr).toEqual([])
})

test('run by hand the lines are echoed to stderr too', async () => {
  const { dir, cleanup } = await tempHome()
  cleanups.push(cleanup)
  const stderr: string[] = []
  const log = teeConsoleToLog({ logDir: dir, clock: new FakeClock(0), passThrough: true, stderr: t => void stderr.push(t) })
  console.error('hi')
  await log.flush()
  log.restore()
  expect(stderr).toEqual(['hi\n'])
})
