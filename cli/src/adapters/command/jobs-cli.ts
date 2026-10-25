import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EXIT, type ExitCode } from '../../protocol'
import type { Command, Globals } from './argv'
import { CommandFailed, type Daemon } from './client'
import { draftMarkdown, jobMarkdown, jobsMarkdown } from './jobs-render'

type JobsCliCommand = Extract<Command, { name: `jobs-${string}` | `alarm-${string}` }>
export const isJobsCommand = (command: Command): command is JobsCliCommand => command.name.startsWith('jobs-') || command.name.startsWith('alarm-')

interface Io {
  out(text: string): void
  env: Record<string, string | undefined>
  /** Ask a yes/no question on the terminal. Absent (not a terminal): the answer is yes. */
  confirm?(question: string): Promise<boolean>
}

/** Opens jobs.md as a temp copy in $VISUAL/$EDITOR/vi. `edited` is null when nothing changed. */
async function editCopy(text: string, env: Io['env']) {
  const dir = await mkdtemp(join(tmpdir(), 'neo-edit-'))
  const file = join(dir, 'jobs.md')
  await writeFile(file, text, { mode: 0o600 })
  const editor = env.VISUAL || env.EDITOR || process.env.VISUAL || process.env.EDITOR || 'vi'
  const run = Bun.spawn(['sh', '-c', `exec ${editor} "$0"`, file], { stdin: 'inherit', stdout: 'inherit', stderr: 'inherit', env: { ...process.env, ...env } as Record<string, string> })
  const code = await run.exited
  if (code !== 0) {
    await rm(dir, { recursive: true, force: true })
    throw new CommandFailed(`ตัวแก้ไข (${editor}) ออกด้วย code ${code} ไม่ได้บันทึก`, EXIT.failed)
  }
  const edited = await readFile(file, 'utf8')
  return { edited: edited === text ? null : edited, file, discard: () => rm(dir, { recursive: true, force: true }) }
}

export async function runJobsCommand(command: JobsCliCommand, daemon: Daemon, globals: Globals, io: Io): Promise<ExitCode> {
  const print = (value: unknown, markdown: string) => io.out((globals.json ? JSON.stringify(value) : markdown) + '\n')
  switch (command.name) {
    case 'jobs-list': {
      const list = await daemon.call('GET /jobs')
      print(list, jobsMarkdown(list))
      return EXIT.ok
    }
    case 'jobs-parse': {
      const parsed = await daemon.call('POST /jobs/parse', { speech: command.speech })
      print(parsed, draftMarkdown(parsed.draft))
      return EXIT.ok
    }
    case 'jobs-add-speech': {
      const { draft } = await daemon.call('POST /jobs/parse', { speech: command.speech })
      if (!command.yes && !globals.json) {
        io.out(draftMarkdown(draft) + '\n')
        if (io.confirm && !(await io.confirm('เพิ่มไหม? [Y/n] '))) throw new CommandFailed('ไม่ได้เพิ่ม', EXIT.failed)
      }
      const { when: _when, ...body } = draft
      const job = await daemon.call('POST /jobs/add', body)
      print(job, `เพิ่มแล้ว: ${jobMarkdown(job)}`)
      return EXIT.ok
    }
    case 'jobs-add': {
      const { name: _name, ...body } = command
      const job = await daemon.call('POST /jobs/add', body)
      print(job, `เพิ่มแล้ว: ${jobMarkdown(job)}`)
      return EXIT.ok
    }
    case 'jobs-edit': {
      if (command.ref !== undefined && Object.values(command.patch).some(value => value !== undefined)) {
        const job = await daemon.call('POST /jobs/edit', { ref: command.ref, ...command.patch })
        print(job, `แก้แล้ว: ${jobMarkdown(job)}`)
        return EXIT.ok
      }
      const file = await daemon.call('GET /jobs/file')
      const copy = await editCopy(file.text, io.env)
      if (copy.edited === null) {
        await copy.discard()
        print({ version: file.version }, 'ไม่มีการเปลี่ยนแปลง')
        return EXIT.ok
      }
      try {
        const saved = await daemon.call('POST /jobs/file', { text: copy.edited, since: file.version })
        await copy.discard()
        print(saved, 'บันทึก jobs.md แล้ว')
        return EXIT.ok
      } catch (e) {
        // refused (the file changed meanwhile, or a line is unreadable): keep what the user wrote
        if (e instanceof CommandFailed) throw new CommandFailed(`${e.message}\nสิ่งที่คุณแก้ยังอยู่ที่ ${copy.file}`, e.code)
        throw e
      }
    }
    case 'jobs-enable': {
      const job = await daemon.call('POST /jobs/enable', { ref: command.ref, enabled: command.enabled })
      print(job, `${command.enabled ? 'เปิด' : 'ปิด'}แล้ว: ${jobMarkdown(job)}`)
      return EXIT.ok
    }
    case 'jobs-rm': {
      const done = await daemon.call('POST /jobs/remove', { ref: command.ref })
      print(done, `ลบแล้ว: ${jobMarkdown(done.removed)}`)
      return EXIT.ok
    }
    case 'jobs-clear': {
      const done = await daemon.call('POST /jobs/clear', { kind: command.kind })
      print(done, done.removed ? `ลบแล้ว ${done.removed} รายการ` : 'ไม่มีรายการให้ลบ')
      return EXIT.ok
    }
    case 'jobs-test': {
      const done = await daemon.call('POST /jobs/test', { ref: command.ref })
      print(done, 'สั่งทำเดี๋ยวนี้แล้ว')
      return EXIT.ok
    }
    case 'alarm-stop':
    case 'alarm-snooze': {
      const snooze = command.name === 'alarm-snooze' ? command.minutes : undefined
      const done = await daemon.call('POST /alarm/stop', { snooze })
      if (!done.stopped) throw new CommandFailed('ไม่มีนาฬิกาปลุกที่กำลังดัง', EXIT.failed)
      print(done, snooze ? `เลื่อนไป ${snooze} นาที` : 'ปิดนาฬิกาปลุกแล้ว')
      return EXIT.ok
    }
  }
}
