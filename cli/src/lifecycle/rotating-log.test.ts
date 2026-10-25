import { afterEach, expect, test } from 'bun:test'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tempHome } from '../../test/helpers'
import { RotatingLog } from './rotating-log'

const cleanups: Array<() => Promise<unknown>> = []
afterEach(async () => void (await Promise.all(cleanups.splice(0).map(c => c()))))

async function logDir() {
  const { dir, cleanup } = await tempHome()
  cleanups.push(cleanup)
  return dir
}

test('appends lines to daemon.log', async () => {
  const dir = await logDir()
  const log = new RotatingLog({ file: join(dir, 'daemon.log') })
  await log.append('one\n')
  await log.append('two\n')
  expect(await readFile(join(dir, 'daemon.log'), 'utf8')).toBe('one\ntwo\n')
})

test('rotates when the next line would pass the size limit, keeping 3 old files', async () => {
  const dir = await logDir()
  const log = new RotatingLog({ file: join(dir, 'daemon.log'), maxBytes: 10, keep: 3 })
  for (const n of [1, 2, 3, 4, 5]) await log.append(`line-${n}\n`.padEnd(8, '.') + '\n')
  const files = (await readdir(dir)).sort()
  expect(files).toEqual(['daemon.log', 'daemon.log.1', 'daemon.log.2', 'daemon.log.3'])
  expect(await readFile(join(dir, 'daemon.log'), 'utf8')).toContain('line-5')
  expect(await readFile(join(dir, 'daemon.log.1'), 'utf8')).toContain('line-4')
  expect(await readFile(join(dir, 'daemon.log.3'), 'utf8')).toContain('line-2')
})

test('picks up the size of an existing file, so a restart does not reset the 5 MB budget', async () => {
  const dir = await logDir()
  const file = join(dir, 'daemon.log')
  await new RotatingLog({ file, maxBytes: 20 }).append('x'.repeat(15) + '\n')
  await new RotatingLog({ file, maxBytes: 20 }).append('y'.repeat(10) + '\n')
  expect(await readFile(join(dir, 'daemon.log.1'), 'utf8')).toStartWith('xxx')
  expect(await readFile(file, 'utf8')).toStartWith('yyy')
})

test('defaults to 5 MB', () => {
  expect(RotatingLog.DEFAULT_MAX_BYTES).toBe(5 * 1024 * 1024)
})
