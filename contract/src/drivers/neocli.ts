import { mkdir, mkdtemp, rm, symlink } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { FakeStt } from '../fake-stt.ts'
import type { Backend, ClaudeLogEntry, Driver } from '../types.ts'
import { readFile } from 'node:fs/promises'

const root = resolve(import.meta.dir, '..', '..')
const cliDir = resolve(root, '..', 'cli')
const mainTs = join(cliDir, 'src', 'main.ts')
const fakeClaude = join(root, 'bin', 'claude')

/** CONTRACT_NEO_BIN=<path to a built neo> runs that binary; otherwise `bun run cli/src/main.ts` (no race with the cli/ build). */
const builtNeo = process.env.CONTRACT_NEO_BIN
const neoCommand = () => (builtNeo ? [builtNeo] : [process.execPath, 'run', mainTs])

const freePort = () =>
  new Promise<number>((done, fail) => {
    const probe = createServer()
    probe.once('error', fail)
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as { port: number }
      probe.close(() => done(port))
    })
  })

/**
 * Which tests wait for which ticket. First match wins; the pattern is tried against "describe > … > test".
 * A test that matches no rule must pass on NeoCli today. Kept as a list so the scoreboard shrinks as tickets land:
 * delete a rule when its ticket is done and `bun test` tells you whether the tests really pass.
 */
const PENDING: ReadonlyArray<readonly [RegExp, string]> = [
]

export const neoCli: Driver = {
  name: builtNeo ? `neocli (${builtNeo})` : 'neocli (bun run cli/src/main.ts)',
  divergences: new Set(),

  pending(fullName) {
    return PENDING.find(([pattern]) => pattern.test(fullName))?.[1]
  },

  async start(): Promise<Backend> {
    // short paths: the daemon's unix socket lives in NEO_HOME and macOS limits socket paths to ~104 bytes
    const dir = await mkdtemp(join(tmpdir(), 'nc-'))
    const [home, bin, tmp, fakeHome, claudeConfig, logs, agents, userBin] = ['h', 'bin', 'tmp', 'home', 'cc', 'logs', 'la', 'ub'].map((d) => join(dir, d))
    for (const d of [home, bin, tmp, fakeHome, claudeConfig, logs, agents, userBin]) await mkdir(d, { recursive: true })

    // PATH holds only the fake claude, node (its shebang) and bun's own directory, so nothing real (claude, ffmpeg, agents) can be reached.
    await symlink(fakeClaude, join(bin, 'claude'))
    const node = Bun.which('node')
    if (!node) throw new Error('the fake claude runs on `node`, which is not on PATH')
    await symlink(node, join(bin, 'node'))
    const claudeLog = join(dir, 'claude.log')
    await Bun.write(claudeLog, '')

    const apk = Uint8Array.from({ length: 4096 }, (_, i) => (i * 31 + 7) & 0xff)
    await Bun.write(join(dir, 'neo.apk'), apk)

    const stt = new FakeStt()
    const env = {
      NEO_APK: join(dir, 'neo.apk'),
      NEO_STT: join(cliDir, 'test', 'fake-bin', 'neo-stt-bridge'), // the neo-stt helper, answered by FakeStt
      FAKE_STT_PORT: String(stt.port),
      PATH: `${bin}:${dirname(process.execPath)}:/usr/bin:/bin`,
      HOME: fakeHome,
      TMPDIR: tmp,
      NEO_HOME: home,
      TZ: process.env.TZ ?? Intl.DateTimeFormat().resolvedOptions().timeZone, // `neo jobs --at` is local time: the suite and the daemon must agree
      NEO_LOG_DIR: logs,
      NEO_DISCOVER: '0', // discovery also searches /opt/homebrew/bin and ~/.local/bin: never probe real agents
      // never the real launchd entries: a wake-up or `daemon install` would otherwise reach com.mochi.neo
      NEO_LAUNCH_LABEL: 'com.mochi.neo.contract',
      NEO_LAUNCH_AGENTS_DIR: agents,
      NEO_BIN_DIR: userBin,
      CLAUDE_CONFIG_DIR: claudeConfig,
      FAKE_CLAUDE_LOG: claudeLog,
    }

    const port = await freePort()
    const baseUrl = `http://127.0.0.1:${port}`

    const log: string[] = []
    const daemon = Bun.spawn([...neoCommand(), 'daemon', 'run', '--home', home, '--port', String(port)], {
      cwd: cliDir,
      env,
      stdout: 'pipe',
      stderr: 'pipe',
    })
    for (const stream of [daemon.stdout, daemon.stderr]) {
      void (async () => {
        const decoder = new TextDecoder()
        for await (const chunk of stream) log.push(decoder.decode(chunk))
      })()
    }
    let exited = false
    void daemon.exited.then(() => (exited = true))

    const stop = async () => {
      if (!exited) {
        daemon.kill('SIGTERM')
        await Promise.race([daemon.exited, Bun.sleep(5000)])
        if (!exited) daemon.kill('SIGKILL')
      }
      if (process.env.CONTRACT_VERBOSE) console.log(log.join(''))
      await stt.stop()
      await rm(dir, { recursive: true, force: true })
    }

    for (let i = 0; ; i++) {
      if (exited) throw new Error('neo daemon exited at startup:\n' + log.join(''))
      try {
        if ((await fetch(baseUrl + '/api/hello')).ok) break
      } catch {}
      if (i > 300) {
        await stop()
        throw new Error('neo daemon never became ready:\n' + log.join(''))
      }
      await Bun.sleep(100)
    }

    /** The `neo` command line, as a person at the Mac would run it. */
    const neo = async (...args: string[]) => {
      const run = Bun.spawn([...neoCommand(), ...args, '--home', home], { cwd: cliDir, env, stdout: 'pipe', stderr: 'pipe' })
      const [stdout, stderr, code] = await Promise.all([new Response(run.stdout).text(), new Response(run.stderr).text(), run.exited])
      if (code !== 0) throw new Error(`neo ${args.join(' ')} exited ${code}: ${stderr}${stdout}`)
      return stdout
    }

    return {
      baseUrl,
      home,
      // NeoCli demands the device token on every route but hello/pair/apk, from anywhere: no forwarded-for trick needed.
      phoneHeaders: {},
      stt,
      apk,

      async getPairingCode() {
        return (JSON.parse(await neo('devices', 'pair', '--json')) as { code: string }).code
      },

      async say(text) {
        await neo('say', text)
      },

      async ringAlarm() {
        const pad = (n: number) => String(n).padStart(2, '0')
        const d = new Date(Date.now() + 3600e3)
        const at = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
        const job = JSON.parse(await neo('jobs', 'add', '--kind', 'alarm', '--title', 'ทดสอบปลุก', '--at', at, '--json')) as { id: string; title: string }
        await neo('jobs', 'test', job.id)
        return { id: job.id, title: job.title }
      },

      async makeDream() {
        // `neo dream now` returns when the dream (the fake claude) is over and its card is waiting for the phone
        await neo('dream', 'now')
      },

      async claudeLog() {
        const text = await readFile(claudeLog, 'utf8')
        return text.split('\n').filter(Boolean).map((l) => JSON.parse(l) as ClaudeLogEntry)
      },

      stop,
    }
  },
}
