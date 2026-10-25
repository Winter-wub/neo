import { randomBytes, randomInt, createHash } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { DeviceInfo, PairAddress } from '../../protocol'
import type { Clock } from '../clock'
import type { Events } from '../events/events'

const CODE_MS = 5 * 60_000
const MAX_TRIES = 5
/** `lastSeen` is kept in memory on every request but written to disk at most this often per device. */
const LAST_SEEN_SAVE_MS = 60_000
/** Routes that need no device token, from anywhere. Everything else on the phone port needs one. */
const OPEN_ROUTES = new Set(['/api/hello', '/api/pair', '/neo.apk'])

interface StoredDevice extends DeviceInfo {}

export type Access =
  | { ok: true; device?: DeviceInfo }
  | { ok: false; status: 401; error: string }

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex')

/** Pairing codes, device tokens and the single home of the phone port's access rules. */
export async function createDevices({ home, clock, events }: { home: string; clock: Clock; events: Events }) {
  const file = join(home, 'devices.json')
  let stored: Record<string, StoredDevice> = {}
  try {
    stored = JSON.parse(await readFile(file, 'utf8'))
  } catch {
    // no devices yet
  }
  let pending: { value: string; until: number; tries: number } | null = null
  const lastSaved = new Map<string, number>()
  let writing: Promise<void> = Promise.resolve()
  let addressSource = (): PairAddress[] => []

  /** Saves are queued so two quick ones never interleave. */
  function save() {
    const snapshot = JSON.stringify(stored, null, 1)
    writing = writing.then(async () => {
      await mkdir(home, { recursive: true, mode: 0o700 })
      const tmp = `${file}.tmp`
      await writeFile(tmp, snapshot, { mode: 0o600 })
      await rename(tmp, file)
    }).catch(e => console.error('devices.json save failed:', e))
    return writing
  }

  return {
    startPairing() {
      pending = { value: String(randomInt(0, 1_000_000)).padStart(6, '0'), until: clock.now() + CODE_MS, tries: 0 }
      return { code: pending.value, expiresAt: pending.until }
    },
    pair(code: unknown, name: unknown): { token: string; id: string } | { error: string } {
      const current = pending
      if (!current || clock.now() > current.until) return { error: 'ไม่มีรหัสที่ใช้ได้ — สั่ง neo devices pair ใหม่' }
      if (++current.tries > MAX_TRIES) {
        pending = null
        return { error: 'ใส่รหัสผิดหลายครั้ง — ขอรหัสใหม่' }
      }
      if (String(code).trim() !== current.value) return { error: 'รหัสไม่ถูกต้อง' }
      pending = null
      const token = randomBytes(24).toString('hex')
      const hash = sha256(token)
      const device: StoredDevice = {
        id: hash.slice(0, 12),
        name: String(name || 'Android').slice(0, 40),
        paired: new Date(clock.now()).toISOString(),
        lastSeen: null,
      }
      stored[hash] = device
      void save()
      events.publish({ type: 'paired', name: device.name })
      return { token, id: device.id }
    },
    /** Decides whether a phone-port request may proceed. Localhost gets no special rights. */
    check({ route, headers }: { route: string; headers: Record<string, string | undefined> }): Access {
      if (OPEN_ROUTES.has(route)) return { ok: true }
      const token = /^Bearer\s+([a-f0-9]{48})$/i.exec(headers.authorization ?? '')?.[1]
      const hash = token && sha256(token)
      const device = hash ? stored[hash] : undefined
      if (!hash || !device) return { ok: false, status: 401, error: 'ยังไม่ได้จับคู่ — ใส่รหัสจาก neo devices pair' }
      const now = clock.now()
      device.lastSeen = new Date(now).toISOString()
      if (now - (lastSaved.get(device.id) ?? -Infinity) >= LAST_SEEN_SAVE_MS) {
        lastSaved.set(device.id, now)
        void save()
      }
      return { ok: true, device: { ...device } }
    },
    list: (): DeviceInfo[] => Object.values(stored).map(device => ({ ...device })),
    revoke(id: string) {
      const hash = Object.keys(stored).find(key => stored[key]!.id === id)
      if (!hash) return false
      delete stored[hash]
      lastSaved.delete(id)
      void save()
      events.publish({ type: 'devices' })
      return true
    },
    /** The phone adapter says where the phone can reach this Mac; `neo devices pair` prints it. */
    provideAddresses(source: () => PairAddress[]) {
      addressSource = source
    },
    addresses: () => addressSource(),
    /** Waits for queued writes to reach disk. */
    flush: () => writing,
  }
}

export type Devices = Awaited<ReturnType<typeof createDevices>>
