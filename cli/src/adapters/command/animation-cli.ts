import { EXIT, type ExitCode } from '../../protocol'
import { animationLine, animationListMarkdown, animationMarkdown } from './animation-render'
import type { Command, Globals } from './argv'
import type { Daemon } from './client'

type AnimationCliCommand = Extract<Command, { name: `animation-${string}` }>
export const isAnimationCommand = (command: Command): command is AnimationCliCommand => command.name.startsWith('animation-')

interface Io {
  out(text: string): void
}

export async function runAnimationCommand(command: AnimationCliCommand, daemon: Daemon, globals: Globals, io: Io): Promise<ExitCode> {
  const print = (value: unknown, markdown: string) => io.out((globals.json ? JSON.stringify(value) : markdown) + '\n')
  switch (command.name) {
    case 'animation-list': {
      const list = await daemon.call('GET /animations')
      print(list, animationListMarkdown(list))
      return EXIT.ok
    }
    case 'animation-show': {
      const animation = await daemon.call('POST /animations/show', { tool: command.tool })
      print(animation, animationMarkdown(animation))
      return EXIT.ok
    }
    case 'animation-redo': {
      const done = await daemon.call('POST /animations/redo', { tool: command.tool })
      print(done, `สั่งวาดท่าใหม่ให้ ${done.tool} แล้ว (วาดเบื้องหลัง ดูผลด้วย neo animation list หรือ neo events)`)
      return EXIT.ok
    }
    case 'animation-rm': {
      const done = await daemon.call('POST /animations/rm', { tool: command.tool })
      print(done, `ลบแอนิเมชันแล้ว:\n${animationLine(done.removed)}`)
      return EXIT.ok
    }
  }
}
