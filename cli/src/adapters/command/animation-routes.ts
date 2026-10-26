import type { Core } from '../../core/core'
import type { Routes } from '../../protocol'

/** The tool-animation routes of the command socket (and of the phone's settings routes). Returns undefined for any other route. */
export async function animationRoute(core: Core, route: string, body: () => Promise<unknown>): Promise<unknown> {
  const { animations } = core
  const tool = async () => String(((await body()) as Routes['POST /animations/show']['body']).tool ?? '')
  switch (route) {
    case 'GET /animations': return animations.list()
    case 'POST /animations/show': return animations.show(await tool())
    case 'POST /animations/redo': return { tool: await animations.redo(await tool()), queued: true }
    case 'POST /animations/rm': return { removed: await animations.rm(await tool()) }
    default: return undefined
  }
}
