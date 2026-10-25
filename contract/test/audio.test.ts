import { expect } from 'bun:test'
import { describe, divergent, test, useBackend } from '../src/harness.ts'
import { FRAME_BYTES, loud, muted, phrase, quiet, readWav, rechunk, voiced } from '../src/pcm.ts'

describe('POST /api/audio', () => {
  const s = useBackend()
  const heardAll = async (stream: Awaited<ReturnType<typeof s.phone.events>>) => stream.waitFor('hello')

  test('PCM in odd-sized chunks becomes one WAV for STT, with the wake-word hints', async () => {
    const stream = await s.phone.events()
    await heardAll(stream)
    const before = s.backend.stt.calls.length
    s.backend.stt.reply('ทดสอบการฟังเสียง')
    const upload = s.phone.audio()
    upload.write(rechunk(phrase(8, 11), 1001)) // 1001 bytes: splits samples and frames across chunks

    await stream.waitFor('rec')
    await stream.waitFor('stt')
    expect(await stream.waitFor('heard')).toMatchObject({ text: 'ทดสอบการฟังเสียง' })

    const call = s.backend.stt.calls[before]!
    const wav = readWav(call.wav)
    expect(wav).toMatchObject({ riff: true, channels: 1, sampleRate: 16000, bitsPerSample: 16 })
    expect(call.wav.length).toBe(44 + wav.dataBytes)
    expect(wav.dataBytes % FRAME_BYTES).toBe(0) // whole 100 ms frames, wherever the chunks were cut
    expect(wav.dataBytes).toBeGreaterThanOrEqual(8 * FRAME_BYTES)
    expect(wav.dataBytes).toBeLessThanOrEqual(24 * FRAME_BYTES)
    expect(call.hints).toContain('นีโอ')

    upload.destroy()
    await stream.close()
  })

  test('when the phone ends the upload the reply is 200 {ok:true}', async () => {
    const upload = s.phone.audio()
    upload.write(quiet(3))
    const res = await upload.end()
    expect(res.status).toBe(200)
    expect(res.json).toEqual({ ok: true })
  })

  test('too little voice is a "short", and STT is not called', async () => {
    const stream = await s.phone.events()
    await heardAll(stream)
    const before = s.backend.stt.calls.length
    const upload = s.phone.audio()
    upload.write([...voiced(2), ...quiet(11)])
    await stream.waitFor('rec')
    await stream.waitFor('short')
    await Bun.sleep(300)
    expect(s.backend.stt.calls.length).toBe(before)
    expect(stream.types).not.toContain('stt')
    upload.destroy()
    await stream.close()
  })

  test('a spike is announced as "loud"', async () => {
    const stream = await s.phone.events()
    await heardAll(stream)
    const upload = s.phone.audio()
    upload.write([...loud(2), ...quiet(11)])
    await stream.waitFor('loud')
    upload.destroy()
    await stream.close()
  })

  test('all-zero frames are "muted": they keep the stream alive but abort a segment in progress', async () => {
    const stream = await s.phone.events()
    await heardAll(stream)
    const before = s.backend.stt.calls.length
    const upload = s.phone.audio()
    upload.write([...voiced(6), ...muted(2), ...quiet(14)])
    await stream.waitFor('rec')
    await Bun.sleep(500)
    expect(stream.types).not.toContain('stt')
    expect(s.backend.stt.calls.length).toBe(before)

    // the very same stream still works afterwards
    s.backend.stt.reply('หลังจากเงียบไปพักหนึ่ง')
    upload.write(phrase())
    expect(await stream.waitFor('heard')).toMatchObject({ text: 'หลังจากเงียบไปพักหนึ่ง' })
    upload.destroy()
    await stream.close()
  })

  test('muted frames alone make no events and no STT calls', async () => {
    const stream = await s.phone.events()
    await heardAll(stream)
    const before = s.backend.stt.calls.length
    const upload = s.phone.audio()
    upload.write(muted(15))
    await stream.expectNone((e) => e.type !== 'ping', 600)
    expect(s.backend.stt.calls.length).toBe(before)
    upload.destroy()
    await stream.close()
  })

  test('while STT is busy only the latest waiting segment is kept', async () => {
    const stream = await s.phone.events()
    await heardAll(stream)
    const before = s.backend.stt.calls.length
    const release = s.backend.stt.hold()
    s.backend.stt.reply('ทดสอบหนึ่ง')
    s.backend.stt.reply('ทดสอบสอง')
    const upload = s.phone.audio()

    upload.write(phrase(4)) // A: goes to STT and waits
    await stream.waitFor('stt')
    upload.write(phrase(3)) // B: queued, then replaced by C
    upload.write(phrase(15)) // C
    await Bun.sleep(600)
    release()

    await stream.waitFor((e) => e.type === 'heard' && e.text === 'ทดสอบสอง', 8000)
    const calls = s.backend.stt.calls.slice(before)
    expect(calls).toHaveLength(2)
    expect(readWav(calls[1]!.wav).dataBytes).toBeGreaterThanOrEqual(24 * FRAME_BYTES) // C, not B
    expect(stream.events.filter((e) => e.type === 'heard').map((e) => e.text)).toEqual(['ทดสอบหนึ่ง', 'ทดสอบสอง'])
    upload.destroy()
    await stream.close()
  })

  test('an empty transcript is a "nothing"', async () => {
    const stream = await s.phone.events()
    await heardAll(stream)
    s.backend.stt.reply('')
    const upload = s.phone.audio()
    upload.write(phrase())
    await stream.waitFor('nothing')
    expect(stream.types).not.toContain('heard')
    upload.destroy()
    await stream.close()
  })

  test('two phones can stream at once, each with its own segmenter', async () => {
    const stream = await s.phone.events()
    await heardAll(stream)
    const other = await s.pair('Second')
    const [a, b] = [s.phone.audio(), other.audio()]
    s.backend.stt.reply('เสียงจากเครื่องแรก')
    a.write(phrase())
    await stream.waitFor((e) => e.type === 'heard' && e.text === 'เสียงจากเครื่องแรก')
    s.backend.stt.reply('เสียงจากเครื่องสอง')
    b.write(phrase())
    await stream.waitFor((e) => e.type === 'heard' && e.text === 'เสียงจากเครื่องสอง')
    a.destroy()
    b.destroy()
    await stream.close()
  })
})

// Own backend: on the old one this test kills the process (see the Divergence note).
describe('POST /api/audio, when STT fails', () => {
  const s = useBackend()

  divergent('stt-failure-is-stterr', 'an STT failure is a "stterr" with the reason, and the next phrase still works', async () => {
    const stream = await s.phone.events()
    await stream.waitFor('hello')
    s.backend.stt.fail('boom')
    const upload = s.phone.audio()
    upload.write(phrase())
    const failed = await stream.waitFor('stterr')
    expect(typeof failed.error).toBe('string')
    s.backend.stt.reply('ยังฟังอยู่นะ')
    upload.write(phrase())
    await stream.waitFor((e) => e.type === 'heard' && e.text === 'ยังฟังอยู่นะ')
    upload.destroy()
    await stream.close()
  })
})
