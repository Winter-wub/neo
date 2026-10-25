import { stat } from 'node:fs/promises'
import type { Clock } from '../../core/clock'
import type { Core } from '../../core/core'
import { PING_INTERVAL_MS, type HelloEvent, type PairAddress, type StreamLine } from '../../protocol'
import { systemNetworks, systemTailscale, type Network, type TailscaleInfo } from './networks'
import { encodeLine } from './wire'

export type { Network } from './networks'

const MAX_BODY = 20_000
const REBIND_MS = 60_000
const LOCALHOST = '127.0.0.1'

export interface PhoneServerOptions {
  core: Core
  clock: Clock
  /** 0 picks a free port (tests). */
  port: number
  /** The bundled `neo.apk`; absent file → 404 `no apk`. */
  apkPath: string
  pingMs?: number
  networks?: () => Network[]
  tailscale?: () => Promise<TailscaleInfo | null>
}

class BodyTooLarge extends Error {}

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'content-type': 'application/json; charset=utf-8' } })
const fail = (error: string, status: number) => json({ error }, status)
const hostPart = (ip: string) => (ip.includes(':') ? `[${ip}]` : ip)

/** The phone port: NeoApp's routes only, device token on everything but hello/pair/apk. */
export async function startPhoneServer(options: PhoneServerOptions) {
  const { core, clock, apkPath, pingMs = PING_INTERVAL_MS, networks = systemNetworks, tailscale = systemTailscale } = options

  const hello = (): HelloEvent => {
    const { thinking, provider } = core.status()
    return { type: 'hello', thinking, provider, name: core.identity.wake().name, face: core.identity.face(), idle: core.settings.get().idle, ringing: core.jobs.ringing()?.title ?? null }
  }

  function events() {
    let detach = () => {}
    let stopPing = () => {}
    const encoder = new TextEncoder()
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const send = (line: StreamLine) => {
          try { controller.enqueue(encoder.encode(encodeLine(line))) } catch { /* phone already gone */ }
        }
        send(hello())
        // a dream the phone has not shown yet is told again on every connect, until /api/dream/seen
        const dream = core.memory.dreams.pending()
        if (dream) send({ type: 'dream_done', at: dream.at, card: dream.card })
        stopPing = clock.every(pingMs, () => send({ type: 'ping' }))
        // `status` is for consoles; the phone never got it (contract: a muted mic means nothing but pings)
        detach = core.attach(event => { if (event.type !== 'status') send(event) })
      },
      cancel() {
        stopPing()
        detach()
      },
    })
    return new Response(stream, { headers: { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-cache' } })
  }

  /** NeoApp's mic: raw PCM s16le 16 kHz mono, 100 ms at a time, until the phone hangs up. */
  async function audio(req: Request) {
    const stream = core.ears.open()
    try {
      if (req.body) for await (const chunk of req.body as unknown as AsyncIterable<Uint8Array>) stream.push(chunk)
    } catch {
      // the phone dropped the connection
    } finally {
      stream.close()
    }
    return json({ ok: true })
  }

  async function readBody(req: Request): Promise<Record<string, unknown>> {
    const text = await req.text()
    if (text.length > MAX_BODY) throw new BodyTooLarge()
    return text ? JSON.parse(text) : {}
  }

  async function apk() {
    const info = await stat(apkPath).catch(() => null)
    if (!info?.isFile()) return new Response('no apk', { status: 404 })
    return new Response(Bun.file(apkPath), {
      headers: {
        'content-type': 'application/vnd.android.package-archive',
        'content-length': String(info.size),
        'content-disposition': 'attachment; filename="neo.apk"',
      },
    })
  }

  async function handle(req: Request, srv: Bun.Server<undefined>): Promise<Response> {
    const route = new URL(req.url).pathname
    const access = core.devices.check({ route, headers: { authorization: req.headers.get('authorization') ?? undefined } })
    if (!access.ok) return fail(access.error, access.status)
    try {
      if (route === '/neo.apk') return await apk()
      if (route === '/api/hello') return json({ app: 'neo', name: core.identity.wake().name, paired: !!access.device, face: core.identity.face() })
      if (route === '/api/pair' && req.method === 'POST') {
        const body = await readBody(req)
        const result = core.devices.pair(body.code, body.name)
        return 'token' in result ? json({ ...result, name: core.identity.wake().name }) : fail(result.error, 400)
      }
      if (route === '/api/events' && req.method === 'GET') {
        srv.timeout(req, 0) // the stream stays open for hours with only a 15 s ping
        return events()
      }
      if (route === '/api/audio' && req.method === 'POST') {
        srv.timeout(req, 0) // the mic stays on for hours: one POST that never ends
        return await audio(req)
      }
      if (route === '/api/pet' && req.method === 'POST') {
        const { hunger, affection } = await readBody(req)
        await core.pet.report(Number(hunger), Number(affection))
        return json({ ok: true })
      }
      if (route === '/api/wakeup' && req.method === 'POST') {
        core.pet.wake()
        return json({ ok: true })
      }
      if (route === '/api/dream/seen' && req.method === 'POST') {
        core.memory.dreams.seen()
        return json({ ok: true })
      }
      if (route === '/api/arm' && req.method === 'POST') {
        core.arm()
        return json({ ok: true })
      }
      if (route === '/api/alarm/stop' && req.method === 'POST') {
        const { snooze } = await readBody(req)
        const minutes = typeof snooze === 'number' && snooze > 0 ? snooze : 0
        return json({ stopped: await core.jobs.stopAlarm(minutes ? 'เลื่อน' : 'แตะปิด', minutes) })
      }
      return fail('not found', 404)
    } catch (e) {
      if (e instanceof BodyTooLarge) return fail('ข้อมูลใหญ่เกินไป', 413)
      if (e instanceof SyntaxError) return fail(e.message, 400)
      console.error('phone route failed:', route, e)
      return fail('Neo ขัดข้อง', 500)
    }
  }

  const serve = (hostname: string, port: number) =>
    Bun.serve({ hostname, port, idleTimeout: 0, fetch: handle })

  const main = serve(LOCALHOST, options.port)
  const port = main.port!
  const extras = new Map<string, { server: Bun.Server<undefined>; label: string }>()
  let tailscaleInfo: TailscaleInfo | null = null

  async function bindNetworks() {
    const { tailscale: wantTailscale, lan: wantLan } = core.settings.get()
    const wanted = new Map<string, string>()
    for (const network of networks()) {
      if (network.kind === 'tailscale' ? wantTailscale : wantLan) wanted.set(network.ip, network.kind === 'tailscale' ? 'tailscale/VPN' : 'Wi-Fi/LAN')
    }
    for (const [ip, { server }] of extras) {
      if (wanted.has(ip)) continue
      await server.stop(true)
      extras.delete(ip)
    }
    for (const [ip, label] of wanted) {
      if (extras.has(ip)) continue
      try {
        extras.set(ip, { server: serve(ip, port), label })
      } catch (e) {
        console.error(`ฟังที่ ${label} ${ip}:${port} ไม่ได้:`, (e as Error).message)
      }
    }
    tailscaleInfo = wantTailscale ? await tailscale().catch(() => null) : null
  }

  // binds run one at a time: a settings change and the minute timer may overlap
  let binding: Promise<void> = Promise.resolve()
  const rebind = () => (binding = binding.then(bindNetworks, bindNetworks))

  await rebind()
  core.devices.provideAddresses(() => addresses())
  const stopTimer = clock.every(REBIND_MS, () => void rebind())
  const stopWatching = core.events.watch(event => {
    if (event.type === 'settings') void rebind()
  })

  /** What `neo devices pair` shows next to the code. */
  function addresses(): PairAddress[] {
      const list: PairAddress[] = []
      if (tailscaleInfo?.host && extras.has(tailscaleInfo.ip)) {
        list.push({ method: 'Tailscale', url: `http://${tailscaleInfo.host}:${port}`, note: 'มือถือต้องเปิด Tailscale บัญชีเดียวกัน' })
      }
      for (const [ip, { label }] of extras) {
        list.push({
          method: label,
          url: `http://${hostPart(ip)}:${port}`,
          note: label === 'Wi-Fi/LAN' ? 'ต้องอยู่ Wi-Fi เดียวกัน (ไม่เข้ารหัส)' : 'ผ่าน VPN',
        })
      }
      list.push({ method: 'USB', url: `http://localhost:${port}`, note: `adb reverse tcp:${port} tcp:${port} แล้วกด "ใช้สาย USB" บนมือถือ (ยังต้องจับคู่)` })
      list.push({ method: 'URL ของคุณเอง', url: 'https://…', note: `tunnel/reverse proxy ที่ชี้มา http://127.0.0.1:${port} (ต้องใช้รหัส)` })
      return list
  }

  return {
    port,
    rebind,
    addresses,
    async stop() {
      stopTimer()
      stopWatching()
      await binding
      await Promise.all([main.stop(true), ...[...extras.values()].map(({ server }) => server.stop(true))])
      extras.clear()
    },
  }
}

export type PhoneServer = Awaited<ReturnType<typeof startPhoneServer>>
