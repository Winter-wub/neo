import { afterEach, expect, test } from 'bun:test'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { FakeClock, tempHome } from '../../../test/helpers'
import type { NeoEvent } from '../../protocol'
import { createEvents } from '../events/events'
import { createJobs, JobsError, type Jobs } from './jobs'

const MIN = 60_000
const cleanups: Array<() => unknown> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

async function setup({ busy = () => false }: { busy?: () => boolean } = {}) {
  const { dir, cleanup } = await tempHome()
  const clock = new FakeClock(Math.ceil(1_700_000_000_000 / MIN) * MIN) // on a minute: jobs.md keeps minutes
  const events = createEvents({ clock })
  const seen: NeoEvent[] = []
  events.subscribe(e => seen.push(e))
  const asked: string[] = []
  const jobs = await createJobs({ home: dir, clock, events, busy: () => busy(), ask: async prompt => void asked.push(prompt) })
  cleanups.push(() => jobs.stop(), cleanup)
  const file = join(dir, 'jobs.md')
  /** Move the clock, then wait for the ticks it triggered to finish. */
  const advance = async (ms: number) => {
    clock.advance(ms)
    await jobs.idle()
  }
  const types = () => seen.map(e => e.type)
  const of = <T extends NeoEvent['type']>(type: T) => seen.filter((e): e is Extract<NeoEvent, { type: T }> => e.type === type)
  return { dir, file, clock, jobs, seen, asked, advance, types, of }
}

const at = (clock: FakeClock, ms: number) => clock.now() + ms

test('add puts the job in jobs.md and list shows when it runs next', async () => {
  const { jobs, clock, file, of } = await setup()
  const added = await jobs.add({ kind: 'alarm', title: 'ไปทำงาน', at: at(clock, 10 * MIN) })
  expect(added).toMatchObject({ kind: 'alarm', title: 'ไปทำงาน', enabled: true, next: at(clock, 10 * MIN) })
  expect(jobs.list().map(j => j.title)).toEqual(['ไปทำงาน'])
  const text = await readFile(file, 'utf8')
  expect(text).toContain(`## ไปทำงาน {#${added.id}}`)
  expect(text).toContain('- kind: alarm')
  expect(of('schedule')[0]).toMatchObject({ action: 'add', title: 'ไปทำงาน' })
})

test('parse understands a Thai sentence without saving anything', async () => {
  const { jobs, file } = await setup()
  const draft = jobs.parse('ปลุกพรุ่งนี้ตีห้าครึ่ง')
  const when = new Date(draft.at!)
  expect([when.getHours(), when.getMinutes()]).toEqual([5, 30])
  expect(draft).toMatchObject({ kind: 'alarm', title: 'ปลุก' })
  expect(draft.when).toContain('05:30')
  expect(await Bun.file(file).exists()).toBe(false)
  expect(() => jobs.parse('วันนี้อากาศดี')).toThrow(JobsError)
})

test('editing jobs.md by hand reloads it on the next tick', async () => {
  const { jobs, file, advance, types, clock } = await setup()
  jobs.start()
  await advance(0)
  await writeFile(file, `## ดูหนัง {#m1}\n\n- kind: alarm\n- at: 2031-01-01 20:00\n`)
  await advance(15_000)
  expect(jobs.list().map(j => [j.id, j.title])).toEqual([['m1', 'ดูหนัง']])
  expect(types()).toContain('jobs')
  expect(clock.now()).toBeGreaterThan(0)
})

test('a bad line keeps the previous jobs, publishes a warning, and is listed for doctor; fixing it clears the warning', async () => {
  const { jobs, file, advance, of, clock } = await setup()
  jobs.start()
  await jobs.add({ kind: 'alarm', title: 'เก่า', at: at(clock, 3_600_000) })
  const good = await readFile(file, 'utf8')

  await writeFile(file, good + '\n- oops\n')
  await advance(15_000)
  expect(jobs.list().map(j => j.title)).toEqual(['เก่า'])
  expect(jobs.problems()).toHaveLength(1)
  expect(jobs.problems()[0]).toMatchObject({ text: '- oops' })
  expect(of('jobs_warning')).toHaveLength(1)
  expect(of('jobs_warning')[0]!.problems[0]!.line).toBeGreaterThan(0)

  // another 15 s of the same broken file does not repeat the warning
  await advance(15_000)
  expect(of('jobs_warning')).toHaveLength(1)

  // changes are refused while the file is unreadable, so the user's text is never overwritten
  await expect(jobs.add({ kind: 'alarm', title: 'ใหม่', at: at(clock, 7_200_000) })).rejects.toThrow('jobs.md')
  expect(await readFile(file, 'utf8')).toContain('- oops')

  await writeFile(file, good)
  await advance(15_000)
  expect(jobs.problems()).toEqual([])
  expect(of('jobs_warning').at(-1)!.problems).toEqual([])
})

test('an alarm rings when due, leaves the file, and stops itself after 2 minutes', async () => {
  const { jobs, clock, file, advance, of } = await setup()
  jobs.start()
  await jobs.add({ kind: 'alarm', title: 'ตื่น', at: at(clock, 5 * MIN) })
  await advance(5 * MIN)
  const alarm = of('alarm')
  expect(alarm).toHaveLength(1)
  expect(alarm[0]).toMatchObject({ title: 'ตื่น', card: { layout: 'big', seconds: 90 } })
  expect(alarm[0]!.card.big).toMatch(/^\d{2}:\d{2}$/)
  expect(jobs.ringing()).toMatchObject({ title: 'ตื่น' })
  expect(await readFile(file, 'utf8')).not.toContain('ตื่น {#')

  await advance(2 * MIN - 1000)
  expect(of('alarm_off')).toHaveLength(0)
  await advance(1000)
  expect(of('alarm_off')).toEqual([expect.objectContaining({ id: alarm[0]!.id, why: 'หมดเวลา' })])
  expect(jobs.ringing()).toBeNull()
})

test('while it rings, "ขออีก 5 นาที" snoozes: it stops, and rings again 5 minutes later', async () => {
  const { jobs, clock, advance, of, seen } = await setup()
  jobs.start()
  await jobs.add({ kind: 'alarm', title: 'ตื่น', at: at(clock, MIN) })
  await advance(MIN)
  expect(jobs.ringing()).not.toBeNull()

  const card = await jobs.ringHeard('ขออีก 5 นาที')
  expect(card?.title).toContain('5')
  expect(seen.some(e => e.type === 'heard' && e.text === 'ขออีก 5 นาที')).toBe(true)
  expect(of('alarm_off')).toEqual([expect.objectContaining({ why: 'เลื่อน', snooze: 5 })])
  expect(jobs.ringing()).toBeNull()
  expect(jobs.list()).toHaveLength(1)

  await advance(5 * MIN)
  expect(of('alarm')).toHaveLength(2)
  expect(jobs.ringing()).toMatchObject({ title: 'ตื่น' })
})

test('"เลื่อน" alone snoozes 5 minutes; "หยุด" stops; other words are not for the alarm', async () => {
  const { jobs, clock, advance, of } = await setup()
  jobs.start()
  expect(await jobs.ringHeard('หยุด')).toBeNull() // nothing ringing
  await jobs.add({ kind: 'alarm', title: 'a', at: at(clock, MIN) })
  await advance(MIN)
  expect(await jobs.ringHeard('วันนี้อากาศดีนะ')).toBeNull()
  expect(jobs.ringing()).not.toBeNull()
  await jobs.ringHeard('ขอเลื่อนหน่อย')
  expect(of('alarm_off')[0]).toMatchObject({ why: 'เลื่อน', snooze: 5 })
  await advance(5 * MIN)
  await jobs.ringHeard('หยุด')
  expect(of('alarm_off')[1]).toMatchObject({ why: 'ปิด' })
  expect(of('alarm_off')[1]!.snooze).toBeUndefined()
  expect(jobs.list()).toEqual([])
})

test('stopAlarm (phone tap, neo alarm stop) stops it and reports whether anything was ringing', async () => {
  const { jobs, clock, advance, of } = await setup()
  jobs.start()
  expect(await jobs.stopAlarm('แตะปิด')).toBe(false)
  await jobs.add({ kind: 'alarm', title: 'a', at: at(clock, MIN) })
  await advance(MIN)
  expect(await jobs.stopAlarm('แตะปิด')).toBe(true)
  expect(of('alarm_off')[0]).toMatchObject({ why: 'แตะปิด' })
  expect(await jobs.stopAlarm('แตะปิด')).toBe(false)
})

test('a one-off that is more than 30 minutes late is dropped without ringing', async () => {
  const { jobs, clock, file, advance, of } = await setup()
  await jobs.add({ kind: 'alarm', title: 'พลาด', at: at(clock, MIN) })
  clock.advance(45 * MIN) // the daemon was off
  jobs.start()
  await advance(0)
  expect(of('alarm')).toHaveLength(0)
  expect(jobs.list()).toEqual([])
  expect(await readFile(file, 'utf8')).not.toContain('พลาด')
})

test('a cron job fires once per matching minute and records last', async () => {
  const { jobs, advance, asked, clock } = await setup()
  jobs.start()
  await jobs.add({ kind: 'task', title: 'ข่าว', prompt: 'สรุปข่าว', cron: '* * * * *' })
  await advance(15_000)
  await advance(15_000)
  await advance(15_000)
  await advance(15_000)
  await advance(15_000)
  expect(asked.length).toBeLessThanOrEqual(2) // at most one per minute
  const first = asked.length
  expect(first).toBeGreaterThanOrEqual(1)
  await advance(MIN)
  expect(asked.length).toBe(first + 1)
  expect(jobs.list()[0]!.last).toBeGreaterThan(clock.now() - 2 * MIN)
})

test('a task runs the prompt through Conversation, after publishing job', async () => {
  const { jobs, clock, advance, asked, of } = await setup()
  jobs.start()
  await jobs.add({ kind: 'task', title: 'ตั๋ว', prompt: 'เช็คตั๋วเครื่องบิน', at: at(clock, MIN) })
  await advance(MIN)
  expect(of('job')).toEqual([expect.objectContaining({ title: 'ตั๋ว' })])
  expect(asked).toHaveLength(1)
  expect(asked[0]).toStartWith('[งานตั้งเวลา ')
  expect(asked[0]).toEndWith('เช็คตั๋วเครื่องบิน')
})

test('a task waits while Conversation is busy: retries every 60 s, at most 10 times, then gives up', async () => {
  let isBusy = true
  const { jobs, clock, advance, asked } = await setup({ busy: () => isBusy })
  jobs.start()
  await jobs.add({ kind: 'task', title: 'ตั๋ว', prompt: 'เช็คตั๋ว', at: at(clock, MIN) })
  await advance(MIN)
  expect(asked).toHaveLength(0)
  await advance(30_000)
  expect(asked).toHaveLength(0)
  isBusy = false
  await advance(30_000) // 60 s after the first try
  expect(asked).toHaveLength(1)

  // forever busy: gives up after 10 retries
  isBusy = true
  await jobs.add({ kind: 'task', title: 'อีกอัน', prompt: 'ทำอีกอย่าง', at: clock.now() + MIN })
  await advance(MIN) // first try, busy
  await advance(10 * MIN)
  isBusy = false
  await advance(5 * MIN)
  expect(asked).toHaveLength(1)
})

test('test fires a job now and leaves it in the file', async () => {
  const { jobs, clock, of } = await setup()
  const added = await jobs.add({ kind: 'alarm', title: 'ลองดู', at: at(clock, 3_600_000) })
  await jobs.test('ลองดู')
  expect(of('alarm')).toHaveLength(1)
  expect(jobs.list().map(j => j.id)).toEqual([added.id])
})

test('jobs are found by id or by title; an ambiguous title is refused', async () => {
  const { jobs, clock } = await setup()
  const a = await jobs.add({ kind: 'alarm', title: 'ยา เช้า', at: at(clock, 3_600_000) })
  await jobs.add({ kind: 'alarm', title: 'ยา เย็น', at: at(clock, 7_200_000) })
  expect((await jobs.enable(a.id, false)).enabled).toBe(false)
  expect((await jobs.enable('เช้า', true)).enabled).toBe(true)
  await expect(jobs.enable('ยา', false)).rejects.toThrow('หลายงาน')
  await expect(jobs.remove('nope')).rejects.toMatchObject({ status: 404 })
  expect((await jobs.remove('ยา เย็น')).title).toBe('ยา เย็น')
  expect(await jobs.clear()).toBe(1)
})

test('edit changes the time, switches between at and cron, and refuses a past time or a bad cron', async () => {
  const { jobs, clock } = await setup()
  const a = await jobs.add({ kind: 'alarm', title: 'x', at: at(clock, 3_600_000) })
  expect((await jobs.edit(a.id, { cron: '30 7 * * 1-5' })).cron).toBe('30 7 * * 1-5')
  expect((await jobs.edit(a.id, { cron: '30 7 * * 1-5' })).at).toBeUndefined()
  expect((await jobs.edit(a.id, { at: at(clock, 9_000_000), title: 'y' }))).toMatchObject({ title: 'y', at: at(clock, 9_000_000) })
  await expect(jobs.edit(a.id, { at: clock.now() - 1 })).rejects.toThrow('อนาคต')
  await expect(jobs.edit(a.id, { cron: 'x' })).rejects.toThrow('cron')
  await expect(jobs.edit(a.id, { prompt: 'p' })).rejects.toThrow('task')
})

test('add refuses a task without a prompt and a job without a future time', async () => {
  const { jobs, clock } = await setup()
  await expect(jobs.add({ kind: 'task', title: '', at: at(clock, MIN) })).rejects.toThrow('ให้ทำอะไร')
  await expect(jobs.add({ kind: 'alarm', title: 'x', at: clock.now() - 1 })).rejects.toThrow('เวลา')
  await expect(jobs.add({ kind: 'alarm', title: 'x', cron: '1 2 3' })).rejects.toThrow('5 ช่อง')
})

test('a save based on an old read is refused when jobs.md changed meanwhile (conflict), and goes through when it did not', async () => {
  const { jobs, file, clock } = await setup()
  await jobs.add({ kind: 'alarm', title: 'a', at: at(clock, 3_600_000) })
  const { text, version } = await jobs.readFile()

  await writeFile(file, text + '\nโน้ตที่ใครบางคนเพิ่ม\n') // an outside edit
  const refused = await jobs.saveFile(text.replace('## a', '## b'), version).catch(e => e)
  expect(refused).toBeInstanceOf(JobsError)
  expect(refused.status).toBe(409)
  expect(await readFile(file, 'utf8')).toContain('โน้ตที่ใครบางคนเพิ่ม')

  const fresh = await jobs.readFile()
  await jobs.saveFile(fresh.text.replace('## a', '## b'), fresh.version)
  expect(jobs.list().map(j => j.title)).toEqual(['b'])
})

test('a save with a line Neo cannot read is refused and nothing is written', async () => {
  const { jobs, clock, file } = await setup()
  await jobs.add({ kind: 'alarm', title: 'a', at: at(clock, 3_600_000) })
  const before = await jobs.readFile()
  await expect(jobs.saveFile(before.text + '\n- nonsense\n', before.version)).rejects.toThrow('บรรทัด')
  expect(await readFile(file, 'utf8')).toBe(before.text)
})

test('previous jobs keep ringing while the file is broken, and do not ring twice once it is fixed', async () => {
  const { jobs, clock, file, advance, of } = await setup()
  jobs.start()
  await jobs.add({ kind: 'alarm', title: 'ตื่น', at: at(clock, 5 * MIN) })
  const good = await readFile(file, 'utf8')
  await writeFile(file, good + '\n- oops\n')
  await advance(5 * MIN)
  expect(of('alarm')).toHaveLength(1)
  await advance(2 * MIN)
  await writeFile(file, good) // fixed, but the alarm is still in it
  await advance(MIN)
  expect(of('alarm')).toHaveLength(1)
})

test('the schedule intent from the Brain asks to confirm, then adds; a past time or bad cron is "not sure"', async () => {
  const { jobs, clock } = await setup()
  const when = new Date(clock.now() + 3_600_000)
  const local = `${when.getFullYear()}-${String(when.getMonth() + 1).padStart(2, '0')}-${String(when.getDate()).padStart(2, '0')}T${String(when.getHours()).padStart(2, '0')}:${String(when.getMinutes()).padStart(2, '0')}`
  const answer = await jobs.intent({ kind: 'task', title: 'ตั๋ว', prompt: 'เช็คตั๋วใน google', at: local })
  expect(answer.card.lines.at(-1)).toContain('ตกลง')
  expect(jobs.list()).toEqual([])
  const done = await answer.confirm!()
  expect(done.title).toBe('ตั้งงานแล้ว')
  expect(jobs.list()[0]).toMatchObject({ kind: 'task', prompt: 'เช็คตั๋วใน google' })

  expect((await jobs.intent({ kind: 'alarm', title: 'x', prompt: '', at: '2001-01-01T00:00' })).confirm).toBeUndefined()
  expect((await jobs.intent({ kind: 'alarm', title: 'x', prompt: '', cron: 'bad' })).confirm).toBeUndefined()
})

test('fast phrases: a time phrase asks to confirm; list answers; unrelated text is null', async () => {
  const { jobs, clock } = await setup()
  expect(jobs.understand('วันนี้อากาศเป็นยังไง')).toBeNull()
  const answer = jobs.understand('ปลุก 7 โมงครึ่ง')!
  expect(answer.card.title).toBe('ตั้งปลุกไหม?')
  expect(answer.confirm).toBeDefined()
  expect(jobs.list()).toEqual([])
  await answer.confirm!()
  expect(jobs.list()).toHaveLength(1)

  const list = jobs.understand('มีปลุกอะไรบ้าง')!
  expect(list.card.items).toHaveLength(1)
  expect(list.confirm).toBeUndefined()
  expect(clock.now()).toBeGreaterThan(0)

  const clear = jobs.understand('ยกเลิกปลุกทั้งหมด')!
  expect(jobs.list()).toHaveLength(1) // asks first
  await clear.confirm!()
  expect(jobs.list()).toEqual([])
})

test('the real file watcher picks up an edit made outside (no tick needed)', async () => {
  const { jobs, file, dir } = await setup()
  jobs.start({ watch: true })
  await Bun.sleep(100) // the watcher is set up asynchronously
  await writeFile(file, `## จากข้างนอก {#w1}\n- kind: alarm\n- at: 2031-01-01 20:00\n`)
  for (let i = 0; i < 100 && !jobs.list().length; i++) await Bun.sleep(20)
  expect(jobs.list().map(j => j.title)).toEqual(['จากข้างนอก'])
  expect(dir).toBeTruthy()
})

test('onState reports ringing and busy: a task is busy until it finishes, including while it waits to retry', async () => {
  const states: Array<{ ringing: boolean; busy: boolean }> = []
  let isBusy = true
  let finish!: () => void
  const { dir, cleanup } = await tempHome()
  const clock = new FakeClock(Math.ceil(1_700_000_000_000 / MIN) * MIN)
  const jobs = await createJobs({
    home: dir, clock, events: createEvents({ clock }), busy: () => isBusy,
    ask: () => new Promise<void>(resolve => (finish = resolve)), onState: s => void states.push(s),
  })
  cleanups.push(() => jobs.stop(), cleanup)
  jobs.start()
  await jobs.add({ kind: 'task', title: 't', prompt: 'p', at: clock.now() + MIN })
  clock.advance(MIN)
  await jobs.idle()
  expect(states.at(-1)).toEqual({ ringing: false, busy: true }) // waiting to retry
  isBusy = false
  clock.advance(MIN)
  expect(states.at(-1)).toEqual({ ringing: false, busy: true }) // running
  finish()
  await Bun.sleep(0)
  expect(states.at(-1)).toEqual({ ringing: false, busy: false })
})
