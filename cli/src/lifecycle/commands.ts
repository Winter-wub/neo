import { EXIT, type ExitCode } from '../protocol'
import type { DaemonVerb } from '../adapters/command/argv'
import type { Lifecycle } from './lifecycle'
import { daemonStatusMarkdown } from './render'

export interface VerbIo {
  json: boolean
  out(text: string): void
  signal?: AbortSignal
}

/** `neo daemon install|start|stop|restart|status|logs|uninstall`. Throws LifecycleError for things the user can fix. */
export async function runDaemonVerb(
  lifecycle: Lifecycle,
  { verb, follow, port }: { verb: DaemonVerb; follow: boolean; port?: number },
  { json, out, signal }: VerbIo,
): Promise<ExitCode> {
  const say = (value: unknown, text: string) => out((json ? JSON.stringify(value) : text) + '\n')
  switch (verb) {
    case 'install': {
      const result = await lifecycle.install({ port })
      say({ installed: true, ...result }, [`ติดตั้งแล้ว: ${result.plist}`, `symlink: ${result.symlink}`, ...(result.pathHint ? [result.pathHint] : [])].join('\n'))
      return EXIT.ok
    }
    case 'start':
      await lifecycle.start()
      say({ running: true }, 'Neo เริ่มทำงานแล้ว')
      return EXIT.ok
    case 'restart':
      await lifecycle.restart()
      say({ running: true }, 'Neo รีสตาร์ทแล้ว')
      return EXIT.ok
    case 'stop':
      await lifecycle.stop()
      say({ running: false }, 'Neo หยุดแล้ว (เริ่มใหม่: neo daemon start หรือสั่ง neo คำสั่งไหนก็ได้)')
      return EXIT.ok
    case 'uninstall':
      await lifecycle.uninstall()
      say({ installed: false }, 'ถอด Neo daemon แล้ว (ข้อมูลใน NEO_HOME ยังอยู่)')
      return EXIT.ok
    case 'status': {
      const status = await lifecycle.status()
      say(status, daemonStatusMarkdown(status))
      return EXIT.ok
    }
    case 'logs':
      await lifecycle.logs({ out, follow, signal })
      return EXIT.ok
  }
}
