import { afterEach, expect, test } from 'bun:test'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tempHome } from '../../../test/helpers'
import { createHelperStt, type HelperStt } from './helper'

const FAKE = join(import.meta.dir, '../../../test/fake-bin/neo-stt')
const cleanups: Array<() => Promise<unknown> | void> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

async function setup(over: Partial<Parameters<typeof createHelperStt>[0]> = {}) {
  const { dir, cleanup } = await tempHome()
  const stt = createHelperStt({ command: FAKE, restartBackoffMs: 0, ...over })
  cleanups.push(() => stt.stop(), cleanup)
  const wav = async (name: string, text?: string) => {
    const file = join(dir, name)
    await writeFile(file, 'RIFF')
    if (text !== undefined) await writeFile(`${file}.txt`, text)
    return file
  }
  return { stt, dir, wav }
}

async function alive(stt: HelperStt) {
  for (let i = 0; i < 100 && !stt.pid(); i++) await Bun.sleep(20)
  return stt.pid()!
}

test('sends {wav, hints} as one JSON line and gets the text back', async () => {
  const log = await tempHome()
  cleanups.push(log.cleanup)
  const { stt, wav } = await setup({ env: { FAKE_STT_LOG: join(log.dir, 'log') } })
  expect(await stt.transcribe(await wav('a.wav', 'นีโอ ทดสอบ'), ['นีโอ', 'Jira'])).toBe('นีโอ ทดสอบ')
  expect(JSON.parse((await readFile(join(log.dir, 'log'), 'utf8')).trim())).toMatchObject({ hints: ['นีโอ', 'Jira'] })
})

test('an {error} reply rejects with that message', async () => {
  const { stt, wav } = await setup()
  await expect(stt.transcribe(await wav('missing.wav'), [])).rejects.toThrow('ถอดเสียงไม่ได้')
})

test('requests made at once are answered in order, one at a time', async () => {
  const { stt, wav } = await setup()
  const files = await Promise.all(['one', 'two', 'three'].map(t => wav(`${t}.wav`, t)))
  expect(await Promise.all(files.map(f => stt.transcribe(f, [])))).toEqual(['one', 'two', 'three'])
})

test('when the helper is killed the in-flight request fails, and the next one works on a restarted helper', async () => {
  const { stt, wav } = await setup({ command: FAKE })
  expect(await stt.transcribe(await wav('a.wav', 'ก่อน'), [])).toBe('ก่อน')
  const first = await alive(stt)
  process.kill(first, 'SIGKILL')
  await Bun.sleep(100)
  expect(await stt.transcribe(await wav('b.wav', 'หลัง'), [])).toBe('หลัง')
  expect(stt.pid()).not.toBe(first)
})

test('a request pending while the helper dies is rejected, not left hanging', async () => {
  const { stt, wav } = await setup({ command: FAKE })
  await stt.transcribe(await wav('a.wav', 'x'), [])
  const pid = (await alive(stt))
  process.kill(pid, 'SIGSTOP') // frozen: the request can never be answered
  const pending = stt.transcribe(await wav('b.wav', 'y'), [])
  const outcome = pending.then(() => 'answered', e => (e as Error).message)
  await Bun.sleep(50)
  process.kill(pid, 'SIGKILL')
  expect(await outcome).toContain('neo-stt')
})

test('a helper that does not exist fails requests clearly instead of throwing at startup', async () => {
  const { stt, wav } = await setup({ command: '/nonexistent/neo-stt' })
  await expect(stt.transcribe(await wav('a.wav', 'x'), [])).rejects.toThrow('neo-stt')
})

test('a request the helper never answers times out and the helper is replaced', async () => {
  const { stt, wav } = await setup({ timeoutMs: 100 })
  await stt.transcribe(await wav('a.wav', 'x'), [])
  const pid = await alive(stt)
  process.kill(pid, 'SIGSTOP')
  await expect(stt.transcribe(await wav('b.wav', 'y'), [])).rejects.toThrow('neo-stt')
  process.kill(pid, 'SIGKILL')
  expect(await stt.transcribe(await wav('c.wav', 'z'), [])).toBe('z')
})

test('check reports the Speech permission; authorize asks for it', async () => {
  const { stt } = await setup()
  expect(await stt.check()).toEqual({ status: 'authorized', onDevice: true })
  expect(await stt.authorize()).toEqual({ status: 'authorized', onDevice: true })
})
