// Jobs: alarms and tasks scheduled for a time. The file format is documented in ./markdown.ts.
//
// - jobs.md is the only store. It is re-read when it changes (file watch + the 15 s tick as a backstop). A file with a
//   bad line leaves the previous jobs in force and publishes `jobs_warning`; `problems()` is what `neo doctor` shows.
// - Every change re-reads the file first and goes through one queue, so an edit made by hand is never overwritten.
//   `saveFile(text, since)` refuses when the file changed after `since`.
// - The scheduler ticks every 15 s. One-offs ring then leave the file (late by more than 30 min: dropped silently);
//   cron jobs fire once per matching minute (`last`).
// - Jobs owns the ringing alarm: 2 min, then it stops itself. Voice (ringHeard), the phone tap and `neo alarm` stop or snooze it.
// - A task goes through Conversation; while Conversation is busy it retries every 60 s, up to 10 times, then is dropped.
import { watch, type FSWatcher } from 'node:fs'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Card, Job, JobDraft, JobInfo, JobKind, JobProblem } from '../../protocol'
import { confirmCard, humanize, textCard } from '../cards/cards'
import type { Clock } from '../clock'
import type { FastAnswer } from '../conversation/conversation'
import type { Events } from '../events/events'
import { cronMatch, nextCron, parseCron, CronError } from './cron'
import { clockText, describe } from './describe'
import { parseJobs, serializeJobs, type StoredJob } from './markdown'
import { digits, fromSpeech } from './speech'

export const TICK_MS = 15_000
export const RING_MS = 2 * 60_000
export const LATE_MS = 30 * 60_000
export const BUSY_RETRY_MS = 60_000
export const BUSY_RETRIES = 10
export const DEFAULT_SNOOZE_MIN = 5
export const SNOOZE_MAX_MIN = 60
const TITLE_MAX = 80
const PROMPT_MAX = 1000
const WATCH_DEBOUNCE_MS = 50
const CATCH_UP_MS = 150

/** A refused request. `status` is the HTTP status the command adapter answers with. */
export class JobsError extends Error {
  constructor(message: string, readonly status: 400 | 404 | 409 = 400) {
    super(message)
  }
}

export type { FastAnswer }

export interface JobsDeps {
  home: string
  clock: Clock
  events: Events
  /** Run a task's prompt through Conversation. */
  ask(prompt: string): Promise<unknown>
  /** Conversation is thinking: a task waits. */
  busy(): boolean
  /** Told whenever the alarm starts/stops ringing or a task starts/finishes. */
  onState?(state: { ringing: boolean; busy: boolean }): void
}

export type NewJob = { kind: JobKind; title?: string; prompt?: string; at?: number; cron?: string }

const version = (text: string) => Bun.hash(text).toString(36)
/** jobs.md keeps minutes, so a time with seconds ("in 5 minutes") is rounded up: never early. */
const wholeMinute = (ms: number) => Math.ceil(ms / 60_000) * 60_000
const clip = (text: string, max: number) => text.replace(/\s+/g, ' ').trim().slice(0, max)
const newId = () => Math.random().toString(36).slice(2, 10).padEnd(8, '0')

const card = (title: string, lines: string[], emotion = 'happy', items: Card['items'] = []) =>
  textCard({ layout: items.length ? 'list' : 'text', icon: 'clock', title, lines, items, emotion, sounds: [emotion === 'confused' ? 'confused' : 'happy'], seconds: 15 })

export async function createJobs({ home, clock, events, ask, busy, onState }: JobsDeps) {
  const file = join(home, 'jobs.md')
  let jobs: StoredJob[] = []
  let preamble: string | undefined
  let text = '' // the file as last read or written; '' when it does not exist
  let problems: JobProblem[] = []
  let ringing: { id: string; title: string } | null = null
  /** Tasks that are running or waiting to retry. */
  let active = 0
  const state = () => onState?.({ ringing: ringing !== null, busy: active > 0 })

  // ---- storage ----

  const read = () => readFile(file, 'utf8').catch(() => '')

  /** Take the file as it is on disk. A bad file keeps the previous jobs. */
  async function load() {
    const onDisk = await read()
    if (onDisk === text) return
    text = onDisk
    const parsed = parseJobs(onDisk)
    const hadProblems = problems.length > 0
    problems = parsed.problems
    if (parsed.problems.length) {
      events.publish({ type: 'jobs_warning', problems })
      return
    }
    const changed = JSON.stringify(jobs) !== JSON.stringify(parsed.jobs)
    jobs = parsed.jobs
    preamble = onDisk === '' ? undefined : parsed.preamble
    if (hadProblems) events.publish({ type: 'jobs_warning', problems: [] })
    if (changed) events.publish({ type: 'jobs' })
  }

  async function write(next: StoredJob[]) {
    const out = serializeJobs(next, preamble)
    await mkdir(home, { recursive: true, mode: 0o700 })
    const tmp = `${file}.tmp`
    await writeFile(tmp, out, { mode: 0o600 })
    await rename(tmp, file)
    // our own write: remember it so the watcher does not report it back as an outside edit
    text = out
    jobs = next
    preamble = parseJobs(out).preamble
    events.publish({ type: 'jobs' })
  }

  // one thing at a time: a tick, a command and a file event may overlap
  let queue: Promise<unknown> = Promise.resolve()
  const serial = <T>(work: () => Promise<T>): Promise<T> => {
    const run = queue.then(work, work)
    queue = run.catch(() => {})
    return run
  }

  /** Re-read, refuse if the file is unreadable, then change the jobs. */
  const change = <T>(work: (current: StoredJob[]) => { jobs: StoredJob[]; result: T }) =>
    serial(async () => {
      await load()
      if (problems.length) {
        const first = problems[0]!
        throw new JobsError(`jobs.md มีบรรทัดที่อ่านไม่ออก (บรรทัด ${first.line}: ${first.error}) แก้ไฟล์ก่อน`)
      }
      const { jobs: next, result } = work(jobs.map(j => ({ ...j })))
      await write(next)
      return result
    })

  // ---- reading ----

  function nextOf(job: Job, now: number) {
    if (!job.enabled) return null
    if (job.at !== undefined) return job.at > now ? job.at : null
    const recent = now - 60_000 < (job.last ?? 0)
    return nextCron(job.cron!, recent ? now : now - 1)
  }
  const info = (job: StoredJob, now = clock.now()): JobInfo => {
    const { notes: _notes, ...plain } = job
    return { ...plain, next: nextOf(job, now), when: describe(job, now) }
  }

  function find(ref: string, current: readonly StoredJob[] = jobs) {
    const needle = ref.trim()
    const byId = current.find(j => j.id === needle)
    if (byId) return byId
    const lower = needle.toLowerCase()
    const exact = current.filter(j => j.title.toLowerCase() === lower)
    const matches = exact.length ? exact : current.filter(j => j.title.toLowerCase().includes(lower))
    if (matches.length === 1) return matches[0]!
    if (!matches.length) throw new JobsError(`ไม่พบงาน "${ref}" (ดู neo jobs list)`, 404)
    throw new JobsError(`"${ref}" ตรงกับหลายงาน: ${matches.map(j => `${j.title} (${j.id})`).join(', ')} ใช้ id แทน`)
  }

  // ---- changes ----

  function validated(input: NewJob, now: number): StoredJob {
    const kind: JobKind = input.kind === 'task' ? 'task' : 'alarm'
    const job: StoredJob = { id: newId(), kind, title: clip(input.title || (kind === 'task' ? 'งาน' : 'ปลุก'), TITLE_MAX), enabled: true, notes: [] }
    if (kind === 'task') {
      job.prompt = (input.prompt || input.title || '').trim().slice(0, PROMPT_MAX)
      if (!job.prompt) throw new JobsError('งานตั้งเวลาต้องบอกว่าให้ทำอะไร')
    }
    if (input.cron) {
      job.cron = checkedCron(input.cron)
    } else if (Number.isFinite(input.at) && input.at! > now) {
      job.at = wholeMinute(input.at!)
    } else {
      throw new JobsError('ต้องระบุเวลาในอนาคต (at) หรือ cron')
    }
    return job
  }
  function checkedCron(expr: string) {
    try {
      parseCron(expr)
    } catch (e) {
      throw new JobsError(e instanceof CronError ? e.message : 'cron ไม่ถูกต้อง')
    }
    return expr.trim().split(/\s+/).join(' ')
  }

  async function add(input: NewJob) {
    const now = clock.now()
    const added = await change(current => {
      const job = validated(input, now)
      return { jobs: [...current, job], result: job }
    })
    events.publish({ type: 'schedule', action: 'add', title: added.title, when: describe(added, now) })
    return info(added)
  }

  const edit = (ref: string, patch: { title?: string; prompt?: string; at?: number; cron?: string }) =>
    change(current => {
      const target = find(ref, current)
      if (patch.title !== undefined) target.title = clip(patch.title, TITLE_MAX) || target.title
      if (patch.prompt !== undefined) {
        if (target.kind !== 'task') throw new JobsError('prompt ใช้กับงาน (task) เท่านั้น')
        if (!patch.prompt.trim()) throw new JobsError('งานตั้งเวลาต้องบอกว่าให้ทำอะไร')
        target.prompt = patch.prompt.trim().slice(0, PROMPT_MAX)
      }
      if (patch.at !== undefined && patch.cron !== undefined) throw new JobsError('ใส่ได้อย่างเดียว: at หรือ cron')
      if (patch.cron !== undefined) {
        target.cron = checkedCron(patch.cron)
        delete target.at
        delete target.last
      } else if (patch.at !== undefined) {
        if (!(patch.at > clock.now())) throw new JobsError('เวลาต้องอยู่ในอนาคต')
        target.at = wholeMinute(patch.at)
        delete target.cron
        delete target.last
      }
      return { jobs: current, result: info(target) }
    })

  const enable = (ref: string, enabled: boolean) =>
    change(current => {
      const target = find(ref, current)
      target.enabled = enabled
      return { jobs: current, result: info(target) }
    })

  const remove = (ref: string) =>
    change(current => {
      const target = find(ref, current)
      return { jobs: current.filter(j => j !== target), result: info(target) }
    })

  const clear = (kind?: JobKind) =>
    change(current => {
      const keep = current.filter(j => kind !== undefined && j.kind !== kind)
      return { jobs: keep, result: current.length - keep.length }
    })

  // ---- the file as text (neo jobs edit) ----

  const readFileText = () => serial(async () => ({ text: await read(), version: version(await read()) }))

  function saveFile(next: string, since: string) {
    return serial(async () => {
      const onDisk = await read()
      if (version(onDisk) !== since) throw new JobsError('jobs.md ถูกแก้ไขระหว่างที่คุณแก้อยู่ จึงไม่บันทึกทับ (เปิดใหม่แล้วแก้อีกครั้ง)', 409)
      const parsed = parseJobs(next)
      if (parsed.problems.length) {
        const first = parsed.problems[0]!
        throw new JobsError(`บรรทัด ${first.line} อ่านไม่ออก: ${first.error}`)
      }
      await mkdir(home, { recursive: true, mode: 0o700 })
      const tmp = `${file}.tmp`
      await writeFile(tmp, next, { mode: 0o600 })
      await rename(tmp, file)
      await load()
      return { version: version(next) }
    })
  }

  // ---- timers that need second precision (ring, retry) ----

  const deadlines: Array<{ at: number; run(): void }> = []
  let stopPump: (() => void) | null = null
  function after(ms: number, run: () => void) {
    deadlines.push({ at: clock.now() + ms, run })
    stopPump ??= clock.every(1000, () => {
      const now = clock.now()
      for (const due of deadlines.filter(d => d.at <= now)) {
        deadlines.splice(deadlines.indexOf(due), 1)
        due.run()
      }
      if (!deadlines.length) {
        stopPump?.()
        stopPump = null
      }
    })
  }

  // ---- firing ----

  function fire(job: Job) {
    console.error(new Date(clock.now()).toISOString(), 'schedule fire', job.kind, job.title)
    if (job.kind === 'alarm') return ring(job)
    runTask(job, 0)
  }

  function ring(job: Job) {
    const mine = { id: job.id, title: job.title }
    ringing = mine
    state()
    const now = clock.now()
    events.publish({
      type: 'alarm', id: job.id, title: job.title,
      card: humanize({
        kind: 'text', layout: 'big', icon: 'clock', big: clockText(new Date(now)), title: job.title,
        lines: ['แตะหน้าจอ หรือพูด "หยุด" เพื่อปิด', 'พูด "ขออีก 5 นาที" เพื่อเลื่อน'],
        emotion: 'excited', sounds: ['excited'], seconds: 90, items: [],
      }),
    })
    after(RING_MS, () => {
      if (ringing === mine) void stopAlarm('หมดเวลา')
    })
  }

  function runTask(job: Job, attempt: number) {
    if (attempt === 0) {
      active++
      state()
    }
    const finish = () => {
      active--
      state()
    }
    if (busy()) {
      if (attempt < BUSY_RETRIES) after(BUSY_RETRY_MS, () => runTask(job, attempt + 1))
      else finish()
      return
    }
    events.publish({ type: 'job', id: job.id, title: job.title })
    ask(`[งานตั้งเวลา ${describe(job, clock.now())}] ${job.prompt}`).catch(e => console.error('task job failed:', e)).finally(finish)
  }

  /** Stop the ringing alarm. `snooze` minutes > 0 also sets a new one-off alarm. False when nothing was ringing. */
  async function stopAlarm(why: string, snooze = 0) {
    const stopping = ringing
    if (!stopping) return false
    ringing = null
    state()
    const minutes = Math.min(Math.max(Math.round(snooze), 0), SNOOZE_MAX_MIN)
    events.publish({ type: 'alarm_off', id: stopping.id, why, ...(minutes > 0 ? { snooze: minutes } : {}) })
    if (minutes > 0) {
      await add({ kind: 'alarm', title: stopping.title, at: clock.now() + minutes * 60_000 }).catch(e => console.error('snooze failed:', e))
    }
    return true
  }

  // ---- the tick ----

  // While jobs.md is unreadable the previous jobs keep firing from memory (the broken file is never overwritten).
  // This remembers what already fired so it does not fire again when the file is fixed.
  const firedWhileBroken = new Map<string, number>()

  function tick(now: number) {
    return serial(async () => {
      await load()
      for (const [key, at] of firedWhileBroken) if (now - at > LATE_MS * 2) firedWhileBroken.delete(key)
      const d = new Date(now)
      const minute = Math.floor(now / 60_000)
      const fired: Job[] = []
      let changed = false
      const next: StoredJob[] = []
      for (const job of jobs) {
        if (!job.enabled) {
          next.push(job)
          continue
        }
        if (job.at !== undefined) {
          if (job.at > now) {
            next.push(job)
            continue
          }
          changed = true // due: leaves the file whether it rings or is too late
          const key = `${job.id}@${job.at}`
          if (now - job.at < LATE_MS && !firedWhileBroken.has(key)) {
            fired.push(job)
            if (problems.length) firedWhileBroken.set(key, now)
          }
          if (problems.length) next.push(job) // not removed from memory either: it must not look new when fixed
          continue
        }
        const key = `${job.id}@${minute}`
        if (Math.floor((job.last ?? 0) / 60_000) !== minute && !firedWhileBroken.has(key) && cronMatch(parseCron(job.cron!), d)) {
          if (problems.length) {
            firedWhileBroken.set(key, now)
            next.push(job)
          } else {
            next.push({ ...job, last: now })
            changed = true
          }
          fired.push(job)
        } else {
          next.push(job)
        }
      }
      if (changed && !problems.length) await write(next)
      for (const job of fired) fire(job)
    })
  }

  let stopTick: (() => void) | null = null
  let watcher: FSWatcher | null = null
  let debounce: ReturnType<typeof setTimeout> | null = null

  function start({ watch: watchFile = false } = {}) {
    stopTick?.()
    stopTick = clock.every(TICK_MS, () => void tick(clock.now()).catch(e => console.error('jobs tick failed:', e)))
    void tick(clock.now()).catch(e => console.error('jobs tick failed:', e))
    if (watchFile) {
      // watch the directory: editors replace the file (rename), which a watch on the file itself would lose
      mkdir(home, { recursive: true, mode: 0o700 }).then(() => {
        watcher = watch(home, (_kind, name) => {
          if (name !== 'jobs.md') return
          if (debounce) clearTimeout(debounce)
          debounce = setTimeout(() => void serial(load).catch(e => console.error('jobs reload failed:', e)), WATCH_DEBOUNCE_MS)
        })
        // fs.watch arms asynchronously: an edit made in the first moments is never reported. Look once after it has armed.
        debounce = setTimeout(() => void serial(load).catch(e => console.error('jobs reload failed:', e)), CATCH_UP_MS)
      }, () => {})
    }
  }

  function stop() {
    stopTick?.()
    stopTick = null
    stopPump?.()
    stopPump = null
    deadlines.length = 0
    active = 0
    watcher?.close()
    watcher = null
    if (debounce) clearTimeout(debounce)
  }

  // ---- fast phrases and intents ----

  const confirmAdd = (draft: NewJob): FastAnswer => {
    const now = clock.now()
    const task = draft.kind === 'task'
    const title = clip(draft.title || '', 60)
    const when = describe(draft, now)
    return {
      card: confirmCard({
        icon: 'clock', verb: 'ตั้ง', plan: (task ? 'ตั้งงาน ' : 'ตั้งปลุก ') + title,
        title: task ? 'ตั้งงานนี้ไหม?' : title === 'ปลุก' ? 'ตั้งปลุกไหม?' : 'ตั้งเตือนไหม?',
        lines: [when, ...(task ? [clip(draft.prompt || '', 90)] : title === 'ปลุก' ? [] : [title])],
      }),
      confirm: async () => {
        const added = await add(draft)
        return card(task ? 'ตั้งงานแล้ว' : 'ตั้งแล้ว', [added.when, added.title, task ? 'ถึงเวลาจะทำให้ แล้วร้องเรียก' : 'ถึงเวลาจะร้องเรียกนะ'], 'proud')
      },
    }
  }

  /** Time phrases (after the wake word). null = not about time. */
  function understand(said: string): FastAnswer | null {
    const result = fromSpeech(said, clock.now())
    if (!result) return null
    if ('error' in result) return { card: card('ตั้งเวลาไม่ได้', [result.error], 'confused') }
    if (result.action === 'list') {
      const now = clock.now()
      const listed = jobs.filter(j => j.enabled)
      return {
        card: listed.length
          ? card('ตั้งเวลาไว้', [], 'happy', listed.slice(0, 14).map(j => ({ t: j.title, v: describe(j, now) })))
          : card('ยังไม่มีอะไร', ['ยังไม่ได้ตั้งปลุก/เตือนไว้', 'ลองพูด "ปลุก 7 โมงครึ่ง"'], 'curious'),
      }
    }
    if (result.action === 'clear') {
      const kind = result.kind ?? undefined
      return {
        card: card('ลบไหม?', [kind === 'task' ? 'ลบงานตั้งเวลาทั้งหมด' : kind ? 'ลบการปลุก/เตือนทั้งหมด' : 'ลบทั้งหมด', 'พูด "ตกลง" หรือ "ยกเลิก"'], 'curious'),
        confirm: async () => {
          const n = await clear(kind)
          return card(n ? 'ลบแล้ว' : 'ไม่มีให้ลบ', [n ? `ลบแล้ว ${n} รายการ` : 'ไม่มีรายการที่ตั้งไว้'], n ? 'happy' : 'curious')
        },
      }
    }
    return confirmAdd(result.job)
  }

  /** The Brain's schedule intent: `at` is "YYYY-MM-DDTHH:mm" in local time, or a cron. */
  async function intent(answer: { kind: string; title: string; prompt: string; at?: string; cron?: string }): Promise<FastAnswer> {
    const unsure = { card: card('ไม่แน่ใจเรื่องเวลา', ['บอกเวลาอีกทีได้ไหม', 'เช่น "พรุ่งนี้ 7 โมงเช้า"'], 'confused') }
    const kind: JobKind = answer.kind === 'task' ? 'task' : 'alarm'
    const draft: NewJob = { kind, title: clip(answer.title || answer.prompt || 'เตือน', 60) }
    if (kind === 'task') draft.prompt = (answer.prompt || answer.title || '').trim().slice(0, PROMPT_MAX)
    if (answer.cron) {
      try {
        draft.cron = checkedCron(answer.cron)
      } catch {
        return unsure
      }
    } else {
      const at = new Date(String(answer.at ?? '')).getTime()
      if (!(at > clock.now())) return unsure
      draft.at = wholeMinute(at)
    }
    return confirmAdd(draft)
  }

  /** The words heard while an alarm rings. A card when it was a stop/snooze, null otherwise. */
  async function ringHeard(said: string): Promise<Card | null> {
    if (!ringing) return null
    const snooze = digits(said).match(/(?:ขอ)?(?:อีก|เลื่อน(?:ไป)?(?:อีก)?)\s*(\d{1,2})?\s*นาที|เลื่อน|ขออีก|ขอนอนต่อ/)
    if (snooze) {
      const minutes = Number(snooze[1] || DEFAULT_SNOOZE_MIN)
      events.publish({ type: 'heard', text: said })
      await stopAlarm('เลื่อน', minutes)
      return card(`เลื่อนไป ${Math.min(minutes, SNOOZE_MAX_MIN)} นาที`, ['จะปลุกอีกที'], 'sleepy')
    }
    if (/หยุด|ปิด|พอ(?:แล้ว)?|ตื่นแล้ว|โอเค|ok|รับทราบ|ยกเลิก|เงียบ/i.test(said)) {
      events.publish({ type: 'heard', text: said })
      await stopAlarm('ปิด')
      return card('ปิดปลุกแล้ว', [], 'happy')
    }
    return null
  }

  /** `neo jobs test`: fire it now (it stays in the file). */
  const test = (ref: string) =>
    serial(async () => {
      await load()
      fire(find(ref))
      return { ok: true as const }
    })

  return {
    start,
    stop,
    /** Resolves when everything queued so far (ticks, saves, reloads) is done. For tests and shutdown. */
    idle: () => serial(async () => {}),
    list: () => jobs.map(j => info(j)),
    ringing: () => ringing,
    problems: () => problems,
    parse(speech: string): JobDraft {
      const now = clock.now()
      const result = fromSpeech(speech, now)
      if (!result || 'error' in result || result.action !== 'add') {
        throw new JobsError(result && 'error' in result ? result.error : 'ไม่เข้าใจเวลา ลองเช่น "ปลุก 7 โมงครึ่ง" หรือ "ทุกวัน 8 โมง สรุปข่าว"')
      }
      const { kind, title, prompt, cron } = result.job
      const at = result.job.at === undefined ? undefined : wholeMinute(result.job.at)
      return { kind, title, ...(prompt !== undefined ? { prompt } : {}), ...(at !== undefined ? { at } : {}), ...(cron !== undefined ? { cron } : {}), when: describe({ at, cron }, now) }
    },
    add,
    edit,
    enable,
    remove,
    clear,
    test,
    readFile: readFileText,
    saveFile,
    stopAlarm,
    understand,
    intent,
    ringHeard,
    /** Reload now (used after outside writes in tests). */
    reload: () => serial(load),
  }
}

export type Jobs = Awaited<ReturnType<typeof createJobs>>
