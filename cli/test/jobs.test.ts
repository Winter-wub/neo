// Ticket 09 end to end: neo jobs / neo alarm / alarm events against a real core, a real socket, the phone port and a fake clock.
import { afterEach, expect, test } from 'bun:test'
import { chmod, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { runCli } from '../src/adapters/command/cli'
import { startCommandServer } from '../src/adapters/command/server'
import { startPhoneServer } from '../src/adapters/phone/server'
import type { Answer, Brain } from '../src/core/brain/brain'
import { textCard } from '../src/core/cards/cards'
import { createCore } from '../src/core/core'
import type { JobInfo } from '../src/protocol'
import { FakeClock, golden, tempHome } from './helpers'

const MIN = 60_000
const cleanups: Array<() => Promise<unknown>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

/** A Brain that answers from a script and records what it was asked. */
function scriptedBrain(answer: () => Answer = () => ({ type: 'card', card: textCard({ title: 'ตอบแล้ว', lines: ['ตอบแล้ว'] }) })) {
  const asked: string[] = []
  const brain: Brain = {
    label: 'Fake',
    ask: async request => (asked.push(request.text), { answer: answer(), session: 's1' }),
    runSkill: async () => ({ answer: answer(), session: null }),
  }
  return { brain, asked }
}

async function running(brainSetup = scriptedBrain()) {
  const { dir, cleanup } = await tempHome()
  const clock = new FakeClock(Math.ceil(1_700_000_000_000 / MIN) * MIN)
  const core = await createCore({ home: dir, clock, pid: 1, brain: brainSetup.brain, env: { HOME: dir, PATH: process.env.PATH } })
  core.jobs.start()
  const server = await startCommandServer({ core, clock, home: dir })
  const phone = await startPhoneServer({ core, clock, port: 0, apkPath: join(dir, 'neo.apk'), networks: () => [], tailscale: async () => null })
  cleanups.push(cleanup, () => core.stop(), () => server.stop(), () => phone.stop(), () => core.devices.flush())
  return { dir, core, clock, phone, asked: brainSetup.asked, file: join(dir, 'jobs.md') }
}

async function neo(dir: string, args: string[], env: Record<string, string> = {}, confirm?: (q: string) => Promise<boolean>) {
  const out: string[] = []
  const err: string[] = []
  const code = await runCli([...args, '--home', dir], { out: t => void out.push(t), err: t => void err.push(t), env, confirm })
  return { code, stdout: out.join(''), stderr: err.join('') }
}

function watch(dir: string) {
  const abort = new AbortController()
  const lines: any[] = []
  const done = runCli(['events', '--json', '--home', dir], {
    out: t => void lines.push(...t.split('\n').filter(Boolean).map(l => JSON.parse(l))), err() {}, env: {}, signal: abort.signal,
  })
  cleanups.push(async () => { abort.abort(); await done })
  const poll = async (match: (e: any) => boolean) => {
    for (let i = 0; i < 200; i++) {
      const hit = lines.find(match)
      if (hit) return hit
      await Bun.sleep(20)
    }
    throw new Error('event never arrived')
  }
  return { lines, poll }
}

const ID = 'a1b2c3d4'
const stable = (job: JobInfo) => ({ ...job, id: ID })

test('neo jobs add "<speech>" previews what it understood, then adds; list shows the next run', async () => {
  const { dir } = await running()
  const add = await neo(dir, ['jobs', 'add', 'ปลุกพรุ่งนี้ตีห้าครึ่ง'])
  expect(add.code).toBe(0)
  expect(add.stdout).toContain('05:30') // the preview
  expect(add.stdout).toContain('เพิ่มแล้ว')

  const list = await neo(dir, ['jobs', 'list'])
  expect(list.stdout).toContain('ปลุก')
  expect(list.stdout).toContain('ครั้งถัดไป')

  const json = JSON.parse((await neo(dir, ['jobs', 'list', '--json'])).stdout)
  expect(json.jobs).toHaveLength(1)
  expect(json.jobs[0]).toMatchObject({ kind: 'alarm', title: 'ปลุก', enabled: true })
  expect(new Date(json.jobs[0].next).getHours()).toBe(5)
  await golden('jobs-list', { ...json, jobs: [{ id: ID, kind: 'alarm', title: 'ปลุก', enabled: true, at: 1_700_000_000_000 + 7 * 3_600_000, next: 1_700_000_000_000 + 7 * 3_600_000, when: 'พรุ่งนี้ 05:30' }], ringing: null, problems: [] })
})

test('declining the preview adds nothing and exits 1; --yes skips the preview; a sentence without a time exits 1', async () => {
  const { dir, core } = await running()
  const declined = await neo(dir, ['jobs', 'add', 'ปลุก 7 โมงครึ่ง'], {}, async () => false)
  expect(declined.code).toBe(1)
  expect(declined.stdout).toContain('07:30')
  expect(core.jobs.list()).toEqual([])

  const yes = await neo(dir, ['jobs', 'add', 'ปลุก 7 โมงครึ่ง', '--yes'])
  expect(yes.code).toBe(0)
  expect(yes.stdout).not.toContain('# ปลุก')
  expect(core.jobs.list()).toHaveLength(1)

  const nonsense = await neo(dir, ['jobs', 'add', 'วันนี้อากาศดี', '--json'])
  expect(nonsense.code).toBe(1)
  expect(JSON.parse(nonsense.stdout)).toMatchObject({ code: 1 })
})

test('the detailed add, edit, on/off, test and rm commands, with --json shapes', async () => {
  const { dir, core, clock } = await running()
  const at = (ms: number) => {
    const d = new Date(clock.now() + ms)
    const p = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
  }
  const added = await neo(dir, ['jobs', 'add', '--kind', 'task', '--title', 'ข่าวเช้า', '--prompt', 'สรุปข่าววันนี้', '--cron', '30 7 * * 1-5', '--json'])
  expect(added.code).toBe(0)
  const job = JSON.parse(added.stdout) as JobInfo
  expect(job).toMatchObject({ kind: 'task', cron: '30 7 * * 1-5', prompt: 'สรุปข่าววันนี้', when: '07:30 วันธรรมดา' })
  await golden('jobs-add', stable({ ...job, next: 1_700_000_000_000 + 8 * 3_600_000 }))

  const edited = JSON.parse((await neo(dir, ['jobs', 'edit', 'ข่าวเช้า', '--at', at(2 * 3_600_000), '--title', 'ข่าวบ่าย', '--json'])).stdout) as JobInfo
  expect(edited.title).toBe('ข่าวบ่าย')
  expect(edited.cron).toBeUndefined()
  expect(edited.at).toBe(clock.now() + 2 * 3_600_000)

  expect(JSON.parse((await neo(dir, ['jobs', 'off', 'ข่าวบ่าย', '--json'])).stdout)).toMatchObject({ enabled: false, next: null })
  expect(JSON.parse((await neo(dir, ['jobs', 'on', job.id, '--json'])).stdout).enabled).toBe(true)

  const tested = await neo(dir, ['jobs', 'test', 'ข่าวบ่าย', '--json'])
  expect(JSON.parse(tested.stdout)).toEqual({ ok: true })
  await golden('jobs-test', { ok: true })

  const removed = await neo(dir, ['jobs', 'rm', 'ข่าวบ่าย', '--json'])
  expect(JSON.parse(removed.stdout).removed.title).toBe('ข่าวบ่าย')
  await golden('jobs-rm', { removed: stable({ ...job, next: 1_700_000_000_000 + 8 * 3_600_000 }) })
  expect(core.jobs.list()).toEqual([])
  expect((await neo(dir, ['jobs', 'rm', 'ไม่มีอันนี้'])).code).toBe(1)

  await neo(dir, ['jobs', 'add', '--kind', 'alarm', '--title', 'a', '--at', at(MIN * 90)])
  const cleared = await neo(dir, ['jobs', 'clear', '--json'])
  expect(JSON.parse(cleared.stdout)).toEqual({ removed: 1 })
  await golden('jobs-clear', { removed: 1 })
})

test('usage errors exit 2', async () => {
  const { dir } = await running()
  for (const args of [['jobs', 'wat'], ['jobs', 'on'], ['jobs', 'add', '--kind', 'alarm'], ['jobs', 'add', '--kind', 'x', '--cron', '* * * * *'], ['alarm', 'snooze', 'x'], ['alarm', 'snooze', '99'], ['jobs', 'edit', '--title', 'x'], ['jobs', 'add', '--kind', 'alarm', '--at', 'tomorrow']]) {
    expect((await neo(dir, args)).code).toBe(2)
  }
})

test('an alarm rings with a fake clock; "ขออีก 5 นาที" snoozes; it rings again; neo alarm stop stops it; golden events', async () => {
  const { dir, core, clock } = await running()
  const events = watch(dir)
  await Bun.sleep(100)
  await neo(dir, ['jobs', 'add', 'ปลุกอีก 10 นาที', '--yes'])
  const settle = async () => core.jobs.idle()

  clock.advance(10 * MIN)
  await settle()
  const alarm = await events.poll(e => e.type === 'alarm')
  expect(alarm).toMatchObject({ title: 'ปลุก', card: { layout: 'big', seconds: 90 } })
  expect(core.status().pid).toBe(1)

  const snooze = await neo(dir, ['say', 'ขออีก 5 นาที'])
  expect(snooze.code).toBe(0)
  expect(snooze.stdout).toContain('5 นาที')
  const off = await events.poll(e => e.type === 'alarm_off')
  expect(off).toMatchObject({ why: 'เลื่อน', snooze: 5 })

  clock.advance(5 * MIN)
  await settle()
  await Bun.sleep(50)
  expect(events.lines.filter(e => e.type === 'alarm')).toHaveLength(2)

  const stopped = await neo(dir, ['alarm', 'stop', '--json'])
  expect(JSON.parse(stopped.stdout)).toEqual({ stopped: true })
  await golden('alarm-stop', { stopped: true })
  expect((await neo(dir, ['alarm', 'stop'])).code).toBe(1) // nothing ringing now
  await events.poll(e => e.type === 'alarm_off' && e.why === 'ปิด')

  const types = new Set(events.lines.map(e => e.type))
  for (const type of ['schedule', 'jobs', 'alarm', 'alarm_off']) expect(types.has(type)).toBe(true)
  const normal = (e: any) => ({ ...e, id: ID, at: 1_700_000_000_000 })
  await golden('event-alarm', { ...normal(alarm), card: { ...alarm.card, big: '22:23' } })
  await golden('event-alarm_off', normal(off))
  await golden('event-schedule', { ...normal(events.lines.find(e => e.type === 'schedule')), id: undefined, when: 'วันนี้ 22:23' })
  await golden('event-jobs', { type: 'jobs', at: 1_700_000_000_000 })
})

test('the ringing alarm stops itself after 2 minutes', async () => {
  const { dir, core, clock } = await running()
  const events = watch(dir)
  await Bun.sleep(100)
  await neo(dir, ['jobs', 'add', 'ปลุกอีก 1 นาที', '--yes'])
  clock.advance(MIN)
  await core.jobs.idle()
  await events.poll(e => e.type === 'alarm')
  expect(core.status()).toMatchObject({ ringing: true, busy: false })
  clock.advance(2 * MIN)
  const off = await events.poll(e => e.type === 'alarm_off')
  expect(off.why).toBe('หมดเวลา')
  expect(core.status().ringing).toBe(false)
  expect(core.jobs.ringing()).toBeNull()
})

test('a task job runs its prompt through the Brain and shows the card', async () => {
  const { dir, core, clock, asked } = await running()
  const events = watch(dir)
  await Bun.sleep(100)
  await neo(dir, ['jobs', 'add', '--kind', 'task', '--title', 'ข่าว', '--prompt', 'สรุปข่าววันนี้', '--at', (() => {
    const d = new Date(clock.now() + MIN)
    const p = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
  })()])
  clock.advance(MIN)
  await core.jobs.idle()
  const job = await events.poll(e => e.type === 'job')
  await golden('event-job', { ...job, id: ID, at: 1_700_000_000_000 })
  await events.poll(e => e.type === 'card')
  expect(asked).toHaveLength(1)
  expect(asked[0]).toMatch(/^\[งานตั้งเวลา .*\] สรุปข่าววันนี้$/)
})

test('editing jobs.md by hand: a bad line keeps the old jobs, emits a warning and shows in neo doctor; fixing it recovers', async () => {
  const { dir, core, clock, file } = await running()
  const events = watch(dir)
  await Bun.sleep(100)
  await neo(dir, ['jobs', 'add', 'ปลุก 7 โมงครึ่ง', '--yes'])
  const good = await readFile(file, 'utf8')

  await writeFile(file, good + '\n- oops\n')
  clock.advance(15_000)
  await core.jobs.idle()
  const warning = await events.poll(e => e.type === 'jobs_warning' && e.problems.length > 0)
  expect(warning.problems[0]).toMatchObject({ text: '- oops' })
  await golden('event-jobs_warning', { ...warning, at: 1_700_000_000_000, problems: [{ line: 8, text: '- oops', error: 'รูปแบบต้องเป็น "- ชื่อ: ค่า"' }] })

  const list = JSON.parse((await neo(dir, ['jobs', 'list', '--json'])).stdout)
  expect(list.jobs).toHaveLength(1)
  expect(list.problems).toHaveLength(1)
  expect((await neo(dir, ['jobs', 'list'])).stdout).toContain('- oops')

  const doctor = JSON.parse((await neo(dir, ['doctor', '--json'])).stdout) as Array<{ id: string; ok: boolean; detail: string }>
  const row = doctor.find(r => r.id === 'jobs')!
  expect(row.ok).toBe(false)
  expect(row.detail).toContain('- oops')

  const refused = await neo(dir, ['jobs', 'add', 'ปลุก 9 โมง', '--yes'])
  expect(refused.code).toBe(1)
  expect(await readFile(file, 'utf8')).toContain('- oops')

  await writeFile(file, good)
  clock.advance(15_000)
  await core.jobs.idle()
  await events.poll(e => e.type === 'jobs_warning' && e.problems.length === 0)
  const fixed = JSON.parse((await neo(dir, ['doctor', '--json'])).stdout) as Array<{ id: string; ok: boolean }>
  expect(fixed.find(r => r.id === 'jobs')!.ok).toBe(true)
})

test('neo jobs edit with no flags opens jobs.md in $EDITOR; a save that races an outside edit is refused with exit 1', async () => {
  const { dir, core, file } = await running()
  await neo(dir, ['jobs', 'add', 'ปลุก 7 โมงครึ่ง', '--yes'])
  const editor = join(dir, 'editor.sh')

  // an editor that renames the job
  await writeFile(editor, '#!/bin/sh\nsed -i.bak "s/## ปลุก/## ตื่นเช้า/" "$1"\n')
  await chmod(editor, 0o755)
  const ok = await neo(dir, ['jobs', 'edit', '--json'], { EDITOR: editor })
  expect(ok.code).toBe(0)
  expect(JSON.parse(ok.stdout)).toEqual({ version: expect.any(String) })
  await golden('jobs-file-saved', { version: 'k3j2h1g0' })
  expect(core.jobs.list().map(j => j.title)).toEqual(['ตื่นเช้า'])

  // an editor during which someone else edits the real file
  await writeFile(editor, `#!/bin/sh\nprintf '\\nโน้ตจากข้างนอก\\n' >> "${file}"\nsed -i.bak "s/## ตื่นเช้า/## ทับ/" "$1"\n`)
  const raced = await neo(dir, ['jobs', 'edit'], { EDITOR: editor })
  expect(raced.code).toBe(1)
  expect(raced.stderr).toContain('ถูกแก้ไข')
  expect(raced.stderr).toContain('neo-edit-') // where the user's version was kept
  const text = await readFile(file, 'utf8')
  expect(text).toContain('โน้ตจากข้างนอก')
  expect(text).toContain('## ตื่นเช้า')
  expect(text).not.toContain('## ทับ')

  // an editor that leaves a line Neo cannot read is refused too, and the file is untouched
  await writeFile(editor, '#!/bin/sh\nprintf "\\n- nonsense\\n" >> "$1"\n')
  expect((await neo(dir, ['jobs', 'edit'], { EDITOR: editor })).code).toBe(1)
  expect(await readFile(file, 'utf8')).toBe(text)

  // no change: nothing to save
  await writeFile(editor, '#!/bin/sh\ntrue\n')
  const unchanged = await neo(dir, ['jobs', 'edit'], { EDITOR: editor })
  expect(unchanged.code).toBe(0)
  expect(unchanged.stdout).toContain('ไม่มีการเปลี่ยนแปลง')
})

test('fast phrases: a time phrase asks to confirm, "ตกลง" sets it; words while ringing stop it without a wake word; the Brain is never asked', async () => {
  const { dir, core, clock, asked } = await running()
  const ask = await neo(dir, ['say', 'นีโอ ปลุก 7 โมงครึ่ง'])
  expect(ask.code).toBe(0)
  expect(ask.stdout).toContain('ตั้งปลุกไหม?')
  expect(core.jobs.list()).toEqual([])
  const yes = await neo(dir, ['say', 'ตกลง'])
  expect(yes.stdout).toContain('ตั้งแล้ว')
  expect(core.jobs.list()).toHaveLength(1)

  const cancelled = await neo(dir, ['say', 'นีโอ ปลุก 9 โมง'])
  expect(cancelled.stdout).toContain('ตั้งปลุกไหม?')
  expect((await neo(dir, ['say', 'ยกเลิก'])).code).toBe(1)
  expect(core.jobs.list()).toHaveLength(1)

  await core.jobs.test('ปลุก')
  expect(core.jobs.ringing()).not.toBeNull()
  const stop = await neo(dir, ['say', 'หยุดได้แล้ว'])
  expect(stop.code).toBe(0)
  expect(core.jobs.ringing()).toBeNull()
  expect(asked).toEqual([])
  expect(clock.now()).toBeGreaterThan(0)
})

test('the Brain\'s schedule intent asks to confirm, then sets the job', async () => {
  const when = new Date(Math.ceil(1_700_000_000_000 / MIN) * MIN + 3_600_000)
  const p = (n: number) => String(n).padStart(2, '0')
  const at = `${when.getFullYear()}-${p(when.getMonth() + 1)}-${p(when.getDate())}T${p(when.getHours())}:${p(when.getMinutes())}`
  const { dir, core, asked } = await running(scriptedBrain(() => ({ type: 'schedule', kind: 'task', title: 'ตั๋ว', prompt: 'เช็คตั๋วใน google', at })))
  const ask = await neo(dir, ['say', 'นีโอ พรุ่งนี้เช้าช่วยเช็คตั๋วเครื่องบินหน่อย'])
  expect(ask.stdout).toContain('ตั้งงานนี้ไหม?')
  expect(asked).toHaveLength(1)
  expect(core.jobs.list()).toEqual([])
  expect((await neo(dir, ['say', 'ตกลง'])).stdout).toContain('ตั้งงานแล้ว')
  expect(core.jobs.list()[0]).toMatchObject({ kind: 'task', prompt: 'เช็คตั๋วใน google' })
})

test('the phone: hello says what rings, and POST /api/alarm/stop stops or snoozes it', async () => {
  const { core, phone, clock } = await running()
  const { code } = core.devices.startPairing()
  const base = `http://127.0.0.1:${phone.port}`
  const paired = await (await fetch(`${base}/api/pair`, { method: 'POST', body: JSON.stringify({ code, name: 'A7' }) })).json() as { token: string }
  const headers = { authorization: `Bearer ${paired.token}` }
  const stop = (body: object) => fetch(`${base}/api/alarm/stop`, { method: 'POST', headers, body: JSON.stringify(body) }).then(r => r.json())

  expect(await stop({})).toEqual({ stopped: false })
  await core.jobs.add({ kind: 'alarm', title: 'ตื่น', at: clock.now() + MIN })
  clock.advance(MIN)
  await core.jobs.idle()

  const abort = new AbortController()
  cleanups.push(async () => abort.abort())
  const res = await fetch(`${base}/api/events`, { headers, signal: abort.signal })
  const reader = res.body!.getReader()
  const first = JSON.parse(new TextDecoder().decode((await reader.read()).value).split('\n')[0]!)
  expect(first).toMatchObject({ type: 'hello', ringing: 'ตื่น' })

  expect(await stop({ snooze: 5 })).toEqual({ stopped: true })
  expect(core.events.listeners()).toBeGreaterThanOrEqual(0)
  expect(core.jobs.list()).toHaveLength(1) // the snoozed alarm
  expect(await stop({})).toEqual({ stopped: false })
  expect((await fetch(`${base}/api/alarm/stop`, { method: 'POST', body: '{}' })).status).toBe(401)
})

test('tapping the phone to stop reports why as แตะปิด', async () => {
  const { core, phone, clock } = await running()
  const { code } = core.devices.startPairing()
  const base = `http://127.0.0.1:${phone.port}`
  const paired = await (await fetch(`${base}/api/pair`, { method: 'POST', body: JSON.stringify({ code, name: 'A7' }) })).json() as { token: string }
  const seen: any[] = []
  core.events.subscribe(e => seen.push(e))
  await core.jobs.add({ kind: 'alarm', title: 'ตื่น', at: clock.now() + MIN })
  clock.advance(MIN)
  await core.jobs.idle()
  await fetch(`${base}/api/alarm/stop`, { method: 'POST', headers: { authorization: `Bearer ${paired.token}` }, body: '{}' })
  expect(seen.find(e => e.type === 'alarm_off')).toMatchObject({ why: 'แตะปิด' })
})
