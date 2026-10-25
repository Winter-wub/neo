import { EXIT, type ExitCode } from '../../protocol'
import type { Command, Globals } from './argv'
import type { Daemon } from './client'
import { dreamDoneMarkdown, dreamLine, dreamListMarkdown, dreamStatusMarkdown } from './dream-render'

type DreamCliCommand = Extract<Command, { name: `dream-${string}` }>
export const isDreamCommand = (command: Command): command is DreamCliCommand => command.name.startsWith('dream-')

interface Io {
  out(text: string): void
}

export async function runDreamCommand(command: DreamCliCommand, daemon: Daemon, globals: Globals, io: Io): Promise<ExitCode> {
  const print = (value: unknown, markdown: string) => io.out((globals.json ? JSON.stringify(value) : markdown) + '\n')
  switch (command.name) {
    case 'dream-now': {
      const dream = await daemon.call('POST /dream/now')
      print(dream, dreamDoneMarkdown(dream))
      return EXIT.ok
    }
    case 'dream-enable': {
      const status = await daemon.call('POST /dream/enable', { enabled: command.enabled })
      print(status, command.enabled ? 'เปิดการฝันเองตอนผู้ใช้ไม่อยู่แล้ว' : 'ปิดการฝันเองแล้ว (neo dream now ยังสั่งได้)')
      return EXIT.ok
    }
    case 'dream-list': {
      const dreams = await daemon.call('GET /dreams')
      print(dreams, dreamListMarkdown(dreams))
      return EXIT.ok
    }
    case 'dream-show': {
      const doc = await daemon.call('POST /dreams/show', { id: command.id })
      print(doc, doc.text.trim())
      return EXIT.ok
    }
    case 'dream-rm': {
      const done = await daemon.call('POST /dreams/rm', { id: command.id })
      print(done, `ลบความฝันแล้ว:\n${dreamLine(done.removed)}`)
      return EXIT.ok
    }
    case 'dream-clear': {
      const done = await daemon.call('POST /dreams/clear')
      print(done, `ลบความฝันทั้งหมดแล้ว (${done.removed} ไฟล์)`)
      return EXIT.ok
    }
    case 'dream-status': {
      const status = await daemon.call('GET /dream')
      print(status, dreamStatusMarkdown(status))
      return EXIT.ok
    }
  }
}
