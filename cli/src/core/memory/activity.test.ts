import { expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FakeClock } from '../../../test/helpers'
import { createActivity, DAY_MS, HOUR_MS } from './activity'

const at = (day: number, hour: number, minute = 0) => new Date(2026, 9, day, hour, minute).getTime()

async function setup(start = at(26, 9)) {
  const dir = await mkdtemp(join(tmpdir(), 'neo-act-'))
  const clock = new FakeClock(start)
  const file = join(dir, 'activity.json')
  return { dir, file, clock, make: () => createActivity({ file, clock }), cleanup: () => rm(dir, { recursive: true, force: true }) }
}

test('with little data (under 3 days or 10 counts) the quiet hours are 01–05', async () => {
  const s = await setup()
  const a = s.make()
  expect(a.quiet(at(26, 3))).toBe(true)
  expect(a.quiet(at(26, 6))).toBe(false)
  expect(a.quiet(at(26, 0, 59))).toBe(false)
  expect(a.quietHours()).toEqual([1, 2, 3, 4, 5])
  await s.cleanup()
})

test('activity is counted once per hour-slot per 10 minutes and persisted to activity.json', async () => {
  const s = await setup()
  const a = s.make()
  a.touch(at(26, 9))
  a.touch(at(26, 9, 5)) // within 10 minutes: not counted again
  a.touch(at(26, 9, 20))
  expect(a.lastActive()).toBe(at(26, 9, 20))
  const saved = JSON.parse(await readFile(s.file, 'utf8'))
  expect(saved.hours.length).toBe(168)
  expect(saved.hours.reduce((x: number, y: number) => x + y, 0)).toBe(2)
  expect(s.make().lastActive()).toBe(at(26, 9, 20))
  await s.cleanup()
})

test('after 3 days of data the user\'s own pattern decides: an hour that is empty between quiet neighbours is quiet', async () => {
  const s = await setup(at(20, 0))
  const a = s.make()
  // the user is around 8–23 every day for a week
  for (let day = 20; day < 27; day++) for (let h = 8; h < 24; h++) a.touch(at(day, h))
  s.clock.advance(7 * DAY_MS)
  const now = at(27, 12)
  expect(a.quiet(now)).toBe(false) // busy hour
  expect(a.quiet(at(27, 3))).toBe(true) // 2,3,4 are all empty
  expect(a.quiet(at(27, 7))).toBe(false) // 8 is busy next door (>0.25)
  expect(a.profile()[12]).toBe(1)
  expect(a.profile()[3]).toBe(0)
  await s.cleanup()
})

test('a damaged activity.json starts fresh', async () => {
  const s = await setup()
  await writeFile(s.file, '{nope')
  expect(s.make().lastActive()).toBe(s.clock.now())
  await s.cleanup()
})

test('lastDream is kept in the file', async () => {
  const s = await setup()
  const a = s.make()
  expect(a.lastDream()).toBe(0)
  a.setLastDream(at(26, 2))
  expect(s.make().lastDream()).toBe(at(26, 2))
  expect(HOUR_MS).toBe(3_600_000)
  await s.cleanup()
})
