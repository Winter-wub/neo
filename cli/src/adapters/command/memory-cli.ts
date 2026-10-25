import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EXIT, type ExitCode, type JournalDay, type JournalDoc, type JournalEntry, type MemoryDoc, type MemoryItem } from '../../protocol'
import type { Command, Globals } from './argv'
import { CommandFailed, type Daemon } from './client'

type MemoryCommand = Extract<Command, { name: `memory-${string}` | `journal-${string}` }>
export const isMemoryCommand = (command: Command): command is MemoryCommand => command.name.startsWith('memory-') || command.name.startsWith('journal-')

interface Io {
  out(text: string): void
  env: Record<string, string | undefined>
}

const item = (i: MemoryItem) => `- [${i.section || '-'}] ${i.text}`
/** memory.md as written, with "← ฝัน <id>" after each item a dream added. */
function withDreamMarks({ text, items }: MemoryDoc) {
  const from = new Map(items.flatMap(i => (i.from ? [[i.text, i.from.id] as const] : [])))
  if (!from.size) return text
  return text.split('\n').map(line => {
    const id = from.get(/^[-*]\s+(.*?)\s*$/.exec(line)?.[1] ?? '')
    return id ? `${line.trimEnd()}  ← ฝัน ${id}` : line
  }).join('\n')
}
const turn = (e: JournalEntry) => `- ${e.day} ${e.time}${e.ok ? '' : ' ✗'}  ${e.q}`

/** Opens `text` in $VISUAL/$EDITOR/vi as a temp copy named `name`; null if nothing changed. The copy is kept when `keep` is true. */
async function editCopy(name: string, text: string, env: Io['env']) {
  const dir = await mkdtemp(join(tmpdir(), 'neo-edit-'))
  const file = join(dir, name)
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

/** Save an edited copy; on a refused save the copy stays on disk and its path is in the message. */
async function saveEdit<T>(copy: Awaited<ReturnType<typeof editCopy>>, save: (text: string) => Promise<T>): Promise<T> {
  try {
    const saved = await save(copy.edited!)
    await copy.discard()
    return saved
  } catch (e) {
    if (e instanceof CommandFailed) throw new CommandFailed(`${e.message}\nสิ่งที่คุณแก้ยังอยู่ที่ ${copy.file}`, e.code)
    throw e
  }
}

export async function runMemoryCommand(command: MemoryCommand, daemon: Daemon, globals: Globals, io: Io): Promise<ExitCode> {
  const print = (value: unknown, markdown: string) => io.out((globals.json ? JSON.stringify(value) : markdown) + '\n')
  switch (command.name) {
    case 'memory-show': {
      const doc = await daemon.call('GET /memory')
      print(doc, doc.text.trim() ? withDreamMarks(doc) : '(ยังไม่มีความจำ — เพิ่มด้วย neo memory add "…")')
      return EXIT.ok
    }
    case 'memory-add': {
      const doc = await daemon.call('POST /memory/add', { text: command.text, section: command.section })
      print(doc, `จำแล้ว: ${command.text}`)
      return EXIT.ok
    }
    case 'memory-forget': {
      const done = await daemon.call('POST /memory/forget', { text: command.text, all: command.all })
      print(done, `ลืมแล้ว ${done.removed.length} รายการ:\n${done.removed.map(item).join('\n')}`)
      return EXIT.ok
    }
    case 'memory-clear': {
      const done = await daemon.call('POST /memory/clear')
      print(done, `ล้างความจำแล้ว (${done.removed} รายการ)`)
      return EXIT.ok
    }
    case 'memory-edit': {
      const doc = await daemon.call('GET /memory')
      const copy = await editCopy('memory.md', doc.text, io.env)
      if (copy.edited === null) {
        await copy.discard()
        print(doc satisfies MemoryDoc, 'ไม่มีการเปลี่ยนแปลง')
        return EXIT.ok
      }
      const saved = await saveEdit(copy, text => daemon.call('POST /memory', { text, since: doc.version }))
      print(saved, `บันทึกความจำแล้ว (${saved.items.length} รายการ)`)
      return EXIT.ok
    }
    case 'journal-list': {
      const days: JournalDay[] = await daemon.call('GET /journal')
      print(days, days.length ? days.map(d => `- ${d.day} — ${d.entries} รายการ`).join('\n') : '(ยังไม่มี journal)')
      return EXIT.ok
    }
    case 'journal-show': {
      const doc = await daemon.call('POST /journal/show', { day: command.day })
      print(doc, doc.text.trim() ? doc.text : `(ไม่มีบันทึกของวัน ${doc.day})`)
      return EXIT.ok
    }
    case 'journal-edit': {
      const doc: JournalDoc = await daemon.call('POST /journal/show', { day: command.day })
      if (!doc.text) throw new CommandFailed(`ไม่มีบันทึกของวัน ${doc.day} (ดู neo journal list)`, EXIT.failed)
      const copy = await editCopy(`${doc.day}.md`, doc.text, io.env)
      if (copy.edited === null) {
        await copy.discard()
        print(doc, 'ไม่มีการเปลี่ยนแปลง')
        return EXIT.ok
      }
      const saved = await saveEdit(copy, text => daemon.call('POST /journal/save', { day: doc.day, text, since: doc.version }))
      print(saved, `บันทึก journal ${saved.day} แล้ว (${saved.entries.length} รายการ)`)
      return EXIT.ok
    }
    case 'journal-forget': {
      const done = await daemon.call('POST /journal/forget', { text: command.text, all: command.all })
      print(done, `ลืมแล้ว ${done.removed.length} รายการ:\n${done.removed.map(turn).join('\n')}`)
      return EXIT.ok
    }
    case 'journal-clear': {
      const done = await daemon.call('POST /journal/clear')
      print(done, `ล้าง journal แล้ว (${done.removed} วัน)`)
      return EXIT.ok
    }
  }
}
