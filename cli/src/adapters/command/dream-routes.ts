import type { Core } from '../../core/core'
import type { Routes } from '../../protocol'

/** The dream routes of the command socket. Returns undefined for any other route. */
export async function dreamRoute(core: Core, route: string, body: () => Promise<unknown>): Promise<unknown> {
  const { dreams } = core.memory
  switch (route) {
    case 'GET /dream': return dreams.status()
    case 'POST /dream/now': return core.memory.dream('สั่งให้ฝัน')
    case 'POST /dream/enable': {
      const { enabled } = (await body()) as Routes['POST /dream/enable']['body']
      await core.settings.set({ dream: enabled === true })
      return dreams.status()
    }
    case 'GET /dreams': return dreams.list()
    case 'POST /dreams/show': return dreams.show(String(((await body()) as Routes['POST /dreams/show']['body']).id ?? 'last'))
    case 'POST /dreams/rm': return { removed: dreams.remove(String(((await body()) as Routes['POST /dreams/rm']['body']).id ?? '')) }
    case 'POST /dreams/clear': return { removed: dreams.clear() }
    default: return undefined
  }
}
