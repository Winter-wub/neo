import { readFile } from 'node:fs/promises'
import { EXIT, type ExitCode } from '../../protocol'
import type { Command, Globals } from './argv'
import { CommandFailed, type Daemon } from './client'
import { NOT_ADDRESSED, sayMarkdown } from './say-render'
import { audioFailure, doctorMarkdown } from './speech-render'

type SpeechCommand = Extract<Command, { name: 'phone-audio' | 'doctor' }>
export const isSpeechCommand = (command: Command): command is SpeechCommand => command.name === 'phone-audio' || command.name === 'doctor'

interface Io {
  out(text: string): void
}

async function readInput(file: string) {
  if (file === '-') return new Uint8Array(await Bun.stdin.arrayBuffer())
  try {
    return new Uint8Array(await readFile(file))
  } catch {
    throw new CommandFailed(`อ่านไฟล์ ${file} ไม่ได้`, EXIT.failed)
  }
}

export async function runSpeechCommand(command: SpeechCommand, daemon: Daemon, globals: Globals, io: Io): Promise<ExitCode> {
  const print = (value: unknown, markdown: string) => io.out((globals.json ? JSON.stringify(value) : markdown) + '\n')
  if (command.name === 'doctor') {
    if (command.fix === undefined) {
      const rows = await daemon.call('GET /doctor')
      print(rows, doctorMarkdown(rows))
      return EXIT.ok
    }
    const row = await daemon.call('POST /doctor/fix', { id: command.fix })
    print(row, doctorMarkdown([row]))
    return row.ok ? EXIT.ok : EXIT.failed
  }
  const result = await daemon.upload('POST /phone/audio', await readInput(command.file))
  const failure = audioFailure(result)
  if (failure) throw new CommandFailed(failure, EXIT.failed)
  const { outcome } = result
  if (outcome.outcome === 'heard' && !outcome.armed) throw new CommandFailed(NOT_ADDRESSED, EXIT.failed)
  if (outcome.outcome !== 'card' && outcome.outcome !== 'heard' && outcome.outcome !== 'accepted') throw new CommandFailed(`ผลที่ไม่คาดคิด: ${outcome.outcome}`, EXIT.failed)
  print(result, sayMarkdown(outcome))
  return EXIT.ok
}
