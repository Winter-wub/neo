import type { Core } from '../../core/core'
import { FOODS, type Food, type PetInfo, type Routes, type WakeInfo } from '../../protocol'
import { SettingsError } from '../../core/settings/settings'

/** The pet, name and face routes of the command socket. Returns the body, or undefined when the route is not one of these. */
export async function petRoute(core: Core, route: string, readJson: () => Promise<unknown>): Promise<unknown | undefined> {
  const { pet, identity } = core
  switch (route) {
    case 'GET /pet':
      return { pet: pet.current(), sleeping: pet.sleeping() } satisfies PetInfo
    case 'POST /pet/feed': {
      const { food = 'fish' } = (await readJson()) as Routes['POST /pet/feed']['body']
      if (!(FOODS as readonly string[]).includes(food)) throw new SettingsError(`อาหารมี ${FOODS.join(' | ')}`)
      pet.feed(food as Food)
      return { food }
    }
    case 'POST /pet/sleep':
      pet.sleep()
      return { ok: true }
    case 'GET /name':
      return identity.wake() satisfies WakeInfo
    case 'POST /name/set': {
      const { name, variants } = (await readJson()) as Routes['POST /name/set']['body']
      await identity.setWake(String(name ?? ''), Array.isArray(variants) ? variants.map(String) : [])
      return identity.wake()
    }
    case 'POST /name/train': {
      const { name } = (await readJson()) as Routes['POST /name/train']['body']
      await identity.train(String(name ?? ''))
      return identity.wake()
    }
    case 'POST /name/train/cancel':
      identity.cancelTraining()
      return identity.wake()
    case 'GET /face':
      return identity.face()
    case 'POST /face':
      return identity.setFace((await readJson()) as Routes['POST /face']['body'])
    // `neo phone …`: the neo command acting as the phone
    case 'POST /phone/wake':
      pet.wake()
      return { ok: true }
    case 'POST /phone/pet': {
      const { hunger, affection } = (await readJson()) as Routes['POST /phone/pet']['body']
      await pet.report(hunger, affection)
      return { ok: true }
    }
  }
  return undefined
}
