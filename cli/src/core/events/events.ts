import { HISTORY_LIMIT, UNSTORED_EVENT_TYPES, type NeoEvent } from '../../protocol'
import type { Clock } from '../clock'

type Listener = (event: NeoEvent) => void
/** What callers publish: the module stamps `at`. */
export type Publishable = NeoEvent extends infer E ? (E extends NeoEvent ? Omit<E, 'at'> : never) : never

export function createEvents({ clock }: { clock: Clock }) {
  const history: NeoEvent[] = []
  const listeners = new Set<Listener>()
  /** Daemon-internal watchers: they get every event but are not a console. */
  const watchers = new Set<Listener>()

  return {
    publish(event: Publishable) {
      const stamped = { ...event, at: clock.now() } as NeoEvent
      if (!(UNSTORED_EVENT_TYPES as readonly string[]).includes(stamped.type)) {
        history.push(stamped)
        if (history.length > HISTORY_LIMIT) history.shift()
      }
      for (const listener of [...listeners, ...watchers]) listener(stamped)
    },
    watch(listener: Listener) {
      watchers.add(listener)
      return () => void watchers.delete(listener)
    },
    subscribe(listener: Listener, { history: replay = false } = {}) {
      if (replay) for (const event of history) listener(event)
      listeners.add(listener)
      return () => void listeners.delete(listener)
    },
    listeners: () => listeners.size,
  }
}

export type Events = ReturnType<typeof createEvents>
