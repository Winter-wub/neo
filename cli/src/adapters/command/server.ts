import { chmod, mkdir, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import type { Clock } from '../../core/clock'
import type { Core } from '../../core/core'
import { BrainError } from '../../core/brain/hub'
import { JobsError } from '../../core/jobs/jobs'
import { MemoryError } from '../../core/memory/memory'
import { SettingsError } from '../../core/settings/settings'
import { brainRoute } from './brain-routes'
import { jobsRoute } from './jobs-routes'
import { dreamRoute } from './dream-routes'
import { memoryRoute, memoryStatus } from './memory-routes'
import { petRoute } from './pet-routes'
import { speechRoute } from './speech-routes'
import {
  DAEMON_VERSION, PING_INTERVAL_MS, PROTOCOL_HEADER, PROTOCOL_VERSION,
  type DaemonInfo, type ErrorBody, type SayResult, type Routes, type StreamLine,
} from '../../protocol'

export const SOCKET_NAME = 'neo.sock'
/** sun_path is 104 bytes on macOS, including the terminator. */
const SOCKET_PATH_MAX = 103
const MAX_BODY = 20_000
const SAY_MAX = 300

export class DaemonStartError extends Error {}

const headers = { [PROTOCOL_HEADER]: String(PROTOCOL_VERSION) }
const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { ...headers, 'content-type': 'application/json; charset=utf-8' } })
const fail = (error: string, code: number, status: number) => json({ error, code } satisfies ErrorBody, status)

async function socketIsLive(path: string) {
  try {
    const socket = await Bun.connect({ unix: path, socket: { data() {}, open(s) { s.end() } } })
    socket.end()
    return true
  } catch {
    return false
  }
}

export interface CommandServerOptions {
  core: Core
  clock: Clock
  home: string
  build?: string
  pingMs?: number
}

export async function startCommandServer({ core, clock, home, build = 'dev', pingMs = PING_INTERVAL_MS }: CommandServerOptions) {
  const path = join(home, SOCKET_NAME)
  if (Buffer.byteLength(path) > SOCKET_PATH_MAX) throw new DaemonStartError(`path ของ socket ยาวเกินไป: ${path}`)
  await mkdir(home, { recursive: true, mode: 0o700 })
  if (await socketIsLive(path)) throw new DaemonStartError(`Neo ทำงานอยู่แล้วที่ ${path}`)
  await unlink(path).catch(() => {})

  const info: DaemonInfo = { version: DAEMON_VERSION, build, protocol: PROTOCOL_VERSION }
  const encoder = new TextEncoder()
  const line = (value: StreamLine) => encoder.encode(JSON.stringify(value) + '\n')

  function events(history: boolean) {
    let detach = () => {}
    let stopPing = () => {}
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const send = (value: StreamLine) => {
          try { controller.enqueue(line(value)) } catch { /* client already gone */ }
        }
        stopPing = clock.every(pingMs, () => send({ type: 'ping' }))
        detach = core.attach(send, { history })
      },
      cancel() {
        stopPing()
        detach()
      },
    })
    return new Response(stream, {
      headers: { ...headers, 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-cache' },
    })
  }

  async function readBody(req: Request): Promise<unknown> {
    const text = await req.text()
    if (text.length > MAX_BODY) throw new SettingsError('ข้อมูลใหญ่เกินไป')
    return text ? JSON.parse(text) : {}
  }

  const server = Bun.serve({
    unix: path,
    // streams (neo events) stay open for hours without a byte. Missing from the unix Options typing, hence the spread.
    ...({ idleTimeout: 0 } as object),
    async fetch(req, srv) {
      const url = new URL(req.url)
      const route = `${req.method} ${url.pathname}` as keyof Routes | (string & {})
      try {
        switch (route) {
          case 'GET /daemon/info': return json(info)
          case 'GET /status': return json(core.status())
          case 'GET /settings': return json(core.settings.get())
          case 'POST /settings': return json(await core.settings.set((await readBody(req)) as Routes['POST /settings']['body']))
          case 'POST /settings/set': {
            const { name, args } = (await readBody(req)) as Routes['POST /settings/set']['body']
            return json(await core.settings.setByKey(String(name), Array.isArray(args) ? args.map(String) : []))
          }
          case 'POST /say': {
            const { text, wait = true } = (await readBody(req)) as Routes['POST /say']['body']
            const said = typeof text === 'string' ? text.trim().slice(0, SAY_MAX) : ''
            if (!said) return fail('ไม่มีข้อความ', 1, 400)
            const turn = core.say(said)
            if (!wait) {
              turn.catch(e => console.error('say failed:', e))
              return json({ outcome: 'accepted' } satisfies SayResult)
            }
            return json(await turn)
          }
          case 'POST /cancel': return json({ cancelled: core.cancel() })
          case 'POST /devices/pair': return json({ ...core.devices.startPairing(), addresses: core.devices.addresses() })
          case 'GET /devices': return json(core.devices.list())
          case 'POST /devices/revoke': {
            const { id } = (await readBody(req)) as Routes['POST /devices/revoke']['body']
            return core.devices.revoke(String(id)) ? json({ ok: true }) : fail(`ไม่พบอุปกรณ์ id ${id} (ดู neo devices list)`, 1, 404)
          }
          case 'GET /events':
            srv.timeout(req, 0) // the stream stays open for hours without a byte
            return events(url.searchParams.get('history') === '1')
          default: {
            const speech = await speechRoute(core, route, req, () => readBody(req))
            if (speech) return json(speech.body, speech.status)
            const job = await jobsRoute(core.jobs, route, () => readBody(req))
            if (job !== undefined) return json(job)
            const brain = await brainRoute(core, route, () => readBody(req))
            if (brain !== undefined) return json(brain)
            const petty = await petRoute(core, route, () => readBody(req))
            if (petty !== undefined) return json(petty)
            const dreamt = await dreamRoute(core, route, () => readBody(req))
            if (dreamt !== undefined) return json(dreamt)
            const handled = await memoryRoute(core.memory, route, () => readBody(req))
            return handled === undefined ? fail('ไม่พบคำสั่งนี้', 1, 404) : json(handled)
          }
        }
      } catch (e) {
        if (e instanceof SettingsError || e instanceof BrainError) return fail(e.message, 1, 400)
        if (e instanceof MemoryError) return fail(e.message, 1, memoryStatus(e))
        if (e instanceof JobsError) return fail(e.message, 1, e.status)
        if (e instanceof SyntaxError) return fail('ข้อมูลไม่ใช่ JSON', 1, 400)
        console.error('command route failed:', route, e)
        return fail('Neo ขัดข้อง', 1, 500)
      }
    },
  })
  await chmod(path, 0o600)

  return {
    path,
    async stop() {
      await server.stop(true)
      await unlink(path).catch(() => {})
    },
  }
}

export type CommandServer = Awaited<ReturnType<typeof startCommandServer>>
