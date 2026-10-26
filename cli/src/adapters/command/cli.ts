import { join } from 'node:path'
import { EXIT, type ErrorBody, type ExitCode } from '../../protocol'
import { DEFAULT_PORT, UsageError, USAGE, parseArgs, type Command, type Globals } from './argv'
import { CommandFailed, DaemonDown, DaemonIncompatible, connect } from './client'
import { LifecycleError, type Lifecycle } from '../../lifecycle/lifecycle'
import { runDaemonVerb } from '../../lifecycle/commands'
import { SOCKET_NAME } from './server'
import { devicesMarkdown, pairMarkdown } from '../phone/devices-render'
import { eventLine, settingsMarkdown, statusMarkdown } from './render'
import { isBrainCommand, runBrainCommand } from './brain-cli'
import { isJobsCommand, runJobsCommand } from './jobs-cli'
import { isDreamCommand, runDreamCommand } from './dream-cli'
import { isMemoryCommand, runMemoryCommand } from './memory-cli'
import { isAnimationCommand, runAnimationCommand } from './animation-cli'
import { isPetCommand, runPetCommand } from './pet-cli'
import { NOT_ADDRESSED, sayMarkdown } from './say-render'
import { isSpeechCommand, runSpeechCommand } from './speech-cli'

export interface Io {
  out(text: string): void
  err(text: string): void
  env: Record<string, string | undefined>
  /** Aborting ends `neo events` cleanly (Ctrl-C). */
  signal?: AbortSignal
  /** `neo daemon run`: owned by main.ts so the client path never imports the server. */
  runDaemon?(options: { home: string; port: number }): Promise<ExitCode>
  /** launchd lifecycle for `neo daemon …` and the wake-up before every daemon-bound command. */
  lifecycle?(home: string): Lifecycle
  /** Yes/no on the terminal (`neo jobs add`). Absent when stdin is not a terminal: the answer is yes. */
  confirm?(question: string): Promise<boolean>
  /** The text on stdin, for `neo provider config set --api-key-stdin`. Default: the process's stdin. */
  stdin?(): Promise<string>
}

export function resolveHome(globals: Globals, env: Io['env']) {
  return globals.home ?? env.NEO_HOME ?? `${env.HOME ?? ''}/Library/Application Support/Neo`
}

/** Runs one neo command line and returns its exit code. */
export async function runCli(argv: readonly string[], io: Io): Promise<ExitCode> {
  let globals: Globals = { json: argv.includes('--json'), quiet: argv.includes('-q') || argv.includes('--quiet') }
  const fail = (message: string, code: ExitCode): ExitCode => {
    if (!globals.quiet) io.err(message + '\n')
    if (globals.json) io.out(JSON.stringify({ error: message, code } satisfies ErrorBody) + '\n')
    return code
  }
  try {
    const parsed = parseArgs(argv)
    globals = parsed.globals
    return await dispatch(parsed.command, globals, io)
  } catch (e) {
    if (e instanceof UsageError) return fail(`${e.message}\nดู: neo --help`, EXIT.usage)
    if (e instanceof LifecycleError) return fail(e.message, EXIT.failed)
    if (e instanceof DaemonDown) return fail(e.message, EXIT.daemonDown)
    if (e instanceof DaemonIncompatible) return fail(e.message, EXIT.failed)
    if (e instanceof CommandFailed) return fail(e.message, EXIT.failed)
    throw e
  }
}

async function dispatch(command: Command, globals: Globals, io: Io): Promise<ExitCode> {
  const print = (value: unknown, markdown: string) => io.out((globals.json ? JSON.stringify(value) : markdown) + '\n')
  if (command.name === 'help') {
    io.out(USAGE + '\n')
    return EXIT.ok
  }
  const home = resolveHome(globals, io.env)
  if (command.name === 'daemon-run') {
    if (!io.runDaemon) throw new Error('runDaemon missing')
    return io.runDaemon({ home, port: command.port ?? DEFAULT_PORT })
  }
  if (command.name === 'daemon') {
    if (!io.lifecycle) throw new Error('lifecycle missing')
    return runDaemonVerb(io.lifecycle(home), command, { json: globals.json, out: io.out, signal: io.signal })
  }
  if ((await io.lifecycle?.(home).wake()) === 'not-installed') {
    throw new DaemonDown(`Neo ไม่ได้ทำงานอยู่ (ไม่พบ ${join(home, SOCKET_NAME)})\nเริ่มด้วย: neo daemon install (หรือ neo daemon run)`)
  }
  const daemon = connect(home)
  if (isBrainCommand(command)) return runBrainCommand(command, daemon, globals, io)
  if (isJobsCommand(command)) return runJobsCommand(command, daemon, globals, io)
  if (isMemoryCommand(command)) return runMemoryCommand(command, daemon, globals, io)
  if (isDreamCommand(command)) return runDreamCommand(command, daemon, globals, io)
  if (isAnimationCommand(command)) return runAnimationCommand(command, daemon, globals, io)
  if (isPetCommand(command)) return runPetCommand(command, daemon, globals, io)
  if (isSpeechCommand(command)) return runSpeechCommand(command, daemon, globals, io)
  switch (command.name) {
    case 'status': {
      const status = await daemon.call('GET /status')
      print(status, statusMarkdown(status))
      return EXIT.ok
    }
    case 'settings': {
      const settings = await daemon.call('GET /settings')
      print(settings, settingsMarkdown(settings))
      return EXIT.ok
    }
    case 'settings-set': {
      const settings = await daemon.call('POST /settings/set', { name: command.key, args: command.args })
      print(settings, settingsMarkdown(settings))
      return EXIT.ok
    }
    case 'devices-pair': {
      const pairing = await daemon.call('POST /devices/pair')
      print(pairing, pairMarkdown(pairing))
      return EXIT.ok
    }
    case 'devices-list': {
      const devices = await daemon.call('GET /devices')
      print(devices, devicesMarkdown(devices))
      return EXIT.ok
    }
    case 'devices-revoke': {
      const done = await daemon.call('POST /devices/revoke', { id: command.id })
      print(done, `ยกเลิกการจับคู่ ${command.id} แล้ว`)
      return EXIT.ok
    }
    case 'say': {
      const result = await daemon.call('POST /say', { text: command.text, wait: command.wait })
      if (result.outcome === 'error') throw new CommandFailed(`Neo ตอบไม่ได้: ${result.error}`, EXIT.failed)
      if (result.outcome === 'cancelled') throw new CommandFailed('ยกเลิกแล้ว', EXIT.failed)
      if (result.outcome === 'heard' && !result.armed) throw new CommandFailed(NOT_ADDRESSED, EXIT.failed)
      print(result, sayMarkdown(result))
      return EXIT.ok
    }
    case 'cancel': {
      const result = await daemon.call('POST /cancel')
      print(result, result.cancelled ? 'ยกเลิกแล้ว' : 'ไม่มีงานที่ทำอยู่')
      return EXIT.ok
    }
    case 'events': {
      for await (const line of daemon.events({ history: command.history, signal: io.signal })) {
        if (line.type === 'ping' || line.type === 'hello') continue
        io.out((globals.json ? JSON.stringify(line) : eventLine(line)) + '\n')
      }
      if (io.signal?.aborted) return EXIT.ok
      throw new DaemonDown('Neo หยุดทำงานระหว่างดูเหตุการณ์')
    }
  }
}
