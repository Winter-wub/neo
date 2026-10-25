import { readFile } from 'node:fs/promises'
import { EXIT, type ExitCode, type ProviderConfig } from '../../protocol'
import type { Command, Globals } from './argv'
import { configMarkdown, discoveredMarkdown, modelsMarkdown, providersMarkdown } from './brain-render'
import { CommandFailed, type Daemon } from './client'
import { cardMarkdown } from './say-render'

type BrainCliCommand = Extract<Command, { name: `provider-${string}` | `model-${string}` }>
export const isBrainCommand = (command: Command): command is BrainCliCommand => command.name.startsWith('provider-') || command.name.startsWith('model-')

interface Io {
  out(text: string): void
  /** The text on stdin (`--api-key-stdin`). Default: the process's stdin. */
  stdin?(): Promise<string>
}

async function readConfigFile(file: string): Promise<ProviderConfig> {
  let text: string
  try {
    text = await readFile(file, 'utf8')
  } catch {
    throw new CommandFailed(`อ่านไฟล์ ${file} ไม่ได้`, EXIT.failed)
  }
  try {
    return JSON.parse(text)
  } catch {
    throw new CommandFailed(`${file} ไม่ใช่ JSON`, EXIT.failed)
  }
}

export async function runBrainCommand(command: BrainCliCommand, daemon: Daemon, globals: Globals, io: Io): Promise<ExitCode> {
  const print = (value: unknown, markdown: string) => io.out((globals.json ? JSON.stringify(value) : markdown) + '\n')
  switch (command.name) {
    case 'provider-list': {
      const list = await daemon.call('GET /providers')
      print(list, providersMarkdown(list))
      return EXIT.ok
    }
    case 'provider-use': {
      const result = await daemon.call('POST /providers/use', { name: command.provider })
      print(result, cardMarkdown(result.card))
      return EXIT.ok
    }
    case 'provider-discover': {
      const agents = await daemon.call('POST /providers/discover')
      print(agents, discoveredMarkdown(agents))
      return EXIT.ok
    }
    case 'provider-config': {
      const view = await daemon.call('GET /providers/config')
      if (command.provider && !view.providers[command.provider]) throw new CommandFailed(`ไม่รู้จัก provider ${command.provider} (ดู neo provider list)`, EXIT.failed)
      print(view, configMarkdown(view, command.provider))
      return EXIT.ok
    }
    case 'provider-config-set': {
      const cfg = await readConfigFile(command.file)
      let apiKey: string | undefined
      if (command.apiKeyStdin) {
        apiKey = (await (io.stdin ?? (() => Bun.stdin.text()))()).trim()
        if (!apiKey) throw new CommandFailed('ไม่ได้รับ API key จาก stdin', EXIT.failed)
      }
      const done = await daemon.call('POST /providers/config', { name: command.provider, cfg, ...(apiKey ? { apiKey } : {}) })
      print(done, `บันทึก ${command.provider} แล้ว${apiKey ? ' (เก็บ API key เป็นไฟล์ในโฟลเดอร์ของ Neo สิทธิ์ 0600)' : ''}`)
      return EXIT.ok
    }
    case 'provider-config-rm': {
      const done = await daemon.call('POST /providers/config', { name: command.provider, remove: true })
      print(done, `ลบค่าตั้ง ${command.provider} แล้ว`)
      return EXIT.ok
    }
    case 'model-list': {
      const models = await daemon.call('POST /models/list', { name: command.provider })
      print(models, modelsMarkdown(models))
      return EXIT.ok
    }
    case 'model-use': {
      const result = await daemon.call('POST /models/use', { name: command.provider, model: command.model === 'default' ? null : command.model })
      print(result, cardMarkdown(result.card))
      return EXIT.ok
    }
  }
}
