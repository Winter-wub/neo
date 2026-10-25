import { MemoryConflict, MemoryError, MemoryNotFound, type Memory } from '../../core/memory/memory'
import type { Routes } from '../../protocol'

const text = (value: unknown, what: string) => {
  if (typeof value !== 'string') throw new MemoryError(`${what} ต้องเป็นข้อความ`)
  return value
}

/** The memory and journal routes. Returns undefined for any other route. */
export async function memoryRoute(memory: Memory, route: string, body: () => Promise<unknown>): Promise<unknown> {
  switch (route) {
    case 'GET /memory': return memory.doc()
    case 'POST /memory': {
      const b = (await body()) as Routes['POST /memory']['body']
      return memory.save(text(b.text, 'text'), text(b.since, 'since'))
    }
    case 'POST /memory/add': {
      const b = (await body()) as Routes['POST /memory/add']['body']
      return memory.add(text(b.text, 'text'), b.section === undefined ? undefined : text(b.section, 'section'))
    }
    case 'POST /memory/forget': {
      const b = (await body()) as Routes['POST /memory/forget']['body']
      return { removed: memory.forget(text(b.text, 'text'), { all: b.all === true }) }
    }
    case 'POST /memory/clear': return { removed: memory.clear() }
    case 'GET /journal': return memory.days()
    case 'POST /journal/show': {
      const b = (await body()) as Routes['POST /journal/show']['body']
      return memory.show(b.day === undefined ? undefined : text(b.day, 'day'))
    }
    case 'POST /journal/save': {
      const b = (await body()) as Routes['POST /journal/save']['body']
      return memory.saveDay(text(b.day, 'day'), text(b.text, 'text'), text(b.since, 'since'))
    }
    case 'POST /journal/forget': {
      const b = (await body()) as Routes['POST /journal/forget']['body']
      return { removed: memory.forgetEntries(text(b.text, 'text'), { all: b.all === true }) }
    }
    case 'POST /journal/clear': return { removed: memory.clearJournal() }
    default: return undefined
  }
}

export const memoryStatus = (e: MemoryError) => (e instanceof MemoryConflict ? 409 : e instanceof MemoryNotFound ? 404 : 400)
