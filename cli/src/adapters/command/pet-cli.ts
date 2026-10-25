import { EXIT, type ExitCode } from '../../protocol'
import type { Command, Globals } from './argv'
import type { Daemon } from './client'
import { faceMarkdown, petMarkdown, wakeMarkdown } from './pet-render'

type PetCliCommand = Extract<Command, { name: `pet-${string}` | `name-${string}` | `face-${string}` | 'phone-wake' | 'phone-pet' }>
export const isPetCommand = (command: Command): command is PetCliCommand =>
  /^(?:pet|name|face)-/.test(command.name) || command.name === 'phone-wake' || command.name === 'phone-pet'

interface Io {
  out(text: string): void
}

export async function runPetCommand(command: PetCliCommand, daemon: Daemon, globals: Globals, io: Io): Promise<ExitCode> {
  const print = (value: unknown, markdown: string) => io.out((globals.json ? JSON.stringify(value) : markdown) + '\n')
  switch (command.name) {
    case 'pet-show': {
      const info = await daemon.call('GET /pet')
      print(info, petMarkdown(info))
      return EXIT.ok
    }
    case 'pet-feed': {
      const fed = await daemon.call('POST /pet/feed', { food: command.food })
      print(fed, `ให้ ${fed.food} แล้ว`)
      return EXIT.ok
    }
    case 'pet-sleep': {
      const done = await daemon.call('POST /pet/sleep')
      print(done, 'Neo หลับลึกแล้ว (ปิดไมค์ แตะจอมือถือเพื่อปลุก)')
      return EXIT.ok
    }
    case 'name-show': {
      const wake = await daemon.call('GET /name')
      print(wake, wakeMarkdown(wake))
      return EXIT.ok
    }
    case 'name-set': {
      const wake = await daemon.call('POST /name/set', { name: command.petName, variants: command.variants })
      print(wake, wakeMarkdown(wake))
      return EXIT.ok
    }
    case 'name-train': {
      const wake = await daemon.call('POST /name/train', { name: command.petName })
      print(wake, wakeMarkdown(wake))
      return EXIT.ok
    }
    case 'name-train-cancel': {
      const wake = await daemon.call('POST /name/train/cancel')
      print(wake, wakeMarkdown(wake))
      return EXIT.ok
    }
    case 'face-show': {
      const face = await daemon.call('GET /face')
      print(face, faceMarkdown(face))
      return EXIT.ok
    }
    case 'face-set': {
      const face = await daemon.call('POST /face', command.face)
      print(face, faceMarkdown(face))
      return EXIT.ok
    }
    case 'phone-wake': {
      const done = await daemon.call('POST /phone/wake')
      print(done, 'ปลุกแล้ว (เหมือนแตะจอมือถือ)')
      return EXIT.ok
    }
    case 'phone-pet': {
      const done = await daemon.call('POST /phone/pet', { hunger: command.hunger, affection: command.affection })
      print(done, `รายงานแล้ว: หิว ${command.hunger} · ผูกพัน ${command.affection}`)
      return EXIT.ok
    }
  }
}
