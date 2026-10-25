import type { SttCall, SttControl } from './types.ts'

type Answer = { text: string } | { error: string }

/** A tiny HTTP server standing in for Apple STT: POST <wav> -> {text} | 500 {error}. Random port, localhost only. */
export class FakeStt implements SttControl {
  readonly calls: SttCall[] = []
  private answers: Answer[] = []
  private gate: Promise<void> | null = null
  private server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: async (req) => {
      const wav = new Uint8Array(await req.arrayBuffer())
      const hints = (new URL(req.url).searchParams.get('hints') ?? '').split(',').filter(Boolean)
      this.calls.push({ wav, hints })
      if (this.gate) await this.gate
      const answer = this.answers.shift() ?? { text: '' }
      return 'error' in answer ? Response.json({ error: answer.error }, { status: 500 }) : Response.json({ text: answer.text })
    },
  })

  get port() {
    return this.server.port
  }

  reply(text: string) {
    this.answers.push({ text })
  }

  fail(message: string) {
    this.answers.push({ error: message })
  }

  hold() {
    let release!: () => void
    this.gate = new Promise<void>((resolve) => (release = resolve))
    return () => {
      this.gate = null
      release()
    }
  }

  stop() {
    return this.server.stop(true)
  }
}
