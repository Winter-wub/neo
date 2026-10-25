import type { Core } from '../../core/core'
import { WavError, listenToWav } from '../../core/ears/file'
import type { PhoneAudioResult } from '../../protocol'

const MAX_WAV = 50_000_000

type Handled = { status: number; body: unknown }

/** The speech routes of the command socket: `neo phone audio` and the stt part of `neo doctor`. */
export async function speechRoute(core: Core, route: string, req: Request, readJson: () => Promise<unknown>): Promise<Handled | undefined> {
  switch (route) {
    case 'POST /phone/audio': {
      const wav = new Uint8Array(await req.arrayBuffer())
      if (wav.length > MAX_WAV) return { status: 413, body: { error: 'ไฟล์เสียงใหญ่เกินไป', code: 1 } }
      try {
        const { transcripts, outcome } = await listenToWav(core.ears, wav)
        return { status: 200, body: { transcripts, outcome: outcome ?? { outcome: 'nothing' } } satisfies PhoneAudioResult }
      } catch (e) {
        if (e instanceof WavError) return { status: 400, body: { error: e.message, code: 1 } }
        throw e
      }
    }
    case 'GET /doctor':
      return { status: 200, body: await core.doctor.rows() }
    case 'POST /doctor/fix': {
      const { id } = (await readJson()) as { id?: unknown }
      const row = await core.doctor.fix(String(id))
      return row ? { status: 200, body: row } : { status: 404, body: { error: `ไม่มีวิธีแก้อัตโนมัติสำหรับ ${id}`, code: 1 } }
    }
  }
  return undefined
}
