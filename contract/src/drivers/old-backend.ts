import { spawn, type ChildProcess } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { FakeStt } from '../fake-stt.ts'
import type { Backend, ClaudeLogEntry, Divergence, Driver } from '../types.ts'

const root = resolve(import.meta.dir, '..', '..')
const serverJs = resolve(root, '..', 'app', 'server.js')
const fakeClaude = join(root, 'bin', 'claude')
const preload = join(root, 'src', 'old-preload.cjs')
const APP_TOKEN = 'contract-app-token'

const freePort = () =>
  new Promise<number>((done, fail) => {
    const probe = createServer()
    probe.once('error', fail)
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as { port: number }
      probe.close(() => done(port))
    })
  })

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Everything the old backend still does differently from the amended contract (spec §4.1). */
const divergences = new Set<Divergence>(['localhost-needs-token', 'phone-port-only-neoapp-routes', 'ping-token-escaped', 'stt-failure-is-stterr'])

export const oldBackend: Driver = {
  name: 'old-node-backend',
  divergences,

  async start(): Promise<Backend> {
    const node = Bun.which('node')
    if (!node) throw new Error('the old backend needs `node` on PATH')

    const dir = await mkdtemp(join(tmpdir(), 'neo-contract-'))
    const [home, bin, tmp, fakeHome, claudeConfig, tasks] = ['neo-home', 'bin', 'tmp', 'home', 'claude-config', 'tasks'].map((d) => join(dir, d))
    for (const d of [home, bin, tmp, fakeHome, claudeConfig, tasks]) await mkdir(d, { recursive: true })

    // PATH holds only our fake claude and node, so nothing real (claude, ffmpeg, whisper, ACP agents) can be reached.
    await symlink(fakeClaude, join(bin, 'claude'))
    await symlink(node, join(bin, 'node'))
    const apk = Uint8Array.from({ length: 4096 }, (_, i) => (i * 31 + 7) & 0xff)
    await writeFile(join(dir, 'neo.apk'), apk)
    await writeFile(join(dir, 'providers.json'), JSON.stringify({ default: 'claude', providers: {} }))
    const claudeLog = join(dir, 'claude.log')
    await writeFile(claudeLog, '')

    const stt = new FakeStt()
    const port = await freePort()
    const baseUrl = `http://127.0.0.1:${port}`
    const serverLog: string[] = []

    const child: ChildProcess = spawn(node, [serverJs], {
      cwd: dirname(serverJs),
      env: {
        PATH: `${bin}:/usr/bin:/bin`,
        HOME: fakeHome,
        TMPDIR: tmp,
        CLAUDE_CONFIG_DIR: claudeConfig,
        PORT: String(port),
        NEO_HOME: home,
        NEO_PROVIDERS: join(dir, 'providers.json'),
        NEO_TASKS: tasks,
        NEO_APK: join(dir, 'neo.apk'),
        NEO_APP_TOKEN: APP_TOKEN,
        NEO_PROVIDER: 'claude',
        FAKE_CLAUDE_LOG: claudeLog,
        CONTRACT_STT_PORT: String(stt.port),
        NODE_OPTIONS: `--require ${preload}`,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    child.stdout?.on('data', (d) => serverLog.push(String(d)))
    child.stderr?.on('data', (d) => serverLog.push(String(d)))
    let exited = false
    child.once('exit', () => (exited = true))

    const appCall = (path: string, body: unknown = {}) =>
      fetch(baseUrl + path, { method: 'POST', headers: { 'x-neo-token': APP_TOKEN }, body: JSON.stringify(body) })

    const stop = async () => {
      if (!exited) {
        child.kill('SIGTERM')
        for (let i = 0; i < 50 && !exited; i++) await sleep(100)
        if (!exited) child.kill('SIGKILL')
      }
      if (process.env.CONTRACT_VERBOSE) console.log(serverLog.join(''))
      await stt.stop()
      await rm(dir, { recursive: true, force: true })
    }

    for (let i = 0; ; i++) {
      if (exited) throw new Error('old backend exited at startup:\n' + serverLog.join(''))
      try {
        if ((await fetch(baseUrl + '/api/hello')).ok) break
      } catch {}
      if (i > 150) {
        await stop()
        throw new Error('old backend never became ready:\n' + serverLog.join(''))
      }
      await sleep(100)
    }

    return {
      baseUrl,
      home,
      apk,
      stt,
      // Requests that look proxied are "remote" to the old backend, so the device token is really checked
      // (a bare localhost request would skip it). NeoApp over Tailscale looks like this.
      phoneHeaders: { 'x-forwarded-for': '203.0.113.7' },

      async getPairingCode() {
        const res = await appCall('/api/pair/start')
        return (await res.json()).code as string
      },

      async ringAlarm() {
        const add = await appCall('/api/schedule', { add: { kind: 'alarm', title: 'ทดสอบปลุก', enabled: true, at: Date.now() + 3600e3 } })
        const job = (await add.json()) as { id: string; title: string }
        const fire = await appCall('/api/schedule', { test: job.id })
        if (!fire.ok) throw new Error('could not fire the alarm: ' + (await fire.text()))
        return { id: job.id, title: job.title }
      },

      async makeDream() {
        const before = await (await fetch(baseUrl + '/api/dream', { headers: { 'x-neo-token': APP_TOKEN } })).json()
        await appCall('/api/dream', { now: true })
        for (let i = 0; i < 100; i++) {
          const now = await (await fetch(baseUrl + '/api/dream', { headers: { 'x-neo-token': APP_TOKEN } })).json()
          if (!now.running && now.dreams.length > before.dreams.length) return
          await sleep(100)
        }
        throw new Error('the dream never finished:\n' + serverLog.join(''))
      },

      async claudeLog() {
        const text = await readFile(claudeLog, 'utf8')
        return text.split('\n').filter(Boolean).map((l) => JSON.parse(l) as ClaudeLogEntry)
      },

      stop,
    }
  },
}
