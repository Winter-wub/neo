import { join } from 'node:path'
import { PROTOCOL_HEADER, PROTOCOL_VERSION, type ErrorBody, type Routes, type StreamLine } from '../../protocol'
import { SOCKET_NAME } from './server'

export class DaemonDown extends Error {}
export class DaemonIncompatible extends Error {}
/** The daemon answered, but with an error body. */
export class CommandFailed extends Error {
  constructor(message: string, readonly code: number) {
    super(message)
  }
}

export function connect(home: string) {
  const unix = join(home, SOCKET_NAME)

  async function send(method: string, path: string, body?: unknown, signal?: AbortSignal, raw?: Uint8Array) {
    let res: Response
    try {
      res = await fetch(`http://neo${path}`, {
        unix,
        method,
        signal,
        ...(raw ? { body: raw as unknown as BodyInit, headers: { 'content-type': 'application/octet-stream' } } : {}),
        ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }),
      })
    } catch (e) {
      if (signal?.aborted) throw e
      throw new DaemonDown(`Neo ไม่ได้ทำงานอยู่ (ไม่พบ ${unix})`)
    }
    const protocol = Number(res.headers.get(PROTOCOL_HEADER))
    if (protocol !== PROTOCOL_VERSION) {
      throw new DaemonIncompatible(`neo (protocol ${PROTOCOL_VERSION}) ใช้กับ Neo daemon (protocol ${protocol || 'ไม่ทราบ'}) ไม่ได้ ให้รีสตาร์ท daemon`)
    }
    return res
  }

  async function call<K extends keyof Routes>(
    route: K,
    ...[body]: Routes[K] extends { body: infer B } ? [body: B] : []
  ): Promise<Routes[K]['response']> {
    const [method, path] = route.split(' ') as [string, string]
    const res = await send(method, path, body)
    const data = await res.json()
    if (!res.ok) throw new CommandFailed((data as ErrorBody).error, (data as ErrorBody).code)
    return data as Routes[K]['response']
  }

  /** For routes whose body is a file, not JSON (`neo phone audio`). */
  async function upload<K extends 'POST /phone/audio'>(route: K, bytes: Uint8Array): Promise<Routes[K]['response']> {
    const [method, path] = route.split(' ') as [string, string]
    const res = await send(method, path, undefined, undefined, bytes)
    const data = await res.json()
    if (!res.ok) throw new CommandFailed((data as ErrorBody).error, (data as ErrorBody).code)
    return data as Routes[K]['response']
  }

  async function* events({ history = false, signal }: { history?: boolean; signal?: AbortSignal } = {}): AsyncGenerator<StreamLine> {
    const res = await send('GET', `/events${history ? '?history=1' : ''}`, undefined, signal)
    if (!res.ok || !res.body) throw new CommandFailed('เปิดสตรีมไม่ได้', 1)
    const decoder = new TextDecoder()
    let buffer = ''
    try {
      for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
        buffer += decoder.decode(chunk, { stream: true })
        for (let nl = buffer.indexOf('\n'); nl >= 0; nl = buffer.indexOf('\n')) {
          const text = buffer.slice(0, nl)
          buffer = buffer.slice(nl + 1)
          if (text) yield JSON.parse(text) as StreamLine
        }
      }
    } catch (e) {
      if (!signal?.aborted) throw e
    }
  }

  return { call, upload, events }
}

export type Daemon = ReturnType<typeof connect>
