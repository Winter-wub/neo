// The daemon as a separate process (run from source) with a fake neo-stt and a fake claude:
// `neo phone audio` end to end, and the helper being restarted after it is killed.
import { afterAll, expect, test } from 'bun:test'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
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

async function start(extraEnv: Record<string, string> = {}) {
  const { dir, cleanup } = await tempHome()
  const env = {
    PATH: `${join(cliDir, 'test/fake-bin')}:${process.env.PATH}`,
    HOME: dir, TMPDIR: dir, NEO_LOG_DIR: join(dir, 'logs'), NEO_HOME: dir,
    NEO_STT: join(cliDir, 'test/fake-bin/neo-stt'), FAKE_STT_PIDFILE: join(dir, 'stt.pid'), FAKE_CLAUDE_LOG: join(dir, 'claude.log'),
    ...extraEnv,
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
  const wav = join(dir, 'sample.wav')
  await writeFile(wav, toWav([...repeat(tone(0.0005), 4), ...repeat(tone(0.05), 8)]))
  return { dir, neo, wav, env }
}

test('neo phone audio against a real daemon: speech becomes a card, and a killed neo-stt is replaced', async () => {
  const t = await start({ FAKE_STT_TEXT: 'นีโอ วันนี้วันอะไร' })
  const first = await t.neo('phone', 'audio', t.wav)
  expect(first.stderr).toBe('')
  expect(first.code).toBe(0)
  expect(first.stdout).toContain('# ')

  const pid = Number(await readFile(t.env.FAKE_STT_PIDFILE, 'utf8'))
  process.kill(pid, 'SIGKILL')
  await Bun.sleep(200)
  const second = await t.neo('phone', 'audio', t.wav)
  expect(second.code).toBe(0)
  expect(Number(await readFile(t.env.FAKE_STT_PIDFILE, 'utf8'))).not.toBe(pid)
}, 30_000)

test('a neo-stt that is missing gives stterr, exit 1, and the daemon stays up', async () => {
  const t = await start({ NEO_STT: '/nonexistent/neo-stt' })
  const result = await t.neo('phone', 'audio', t.wav)
  expect(result.code).toBe(1)
  expect(result.stderr).toContain('neo-stt')
  expect((await t.neo('status', '-q')).code).toBe(0)
  const doctor = await t.neo('doctor')
  expect(doctor.stdout).toContain('neo-stt')
}, 30_000)
