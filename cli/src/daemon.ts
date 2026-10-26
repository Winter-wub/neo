import { dirname, join } from 'node:path'
import { startCommandServer, DaemonStartError } from './adapters/command/server'
import { startPhoneServer } from './adapters/phone/server'
import { createCore } from './core/core'
import { realDiscovery } from './core/brain/hub'
import { systemClock } from './core/clock'
import { teeConsoleToLog } from './lifecycle/daemon-log'
import { logDirFromEnv } from './lifecycle/env'
import { applyLoginPath, readLoginPath } from './lifecycle/login-path'
import { migrateHome, summarize } from './migrate/migrate'
import { PING_INTERVAL_MS, EXIT, type ExitCode } from './protocol'

/** `neo daemon run`: stays alive until SIGINT/SIGTERM. */
export async function runDaemon({ home, port, build }: { home: string; port: number; build: string }): Promise<ExitCode> {
  // under launchd (NEO_LAUNCHD=1) stderr is daemon.crash.log and the daemon's own log is daemon.log; run by hand, both
  const log = teeConsoleToLog({ logDir: logDirFromEnv(process.env), clock: systemClock, passThrough: !process.env.NEO_LAUNCHD, stderr: t => void process.stderr.write(t) })
  // signals count from the first moment: a stop during startup must not wait for the start to finish
  const stopping = new Promise<'stop'>(resolve => {
    for (const sig of ['SIGINT', 'SIGTERM'] as const) process.once(sig, () => resolve('stop'))
  })
  // what has started so far, newest last; stopped in reverse
  const stoppers: Array<() => Promise<unknown>> = []
  const stopAll = async () => {
    for (const stopOne of stoppers.splice(0).reverse()) await stopOne()
  }
  const start = async () => {
    // launchd starts us with a bare PATH: take the one the user's shell has, at every start, so claude and the agents are found.
    // Run by hand (or by a test) the caller's PATH is kept: a login PATH would put the real claude ahead of a test's fake one.
    if (process.env.NEO_LAUNCHD || process.env.NEO_LOGIN_SHELL) applyLoginPath(process.env, await readLoginPath())
    // an old NEO_HOME is converted once, before anything opens its files; a failure stops the start rather than run on half-converted data
    try {
      const migrated = await migrateHome({ home })
      if (migrated.ran) console.error(summarize(migrated))
    } catch (e) {
      throw new DaemonStartError(`แปลงข้อมูล Neo รุ่นเก่าไม่สำเร็จ (ไฟล์เดิมยังอยู่ครบ): ${(e as Error).message}`)
    }
    const core = await createCore({ home, clock: systemClock, pid: process.pid, discover: process.env.NEO_DISCOVER === '0' ? undefined : realDiscovery(process.env) })
    stoppers.push(() => core.stop())
    const server = await startCommandServer({ core, clock: systemClock, home, build, pingMs: Number(process.env.NEO_PING_MS) || PING_INTERVAL_MS })
    stoppers.push(() => server.stop())
    let phone: Awaited<ReturnType<typeof startPhoneServer>>
    try {
      // the bundled neo.apk sits in Neo Console.app/Contents/Resources, next to MacOS/neo
      phone = await startPhoneServer({ core, clock: systemClock, port, apkPath: process.env.NEO_APK ?? join(dirname(process.execPath), '..', 'Resources', 'neo.apk'), pingMs: Number(process.env.NEO_PING_MS) || PING_INTERVAL_MS })
    } catch (e) {
      await stopAll()
      throw new DaemonStartError(`เปิด port ${port} ไม่ได้: ${(e as Error).message}`)
    }
    stoppers.push(() => phone.stop())
    core.jobs.start({ watch: true })
    console.error(`Neo daemon พร้อมแล้ว: ${server.path} · มือถือ port ${phone.port}`)
  }
  try {
    const starting = start()
    const first = await Promise.race([starting.then(() => 'ready' as const), stopping])
    if (first === 'ready') await stopping
    // stopped mid-start: stop what is up and return now; the start's remaining steps die with the process
    else starting.catch(() => {})
    await stopAll()
    return EXIT.ok
  } catch (e) {
    if (e instanceof DaemonStartError) {
      console.error(e.message)
      return EXIT.failed
    }
    throw e
  } finally {
    await log.flush()
  }
}
