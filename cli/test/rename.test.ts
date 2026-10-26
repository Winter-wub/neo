// Ticket 30 end to end: rename the pet by voice against a real daemon process, a fake neo-stt and a fake claude.
// `neo say` carries typed words; the three training takes arrive as audio (`neo phone audio`), as real speech would.
import { afterAll, expect, test } from 'bun:test'
import { copyFile, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { FRAME, toWav } from '../src/core/ears/segmenter'
import { tempHome } from './helpers'

const cliDir = join(import.meta.dir, '..')
const cleanups: Array<() => Promise<unknown>> = []
afterAll(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

const tone = (rms: number) => Int16Array.from({ length: FRAME }, (_, i) => Math.round((i % 2 ? 1 : -1) * rms * 32768))
const repeat = (frame: Int16Array, n: number) => Array.from({ length: n }, () => frame)

async function start() {
  const { dir, cleanup } = await tempHome()
  const env = {
    PATH: `${join(cliDir, 'test/fake-bin')}:${process.env.PATH}`,
    HOME: dir, TMPDIR: dir, NEO_LOG_DIR: join(dir, 'logs'), NEO_HOME: dir, NEO_DISCOVER: '0',
    NEO_STT: join(cliDir, 'test/fake-bin/neo-stt'), FAKE_STT_PIDFILE: join(dir, 'stt.pid'), FAKE_CLAUDE_LOG: join(dir, 'claude.log'),
  }
  await mkdir(env.NEO_LOG_DIR, { recursive: true })
  const daemon = Bun.spawn(['bun', 'src/main.ts', 'daemon', 'run', '--home', dir, '--port', String(20_000 + Math.floor(Math.random() * 20_000))], { cwd: cliDir, env, stdout: 'ignore', stderr: 'ignore' })
  cleanups.push(async () => { daemon.kill('SIGTERM'); await daemon.exited; await cleanup() })
  const neo = async (...args: string[]) => {
    const p = Bun.spawn(['bun', 'src/main.ts', ...args, '--home', dir], { cwd: cliDir, env, stdout: 'pipe', stderr: 'pipe' })
    const [stdout, stderr, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited])
    return { stdout, stderr, code }
  }
  for (let i = 0; i < 200 && (await neo('status', '-q')).code !== 0; i++) await Bun.sleep(50)
  const base = join(dir, 'base.wav')
  await writeFile(base, toWav([...repeat(tone(0.0005), 4), ...repeat(tone(0.05), 8)]))
  let takes = 0
  /** Speech as the recogniser wrote it. */
  const speak = async (text: string) => {
    const wav = join(dir, `take${takes++}.wav`)
    await copyFile(base, wav)
    await writeFile(`${wav}.txt`, text)
    return neo('phone', 'audio', wav)
  }
  return { neo, speak }
}

test('"เปลี่ยนชื่อเป็นมิว" → confirm card → three takes → the new name is saved; ยกเลิก keeps it', async () => {
  const t = await start()
  const asked = await t.neo('say', 'นีโอ เปลี่ยนชื่อเป็นมิว')
  expect(asked.code).toBe(0)
  expect(asked.stdout).toContain('เปลี่ยนชื่อเป็น “มิว” ใช่ไหม')

  const confirmed = await t.neo('say', 'ตกลง')
  expect(confirmed.stdout).toContain('พูดว่า “มิว” 3 ครั้ง')
  // a take is swallowed as a sample, so `phone audio` reports it was not addressed (exit 1)
  for (const take of ['มิว', 'หมิว', 'มิ้ว']) await t.speak(take)
  const named = await t.neo('name')
  expect(named.stdout).toContain('มิว')
  expect(named.stdout).not.toContain('training')

  await t.neo('say', 'มิว เปลี่ยนชื่อเป็นโมจิ')
  await t.neo('say', 'ตกลง')
  await t.speak('โมจิ')
  await t.speak('ยกเลิก')
  const kept = await t.neo('name')
  expect(kept.stdout).toContain('มิว')
  expect(kept.stdout).not.toContain('โมจิ')
}, 60_000)
