import { lstat, mkdir, readFile, readlink, rm, stat, symlink, unlink, writeFile, open } from 'node:fs/promises'
import { join } from 'node:path'
import { DaemonDown, connect } from '../adapters/command/client'
import type { Launchctl } from './launchctl'
import { plistBinary, plistHome, renderPlist } from './plist'

/** Something the user can fix; the neo command prints it and exits 1. */
export class LifecycleError extends Error {}

export const DEFAULT_LABEL = 'com.mochi.neo'
export const DAEMON_LOG = 'daemon.log'
export const CRASH_LOG = 'daemon.crash.log'
/** How long a neo command waits for a kickstarted daemon to open its socket. */
export const WAKE_TIMEOUT_MS = 5000
const WAIT_STEP_MS = 50
const DEFAULT_TAIL_LINES = 100
const DEFAULT_FOLLOW_POLL_MS = 250

export interface LifecycleConfig {
  label: string
  uid: number
  /** NEO_HOME: where `neo.sock` lives. */
  home: string
  /** ~/Library/LaunchAgents */
  plistDir: string
  /** ~/.local/bin */
  binDir: string
  /** ~/Library/Logs/Neo */
  logDir: string
  /** The bundled binary launchd execs and the symlink points at. */
  binary: string
  launchctl: Launchctl
  /** The login PATH, to decide whether the PATH hint is needed. */
  pathEnv: string
  sleep(ms: number): Promise<void>
}

export interface PlistStatus {
  path: string
  binary: string | null
  current: boolean
}
export interface SymlinkStatus {
  path: string
  target: string | null
  current: boolean
}

/** `neo daemon status --json` */
export interface DaemonStatus {
  label: string
  installed: boolean
  loaded: boolean
  running: boolean
  pid: number | null
  version: string | null
  build: string | null
  protocol: number | null
  binary: string
  plist: PlistStatus
  symlink: SymlinkStatus
  home: string
  logs: { daemon: string; crash: string }
}

export interface InstallResult {
  plist: string
  symlink: string
  /** Set when `binDir` isn't on PATH: the line to add to ~/.zprofile. */
  pathHint?: string
}

export interface LogsOptions {
  out(text: string): void
  lines?: number
  follow?: boolean
  pollMs?: number
  signal?: AbortSignal
}

export type WakeResult = 'up' | 'woken' | 'not-installed' | 'failed'

const exists = (path: string) => lstat(path).then(() => true, () => false)

export class Lifecycle {
  constructor(readonly config: LifecycleConfig) {}

  get #domain() {
    return `gui/${this.config.uid}`
  }
  get #target() {
    return `${this.#domain}/${this.config.label}`
  }
  get plistPath() {
    return join(this.config.plistDir, `${this.config.label}.plist`)
  }
  get symlinkPath() {
    return join(this.config.binDir, 'neo')
  }
  get daemonLog() {
    return join(this.config.logDir, DAEMON_LOG)
  }
  get crashLog() {
    return join(this.config.logDir, CRASH_LOG)
  }

  #expectedPlist(port?: number) {
    const { binary, home, logDir, label } = this.config
    return renderPlist({
      label,
      programArguments: [binary, 'daemon', 'run', '--home', home, ...(port === undefined ? [] : ['--port', String(port)])],
      environment: { NEO_LAUNCHD: '1', NEO_LOG_DIR: logDir },
      crashLog: this.crashLog,
    })
  }

  // ---- verbs ----

  /** Writes or repairs the plist and the symlink, and (re)loads the job when needed. */
  async install({ port }: { port?: number } = {}): Promise<InstallResult> {
    const { plistDir, binDir, logDir } = this.config
    await Promise.all([mkdir(plistDir, { recursive: true }), mkdir(binDir, { recursive: true }), mkdir(logDir, { recursive: true })])
    await this.#linkBinary()

    const xml = this.#expectedPlist(port)
    const unchanged = (await readFile(this.plistPath, 'utf8').catch(() => null)) === xml
    const loaded = await this.#isLoaded()
    if (!unchanged || !loaded) {
      if (loaded) await this.config.launchctl(['bootout', this.#target])
      await writeFile(this.plistPath, xml)
      await this.#launchctl(['bootstrap', this.#domain, this.plistPath], 'bootstrap')
    }
    const onPath = this.config.pathEnv.split(':').includes(binDir)
    return {
      plist: this.plistPath,
      symlink: this.symlinkPath,
      ...(onPath ? {} : { pathHint: `ใส่บรรทัดนี้ใน ~/.zprofile เพื่อเรียก neo ได้ทุกที่: export PATH="${binDir}:$PATH"` }),
    }
  }

  async start() {
    await this.#requireInstalled()
    if (!(await this.#isLoaded())) await this.#launchctl(['bootstrap', this.#domain, this.plistPath], 'bootstrap')
    await this.#launchctl(['kickstart', this.#target], 'kickstart')
    await this.#requireUp()
  }

  async restart() {
    await this.#requireInstalled()
    if (!(await this.#isLoaded())) await this.#launchctl(['bootstrap', this.#domain, this.plistPath], 'bootstrap')
    await this.#launchctl(['kickstart', '-k', this.#target], 'kickstart -k')
    await this.#requireUp()
  }

  /** SIGTERM = a clean exit, so KeepAlive{SuccessfulExit:false} leaves it down until `start` or a wake-up. */
  async stop() {
    await this.#requireInstalled()
    if (await this.#isLoaded()) await this.config.launchctl(['kill', 'SIGTERM', this.#target])
    if (!(await this.#waitFor(false))) throw new LifecycleError('Neo ยังไม่หยุดภายใน 5 วินาที')
  }

  async uninstall() {
    if (await this.#isLoaded()) await this.config.launchctl(['bootout', this.#target])
    await rm(this.plistPath, { force: true })
    if ((await this.#symlinkStatus()).current) await unlink(this.symlinkPath)
  }

  async status(): Promise<DaemonStatus> {
    const { binary, home, label } = this.config
    const xml = await readFile(this.plistPath, 'utf8').catch(() => null)
    const plistTarget = xml === null ? null : (plistBinary(xml) ?? null)
    const symlinkStatus = await this.#symlinkStatus()
    const daemon = connect(home)
    const info = await daemon.call('GET /daemon/info').catch(() => null)
    const live = info ? await daemon.call('GET /status').catch(() => null) : null
    const launchdPid = await this.#launchdPid()
    return {
      label,
      installed: xml !== null,
      loaded: await this.#isLoaded(),
      running: info !== null,
      pid: live?.pid ?? launchdPid,
      version: info?.version ?? null,
      build: info?.build ?? null,
      protocol: info?.protocol ?? null,
      binary,
      plist: { path: this.plistPath, binary: plistTarget, current: plistTarget === binary },
      symlink: symlinkStatus,
      home,
      logs: { daemon: this.daemonLog, crash: this.crashLog },
    }
  }

  /** Prints the tail of daemon.log; with `follow`, keeps going (across rotations) until aborted. */
  async logs({ out, lines = DEFAULT_TAIL_LINES, follow = false, pollMs = DEFAULT_FOLLOW_POLL_MS, signal }: LogsOptions) {
    const file = this.daemonLog
    const text = await readFile(file, 'utf8').catch(() => null)
    if (text === null) throw new LifecycleError(`ยังไม่มี log (${file})`)
    out(text.split('\n').slice(-lines - 1).join('\n').replace(/^\n/, ''))
    if (!follow) return
    let offset = Buffer.byteLength(text)
    while (!signal?.aborted) {
      await Bun.sleep(pollMs)
      const size = await stat(file).then(s => s.size, () => offset)
      if (size < offset) offset = 0
      if (size === offset) continue
      const handle = await open(file, 'r')
      try {
        const chunk = Buffer.alloc(size - offset)
        await handle.read(chunk, 0, chunk.length, offset)
        out(chunk.toString('utf8'))
      } finally {
        await handle.close()
      }
      offset = size
    }
  }

  // ---- the neo command's wake-up ----

  async isUp() {
    try {
      await connect(this.config.home).call('GET /daemon/info')
      return true
    } catch (e) {
      // an incompatible daemon is still a running daemon: the client reports the mismatch itself
      return !(e instanceof DaemonDown)
    }
  }

  /** If the daemon is down but installed, asks launchd to start it and waits up to 5 s for the socket. */
  async wake(): Promise<WakeResult> {
    if (await this.isUp()) return 'up'
    const xml = await readFile(this.plistPath, 'utf8').catch(() => null)
    if (xml === null || plistHome(xml) !== this.config.home) return 'not-installed'
    try {
      if (!(await this.#isLoaded())) await this.#launchctl(['bootstrap', this.#domain, this.plistPath], 'bootstrap')
      await this.#launchctl(['kickstart', this.#target], 'kickstart')
    } catch {
      return 'failed'
    }
    return (await this.#waitFor(true, WAKE_TIMEOUT_MS)) ? 'woken' : 'failed'
  }

  // ---- internals ----

  async #waitFor(up: boolean, timeoutMs = WAKE_TIMEOUT_MS) {
    for (let waited = 0; ; waited += WAIT_STEP_MS) {
      if ((await this.isUp()) === up) return true
      if (waited >= timeoutMs) return false
      await this.config.sleep(WAIT_STEP_MS)
    }
  }

  async #requireUp() {
    if (!(await this.#waitFor(true))) {
      throw new LifecycleError(`Neo ยังไม่ขึ้นภายใน 5 วินาที ดู: neo daemon logs (หรือ ${this.crashLog})`)
    }
  }

  async #requireInstalled() {
    if (!(await exists(this.plistPath))) throw new LifecycleError('ยังไม่ได้ติดตั้ง Neo daemon ให้รัน: neo daemon install')
  }

  async #isLoaded() {
    return (await this.config.launchctl(['print', this.#target])).code === 0
  }

  async #launchdPid() {
    const { code, stdout } = await this.config.launchctl(['print', this.#target])
    const match = code === 0 ? /^\s*pid = (\d+)/m.exec(stdout) : null
    return match ? Number(match[1]) : null
  }

  async #launchctl(args: string[], what: string) {
    const result = await this.config.launchctl(args)
    if (result.code !== 0) throw new LifecycleError(`launchctl ${what} ไม่สำเร็จ (${result.code}): ${result.stderr.trim()}`)
  }

  async #symlinkStatus(): Promise<SymlinkStatus> {
    const target = await readlink(this.symlinkPath).catch(() => null)
    return { path: this.symlinkPath, target, current: target === this.config.binary }
  }

  async #linkBinary() {
    const path = this.symlinkPath
    const info = await lstat(path).catch(() => null)
    if (info && !info.isSymbolicLink()) throw new LifecycleError(`${path} มีไฟล์อื่นอยู่แล้ว ไม่ได้ทับให้`)
    if (info) await unlink(path)
    await symlink(this.config.binary, path)
  }
}
