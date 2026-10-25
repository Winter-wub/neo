import { JobsError, type Jobs } from '../../core/jobs/jobs'
import type { JobKind, Routes } from '../../protocol'

const text = (value: unknown, what: string) => {
  if (typeof value !== 'string' || !value.trim()) throw new JobsError(`${what} ต้องเป็นข้อความ`)
  return value
}
const optionalText = (value: unknown, what: string) => (value === undefined ? undefined : text(value, what))
const optionalMs = (value: unknown, what: string) => {
  if (value === undefined) return undefined
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new JobsError(`${what} ต้องเป็นเวลา (ms)`)
  return value
}
const kindOf = (value: unknown): JobKind => {
  if (value !== 'alarm' && value !== 'task') throw new JobsError('kind ต้องเป็น alarm หรือ task')
  return value
}

/** The jobs and alarm routes. Returns undefined for any other route. */
export async function jobsRoute(jobs: Jobs, route: string, body: () => Promise<unknown>): Promise<unknown> {
  switch (route) {
    case 'GET /jobs': return { jobs: jobs.list(), ringing: jobs.ringing(), problems: jobs.problems() }
    case 'POST /jobs/parse': {
      const b = (await body()) as Routes['POST /jobs/parse']['body']
      return { draft: jobs.parse(text(b.speech, 'speech')) }
    }
    case 'POST /jobs/add': {
      const b = (await body()) as Routes['POST /jobs/add']['body']
      return jobs.add({ kind: kindOf(b.kind), title: optionalText(b.title, 'title'), prompt: optionalText(b.prompt, 'prompt'), at: optionalMs(b.at, 'at'), cron: optionalText(b.cron, 'cron') })
    }
    case 'POST /jobs/edit': {
      const b = (await body()) as Routes['POST /jobs/edit']['body']
      return jobs.edit(text(b.ref, 'ref'), { title: optionalText(b.title, 'title'), prompt: optionalText(b.prompt, 'prompt'), at: optionalMs(b.at, 'at'), cron: optionalText(b.cron, 'cron') })
    }
    case 'POST /jobs/enable': {
      const b = (await body()) as Routes['POST /jobs/enable']['body']
      if (typeof b.enabled !== 'boolean') throw new JobsError('enabled ต้องเป็น true หรือ false')
      return jobs.enable(text(b.ref, 'ref'), b.enabled)
    }
    case 'POST /jobs/remove': {
      const b = (await body()) as Routes['POST /jobs/remove']['body']
      return { removed: await jobs.remove(text(b.ref, 'ref')) }
    }
    case 'POST /jobs/clear': {
      const b = (await body()) as Routes['POST /jobs/clear']['body']
      return { removed: await jobs.clear(b.kind === undefined ? undefined : kindOf(b.kind)) }
    }
    case 'POST /jobs/test': {
      const b = (await body()) as Routes['POST /jobs/test']['body']
      return jobs.test(text(b.ref, 'ref'))
    }
    case 'GET /jobs/file': return jobs.readFile()
    case 'POST /jobs/file': {
      const b = (await body()) as Routes['POST /jobs/file']['body']
      if (typeof b.text !== 'string') throw new JobsError('text ต้องเป็นข้อความ')
      return jobs.saveFile(b.text, text(b.since, 'since'))
    }
    case 'POST /alarm/stop': {
      const b = (await body()) as Routes['POST /alarm/stop']['body']
      const snooze = optionalMs(b.snooze, 'snooze') ?? 0
      return { stopped: await jobs.stopAlarm(snooze > 0 ? 'เลื่อน' : 'ปิด', snooze) }
    }
    default: return undefined
  }
}
