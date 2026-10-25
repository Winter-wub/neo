import type { Core } from '../../core/core'
import type { Routes } from '../../protocol'

/** The brain routes of the command socket: `neo provider …` and `neo model …`. Returns the body, or undefined when the route is not one of these. */
export async function brainRoute(core: Core, route: string, readJson: () => Promise<unknown>): Promise<unknown | undefined> {
  const { providers } = core
  switch (route) {
    case 'GET /providers':
      return providers.list()
    case 'POST /providers/use': {
      const { name } = (await readJson()) as Routes['POST /providers/use']['body']
      return providers.use(String(name))
    }
    case 'POST /providers/discover':
      return providers.discover()
    case 'GET /providers/config':
      return providers.config()
    case 'POST /providers/config': {
      const body = (await readJson()) as Routes['POST /providers/config']['body']
      await providers.saveConfig({ name: String(body.name), cfg: body.cfg, apiKey: typeof body.apiKey === 'string' ? body.apiKey : undefined, remove: body.remove === true })
      return { ok: true }
    }
    case 'POST /models/list': {
      const { name } = (await readJson()) as Routes['POST /models/list']['body']
      return providers.listModels(name === undefined ? undefined : String(name))
    }
    case 'POST /models/use': {
      const { name, model } = (await readJson()) as Routes['POST /models/use']['body']
      return providers.useModel(model === null || model === undefined ? null : String(model), name === undefined ? undefined : String(name))
    }
  }
  return undefined
}
