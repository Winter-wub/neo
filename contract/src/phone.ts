import http from 'node:http'
import type { Backend } from './types.ts'

export interface Reply<T = any> {
  status: number
  headers: Headers
  text: string
  json: T
}

export type NeoEvent = { type: string; at?: number; [key: string]: any }

const parse = (text: string) => {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

/** HTTP as NeoApp does it: a bearer device token plus whatever the driver says every phone request carries. */
export class Phone {
  constructor(
    readonly backend: Backend,
    readonly token?: string,
  ) {}

  headers(extra: Record<string, string> = {}) {
    return {
      ...this.backend.phoneHeaders,
      ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
      ...extra,
    }
  }

  async request(method: string, path: string, body?: unknown, extra: Record<string, string> = {}): Promise<Reply> {
    const raw = body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body)
    const res = await fetch(this.backend.baseUrl + path, { method, headers: this.headers(extra), body: raw })
    const text = await res.text()
    return { status: res.status, headers: res.headers, text, json: parse(text) }
  }

  get = (path: string, extra?: Record<string, string>) => this.request('GET', path, undefined, extra)
  post = (path: string, body: unknown = {}, extra?: Record<string, string>) => this.request('POST', path, body, extra)

  events() {
    return EventStream.open(this)
  }

  audio() {
    return new AudioUpload(this)
  }
}

/** A paired phone: asks the backend for a code and trades it for a device token. */
export async function pair(backend: Backend, name = 'CONTRACT Test') {
  const code = await backend.getPairingCode()
  const res = await new Phone(backend).post('/api/pair', { code, name })
  if (res.status !== 200) throw new Error(`pairing failed: ${res.status} ${res.text}`)
  return new Phone(backend, res.json.token)
}

/** GET /api/events, kept open. Lines arrive in `raw` (exactly as on the wire) and `events` (parsed). */
export class EventStream {
  readonly raw: string[] = []
  readonly events: NeoEvent[] = []
  status = 0
  headers = new Headers()
  body = ''
  private abort = new AbortController()
  private listeners = new Set<() => void>()
  private done: Promise<void> = Promise.resolve()

  static async open(phone: Phone, extra: Record<string, string> = {}) {
    const stream = new EventStream()
    const res = await fetch(phone.backend.baseUrl + '/api/events', { headers: phone.headers(extra), signal: stream.abort.signal })
    stream.status = res.status
    stream.headers = res.headers
    stream.done = stream.pump(res)
    if (res.status !== 200) {
      await stream.done
      return stream
    }
    return stream
  }

  private async pump(res: Response) {
    const decoder = new TextDecoder()
    let buffer = ''
    try {
      const reader = res.body?.getReader()
      if (!reader) return
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        let at: number
        while ((at = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, at)
          buffer = buffer.slice(at + 1)
          if (this.status !== 200) this.body += line
          else if (line) {
            this.raw.push(line)
            const event = parse(line)
            if (event) this.events.push(event)
          }
          this.listeners.forEach((wake) => wake())
        }
      }
    } catch {
      // aborted by close()
    }
    if (this.status !== 200) this.body += buffer
    this.listeners.forEach((wake) => wake())
  }

  get types() {
    return this.events.map((e) => e.type)
  }

  /** The first event (from `from` on) that satisfies `match`, waiting up to `ms`. */
  async waitFor(match: string | ((e: NeoEvent) => boolean), ms = 5000, from = 0): Promise<NeoEvent> {
    const test = typeof match === 'string' ? (e: NeoEvent) => e.type === match : match
    const deadline = Date.now() + ms
    for (;;) {
      const hit = this.events.slice(from).find(test)
      if (hit) return hit
      const left = deadline - Date.now()
      if (left <= 0) throw new Error(`no matching event within ${ms} ms; saw: ${JSON.stringify(this.events.map((e) => e.type))}`)
      await new Promise<void>((resolve) => {
        const wake = () => {
          clearTimeout(timer)
          this.listeners.delete(wake)
          resolve()
        }
        const timer = setTimeout(wake, left)
        this.listeners.add(wake)
      })
    }
  }

  /** Assert that no event matching `match` shows up for `ms` (from `from` on). */
  async expectNone(match: string | ((e: NeoEvent) => boolean), ms = 500, from = this.events.length) {
    const test = typeof match === 'string' ? (e: NeoEvent) => e.type === match : match
    await Bun.sleep(ms)
    const hit = this.events.slice(from).find(test)
    if (hit) throw new Error(`unexpected event: ${JSON.stringify(hit)}`)
  }

  /** The raw line of the first event of this type. */
  rawOf(type: string) {
    const at = this.events.findIndex((e) => e.type === type)
    return at < 0 ? undefined : this.raw[this.rawIndex(at)]
  }

  // events[] skips unparseable lines; raw[] does not. They only differ when a line is not JSON.
  private rawIndex(eventIndex: number) {
    let seen = -1
    for (let i = 0; i < this.raw.length; i++) if (parse(this.raw[i]!) && ++seen === eventIndex) return i
    return -1
  }

  async close() {
    this.abort.abort()
    await this.done
  }
}

/** POST /api/audio: one long chunked request. write() sends PCM, end() finishes the request and gives the reply. */
export class AudioUpload {
  private req: http.ClientRequest
  private response: Promise<Reply>

  constructor(phone: Phone) {
    const url = new URL(phone.backend.baseUrl)
    this.response = new Promise<Reply>((resolve, reject) => {
      this.req = http.request(
        {
          host: url.hostname,
          port: url.port,
          path: '/api/audio',
          method: 'POST',
          headers: { ...phone.headers(), 'content-type': 'application/octet-stream', 'transfer-encoding': 'chunked' },
        },
        (res) => {
          let text = ''
          res.on('data', (d) => (text += d))
          res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: new Headers(), text, json: parse(text) }))
        },
      )
      this.req.on('error', reject)
    })
    this.response.catch(() => {})
  }

  write(chunks: Buffer | Buffer[]) {
    for (const chunk of Array.isArray(chunks) ? chunks : [chunks]) this.req.write(chunk)
    return this
  }

  /** Finish the request body; resolves with the server's reply. */
  end() {
    this.req.end()
    return this.response
  }

  /** Drop the connection the way a phone going offline does. */
  destroy() {
    this.req.destroy()
  }
}
