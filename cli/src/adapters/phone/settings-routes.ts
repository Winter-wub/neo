import type { Core } from '../../core/core'
import { BrainError } from '../../core/brain/hub'
import { JobsError } from '../../core/jobs/jobs'
import { MemoryError } from '../../core/memory/memory'
import { SettingsError } from '../../core/settings/settings'
import { PHONE_SETTINGS_ROUTES, type PhoneDeviceInfo, type PhoneSettingsRoute, type Routes } from '../../protocol'
import { animationRoute } from '../command/animation-routes'
import { brainRoute } from '../command/brain-routes'
import { dreamRoute } from '../command/dream-routes'
import { jobsRoute } from '../command/jobs-routes'
import { memoryRoute, memoryStatus } from '../command/memory-routes'
import { petRoute } from '../command/pet-routes'

const ALLOWED: ReadonlySet<string> = new Set(PHONE_SETTINGS_ROUTES)
const API_PREFIX = '/api'

export interface Handled {
  status: number
  body: unknown
}

/** `GET /api/settings` → `GET /settings` when that is one of the routes a paired phone may use, else undefined. */
export function settingsRouteOf(method: string, path: string): PhoneSettingsRoute | undefined {
  if (!path.startsWith(`${API_PREFIX}/`)) return undefined
  const key = `${method} ${path.slice(API_PREFIX.length)}`
  return ALLOWED.has(key) ? (key as PhoneSettingsRoute) : undefined
}

/**
 * The command socket's settings, brain, jobs, memory, dream, name and face routes for a paired phone: the same core calls,
 * the same request and reply shapes. `deviceId` is the caller, so its own row can be marked in the device list.
 */
export async function phoneSettingsRoute(core: Core, route: PhoneSettingsRoute, deviceId: string | undefined, readJson: () => Promise<unknown>): Promise<Handled> {
  switch (route) {
    case 'GET /status': return { status: 200, body: core.status() }
    case 'GET /settings': return { status: 200, body: core.settings.get() }
    case 'POST /settings': return { status: 200, body: await core.settings.set((await readJson()) as Routes['POST /settings']['body']) }
    case 'POST /settings/set': {
      const { name, args } = (await readJson()) as Routes['POST /settings/set']['body']
      return { status: 200, body: await core.settings.setByKey(String(name), Array.isArray(args) ? args.map(String) : []) }
    }
    case 'GET /devices':
      return { status: 200, body: core.devices.list().map((device): PhoneDeviceInfo => ({ ...device, self: device.id === deviceId })) }
    case 'POST /devices/revoke': {
      const { id } = (await readJson()) as Routes['POST /devices/revoke']['body']
      return core.devices.revoke(String(id)) ? { status: 200, body: { ok: true } } : { status: 404, body: { error: `ไม่พบอุปกรณ์ id ${id}` } }
    }
  }
  const body =
    (await jobsRoute(core.jobs, route, readJson)) ??
    (await brainRoute(core, route, readJson)) ??
    (await petRoute(core, route, readJson)) ??
    (await animationRoute(core, route, readJson)) ??
    (await dreamRoute(core, route, readJson)) ??
    (await memoryRoute(core.memory, route, readJson))
  return body === undefined ? { status: 404, body: { error: 'not found' } } : { status: 200, body }
}

/** A refused settings request as the status and `{error}` the phone gets; undefined for anything unexpected. */
export function settingsFailure(e: unknown): Handled | undefined {
  if (e instanceof SettingsError || e instanceof BrainError) return { status: 400, body: { error: e.message } }
  if (e instanceof MemoryError) return { status: memoryStatus(e), body: { error: e.message } }
  if (e instanceof JobsError) return { status: e.status, body: { error: e.message } }
  return undefined
}
