import { afterEach, expect, test } from 'bun:test'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { FakeClock, tempHome } from '../../../test/helpers'
import { textCard } from '../../core/cards/cards'
import { createCore } from '../../core/core'
import { FRAME, toWav } from '../../core/ears/segmenter'
import { runCli } from './cli'
import { startCommandServer } from './server'

const cleanups: Array<() => Promise<unknown>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

const tone = (rms: number) => Int16Array.from({ length: FRAME }, (_, i) => Math.round((i % 2 ? 1 : -1) * rms * 32768))
const repeat = (frame: Int16Array, n: number) => Array.from({ length: n }, () => frame)

async function running(stt: object) {
  const { dir, cleanup } = await tempHome()
  const clock = new FakeClock()
  const core = await createCore({
    home: dir, clock, pid: 1, audioDir: dir,
    brain: {
      label: 'Fake',
      ask: async r => ({ answer: { type: 'card', card: textCard({ title: r.text, lines: ['คำตอบ'] }) }, session: 's' }),
      runSkill: async () => ({ answer: { type: 'error', error: 'no' }, session: null }),
    },
    stt: stt as never,
  })
  const server = await startCommandServer({ core, clock, home: dir })
  cleanups.push(cleanup, () => server.stop())
  const wav = join(dir, 'sample.wav')
  await writeFile(wav, toWav([...repeat(tone(0.0005), 4), ...repeat(tone(0.05), 8)]))
  return { dir, wav }
}

function run(args: string[]) {
  const out: string[] = []
  const err: string[] = []
  const io = { out: (t: string) => void out.push(t), err: (t: string) => void err.push(t), env: {} }
  return runCli(args, io).then(code => ({ code, stdout: out.join(''), stderr: err.join('') }))
}

const says = (text: string) => ({ transcribe: async () => text })

test('neo phone audio <wav> prints the card the phone would have shown', async () => {
  const { dir, wav } = await running(says('นีโอ วันนี้วันอะไร'))
  const r = await run(['phone', 'audio', wav, '--home', dir])
  expect(r.code).toBe(0)
  expect(r.stdout).toContain('# วันนี้วันอะไร')
})

test('--json prints the transcripts and the outcome', async () => {
  const { dir, wav } = await running(says('นีโอ วันนี้วันอะไร'))
  const r = await run(['phone', 'audio', wav, '--json', '--home', dir])
  expect(r.code).toBe(0)
  expect(JSON.parse(r.stdout)).toMatchObject({ transcripts: ['นีโอ วันนี้วันอะไร'], outcome: { outcome: 'card' } })
})

test('words not addressed to Neo exit 1 and say how to fix it; silence and STT failures exit 1 too', async () => {
  const a = await running(says('ราคาทองวันนี้เท่าไหร่'))
  const heard = await run(['phone', 'audio', a.wav, '--home', a.dir])
  expect(heard.code).toBe(1)
  expect(heard.stderr).toContain('ชื่อเรียก')

  const b = await running(says(''))
  const nothing = await run(['phone', 'audio', b.wav, '--home', b.dir])
  expect(nothing.code).toBe(1)
  expect(nothing.stderr).toContain('ไม่ได้ยินเป็นคำพูด')

  const c = await running({ transcribe: async () => { throw new Error('neo-stt หยุดทำงานกลางคัน') } })
  const broken = await run(['phone', 'audio', c.wav, '--home', c.dir])
  expect(broken.code).toBe(1)
  expect(broken.stderr).toContain('neo-stt หยุดทำงานกลางคัน')
})

test('a missing file or a non-WAV file exits 1 with a message', async () => {
  const { dir } = await running(says('x'))
  const missing = await run(['phone', 'audio', join(dir, 'nope.wav'), '--home', dir])
  expect(missing.code).toBe(1)
  expect(missing.stderr).toContain('nope.wav')
  await writeFile(join(dir, 'bad.wav'), 'not a wav')
  const bad = await run(['phone', 'audio', join(dir, 'bad.wav'), '--home', dir])
  expect(bad.code).toBe(1)
  expect(bad.stderr).toContain('ffmpeg')
})

test('usage: phone audio needs a file, doctor --fix needs an id', async () => {
  const { dir } = await running(says('x'))
  expect((await run(['phone', 'audio', '--home', dir])).code).toBe(2)
  expect((await run(['phone', 'nope', '--home', dir])).code).toBe(2)
  expect((await run(['doctor', '--fix', '--home', dir])).code).toBe(2)
})

test('neo doctor lists the checks; --fix stt asks for the permission and exits 1 only if it is still not ok', async () => {
  const state = { status: 'notDetermined', after: 'authorized' }
  const { dir } = await running({
    transcribe: async () => '',
    check: async () => ({ status: state.status, onDevice: true }),
    authorize: async () => ({ status: (state.status = state.after), onDevice: true }),
  })
  const before = await run(['doctor', '--home', dir])
  expect(before.code).toBe(0)
  expect(before.stdout).toContain('neo doctor --fix stt')
  const fixed = await run(['doctor', '--fix', 'stt', '--home', dir])
  expect(fixed.code).toBe(0)
  expect(fixed.stdout).toContain('อนุญาตแล้ว')

  const denied = await running({ transcribe: async () => '', check: async () => ({ status: 'denied', onDevice: true }), authorize: async () => ({ status: 'denied', onDevice: true }) })
  expect((await run(['doctor', '--fix', 'stt', '--home', denied.dir])).code).toBe(1)
  expect((await run(['doctor', '--fix', 'nope', '--home', denied.dir])).code).toBe(1)
})

test('neo events shows the speech events as one line each', async () => {
  const { dir, wav } = await running(says('นีโอ วันนี้วันอะไร'))
  const abort = new AbortController()
  const out: string[] = []
  const events = runCli(['events', '--home', dir], { out: t => void out.push(t), err: () => {}, env: {}, signal: abort.signal })
  await Bun.sleep(100)
  await run(['phone', 'audio', wav, '--home', dir])
  await Bun.sleep(100)
  abort.abort()
  await events
  const text = out.join('')
  expect(text).toContain('rec')
  expect(text).toContain('stt')
  expect(text).toContain('heard')
})
