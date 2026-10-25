import type { Stt, SttDoctor, SttPermission } from './stt'

const REQUEST_TIMEOUT_MS = 30_000
const RESTART_BACKOFF_MS = 1000
/** A helper that dies sooner than this after starting is not restarted until someone needs it (no crash loop). */
const MIN_HEALTHY_UPTIME_MS = 2000

export class SttError extends Error {}

type Reply = { text?: string; error?: string; status?: string; onDevice?: boolean }

interface Child {
  proc: Bun.Subprocess<'pipe', 'pipe', 'inherit'>
  startedAt: number
}

export interface HelperSttOptions {
  /** Path of the `neo-stt` binary. */
  command: string
  timeoutMs?: number
  restartBackoffMs?: number
  /** Extra environment for the child (on top of the daemon's own). */
  env?: Record<string, string>
}

/**
 * The `neo-stt` Swift helper as a long-lived stdio child: one JSON line in, one JSON line out.
 * Started with the daemon, restarted when it dies; a request in flight when it dies fails.
 */
export function createHelperStt({ command, timeoutMs = REQUEST_TIMEOUT_MS, restartBackoffMs = RESTART_BACKOFF_MS, env }: HelperSttOptions) {
  let child: Child | null = null
  let stopped = false
  let waiter: { owner: Child; resolve(reply: Reply): void; reject(error: Error): void } | null = null
  let queue: Promise<unknown> = Promise.resolve()

  function spawn(): Child {
    let proc: Child['proc']
    try {
      proc = Bun.spawn([command], { stdin: 'pipe', stdout: 'pipe', stderr: 'inherit', env: { ...process.env, ...env } })
    } catch (e) {
      throw new SttError(`เปิด neo-stt ไม่ได้ (${command}): ${(e as Error).message}`)
    }
    const mine: Child = { proc, startedAt: Date.now() }
    void readReplies(mine)
    void proc.exited.then(() => {
      if (waiter?.owner === mine) waiter.reject(new SttError('neo-stt หยุดทำงานกลางคัน'))
      if (child !== mine) return
      child = null
      if (stopped || Date.now() - mine.startedAt < MIN_HEALTHY_UPTIME_MS) return
      setTimeout(() => {
        if (!stopped && !child) try { child = spawn() } catch (e) { console.error((e as Error).message) }
      }, restartBackoffMs)
    })
    return mine
  }

  async function readReplies(mine: Child) {
    const decoder = new TextDecoder()
    let buffer = ''
    try {
      for await (const chunk of mine.proc.stdout) {
        buffer += decoder.decode(chunk, { stream: true })
        for (let nl = buffer.indexOf('\n'); nl >= 0; nl = buffer.indexOf('\n')) {
          const line = buffer.slice(0, nl).trim()
          buffer = buffer.slice(nl + 1)
          if (!line) continue
          try { waiter?.resolve(JSON.parse(line) as Reply) } catch { waiter?.reject(new SttError('neo-stt ตอบกลับผิดรูปแบบ')) }
        }
      }
    } catch {
      // the pipe closed; `exited` handles the rest
    }
  }

  function exchange(payload: object): Promise<Reply> {
    const run = async (): Promise<Reply> => {
      if (stopped) throw new SttError('neo-stt ถูกปิดแล้ว')
      const mine = (child ??= spawn())
      return new Promise<Reply>((resolve, reject) => {
        const timer = setTimeout(() => {
          settle(() => reject(new SttError('neo-stt ไม่ตอบ (หมดเวลา)')))
          if (child === mine) child = null
          mine.proc.kill('SIGKILL')
        }, timeoutMs)
        const settle = (finish: () => void) => {
          clearTimeout(timer)
          waiter = null
          finish()
        }
        waiter = { owner: mine, resolve: reply => settle(() => resolve(reply)), reject: error => settle(() => reject(error)) }
        try {
          mine.proc.stdin.write(JSON.stringify(payload) + '\n')
          void mine.proc.stdin.flush()
        } catch (e) {
          settle(() => reject(new SttError(`ส่งให้ neo-stt ไม่ได้: ${(e as Error).message}`)))
        }
      })
    }
    const result = queue.then(run, run)
    queue = result.catch(() => {})
    return result
  }

  const permission = async (op: 'check' | 'authorize'): Promise<SttPermission> => {
    const reply = await exchange({ op })
    if (reply.error) throw new SttError(reply.error)
    return { status: reply.status ?? 'unknown', onDevice: reply.onDevice ?? false }
  }

  return {
    /** Starts the helper now; a missing binary is logged, and requests then fail with `stterr`. */
    start() {
      if (child || stopped) return
      try { child = spawn() } catch (e) { console.error((e as Error).message) }
    },
    pid: () => child?.proc.pid,
    async transcribe(wav, hints) {
      const reply = await exchange({ wav, hints })
      if (reply.error) throw new SttError(reply.error)
      return reply.text ?? ''
    },
    check: () => permission('check'),
    authorize: () => permission('authorize'),
    async stop() {
      stopped = true
      const dying = child
      child = null
      dying?.proc.kill('SIGKILL')
      await dying?.proc.exited
    },
  } satisfies Stt & SttDoctor & Record<string, unknown>
}

export type HelperStt = ReturnType<typeof createHelperStt>
