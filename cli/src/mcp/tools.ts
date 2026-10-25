// The agents MCP server's tools (ported from app/neo-agents-mcp.js). Read-only by design:
// Orca: terminal list/read and orchestration run/worker/task lists. ego browser: open a page and return its text — a fixed script, no clicks, typing or forms.
import { execFile, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const ORCA_APP_BIN = '/Applications/Orca.app/Contents/Resources/bin/orca'
const ORCA_TIMEOUT_MS = 20_000
const EGO_TIMEOUT_MS = 40_000
const MAX_BUFFER = 8 << 20
const EGO_MARK = '@@NEO@@'
const ERROR_MAX = 300
const DEFAULT_LINES = 60
const MAX_LINES = 200
const MIN_LINES = 5
const MAX_RUNS = 15
const QUERY_MAX = 200
const SEARCH_TEXT_MAX = 3000

export interface Tool {
  description: string
  schema: Record<string, unknown>
  call(args: Record<string, any>): Promise<string>
}

export interface ToolDeps {
  /** Reads `ORCA_BIN` and `EGO_BIN`; the children inherit it. */
  env: Record<string, string | undefined>
  home: string
  now(): number
}

/** The default Orca and ego-browser locations, unless `ORCA_BIN` / `EGO_BIN` say otherwise. */
export function resolveBins({ env, home }: Pick<ToolDeps, 'env' | 'home'>) {
  const egoDefault = join(home, '.local/bin/ego-browser')
  return {
    orca: env.ORCA_BIN || (existsSync(ORCA_APP_BIN) ? ORCA_APP_BIN : 'orca'),
    ego: env.EGO_BIN || (existsSync(egoDefault) ? egoDefault : 'ego-browser'),
  }
}

/** Only external web pages: never the Mac itself or the LAN, with the user's logged-in browser session. */
export function safeUrl(input: unknown) {
  let url: URL
  try { url = new URL(String(input)) } catch { throw new Error('URL ไม่ถูกต้อง') }
  if (!/^https?:$/.test(url.protocol)) throw new Error('เปิดได้เฉพาะ http/https')
  const host = url.hostname.toLowerCase()
  const local = host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal') || !host.includes('.')
    || /^\[|^(127|10|0)\.|^192\.168\.|^169\.254\.|^172\.(1[6-9]|2\d|3[01])\.|^::1$/.test(host)
  if (local) throw new Error('ไม่เปิดที่อยู่ในเครื่อง/วงแลน')
  return url.href
}

const strip = (text: string) => text.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').replace(/[─-╿]{4,}/g, '──').trimEnd()

function ago(now: number, at: unknown) {
  if (!at) return 'ไม่มีข้อมูล'
  const minutes = Math.round((now - Number(at)) / 60_000)
  return minutes < 1 ? 'เมื่อกี้' : minutes < 60 ? `${minutes} นาทีก่อน` : `${Math.round(minutes / 60)} ชม.ก่อน`
}

const run = (command: string, args: string[], env: ToolDeps['env']) =>
  new Promise<{ out: string; err: string; message?: string }>(resolve =>
    execFile(command, args, { timeout: ORCA_TIMEOUT_MS, maxBuffer: MAX_BUFFER, cwd: tmpdir(), env: env as NodeJS.ProcessEnv }, (e, out, err) =>
      resolve({ out: String(out ?? ''), err: String(err ?? ''), message: e?.message })))

async function json(command: string, args: string[], env: ToolDeps['env']) {
  const { out, err, message } = await run(command, args, env)
  try { return JSON.parse(out) } catch { throw new Error((err || out || message || 'no output').slice(0, ERROR_MAX)) }
}

interface EgoPage { title: string; url: string; links: Array<{ title: string; url: string }>; text: string }

function egoScript(url: string, withLinks: boolean) {
  return `const task = await taskSpace("neo-reader");
const page = task.page("p1");
await page.goto(${JSON.stringify(url)});
await page.waitForLoadState("domcontentloaded");
const r = await page.evaluate((withLinks) => ({
  title: document.title, url: location.href,
  links: withLinks ? [...document.querySelectorAll("a h3")].slice(0, 10).map(h => ({ title: h.innerText, url: h.closest("a").href })) : [],
  text: document.body.innerText.replace(/\\n{3,}/g, "\\n\\n").slice(0, 8000),
}), ${withLinks});
console.log("${EGO_MARK}" + JSON.stringify(r));`
}

const objectSchema = (properties: Record<string, unknown> = {}, required: string[] = []) =>
  ({ type: 'object', properties, ...(required.length ? { required } : {}) })

export function createTools(deps: ToolDeps): Record<string, Tool> {
  const bins = resolveBins(deps)
  const { env, now } = deps
  const shorten = (path: unknown) => String(path ?? '').replace(deps.home, '~')

  // one tab, one job at a time
  let egoQueue: Promise<unknown> = Promise.resolve()
  function egoRead(url: string, withLinks: boolean) {
    const job = egoQueue.then(() => new Promise<EgoPage>((resolve, reject) => {
      const child = spawn(bins.ego, ['nodejs'], { cwd: tmpdir(), env: env as NodeJS.ProcessEnv })
      let out = ''
      child.stdout.on('data', d => (out += d))
      child.stderr.on('data', d => (out += d))
      const timer = setTimeout(() => child.kill(), EGO_TIMEOUT_MS)
      child.on('error', e => { clearTimeout(timer); reject(e) })
      child.on('close', () => {
        clearTimeout(timer)
        const marked = out.match(new RegExp(`${EGO_MARK}(.*)`))
        if (!marked) return reject(new Error(out.replace(/\[ego-browser:notice\][^\n]*\n?/g, '').slice(0, ERROR_MAX) || 'ego browser ไม่ตอบ'))
        try { resolve(JSON.parse(marked[1]!)) } catch (e) { reject(e) }
      })
      child.stdin.on('error', () => {})
      child.stdin.end(egoScript(url, withLinks))
    }))
    egoQueue = job.catch(() => {})
    return job
  }

  return {
    orca_agents: {
      description: 'รายการ agent/terminal ที่เปิดใน Orca ตอนนี้: ชื่องาน (title), ชนิด agent, repo/worktree, branch, ออนไลน์ไหม, ข้อความล่าสุดเมื่อไร และตัวอย่างบรรทัดท้าย ใช้ handle กับ orca_agent_output',
      schema: objectSchema(),
      async call() {
        const data = await json(bins.orca, ['terminal', 'list', '--json'], env)
        const terminals: any[] = data.result?.terminals ?? []
        if (!terminals.length) return 'ไม่มี terminal ใน Orca'
        return terminals.map(t => [
          `handle: ${t.handle}`, `title: ${t.title || '-'}`, `agent: ${t.agentIdentity || 'shell'}`,
          `worktree: ${shorten(t.worktreePath)} (${String(t.branch ?? '').replace('refs/heads/', '')})`,
          `connected: ${t.connected}`, `last output: ${ago(now(), t.lastOutputAt)}`,
          `preview: ${strip(t.preview || '').split('\n').slice(-3).join(' / ').slice(0, 300)}`,
        ].join('\n')).join('\n\n')
      },
    },
    orca_agent_output: {
      description: 'อ่านบรรทัดท้ายของ terminal/agent ใน Orca (ดูว่าทำถึงไหน ผลเป็นอย่างไร)',
      schema: objectSchema({
        handle: { type: 'string', description: 'term_... จาก orca_agents' },
        lines: { type: 'number', description: `จำนวนบรรทัดท้าย (ค่าเริ่มต้น ${DEFAULT_LINES}, สูงสุด ${MAX_LINES})` },
      }, ['handle']),
      async call({ handle, lines }) {
        if (!/^term_[0-9a-f-]{8,}$/i.test(String(handle ?? ''))) throw new Error('handle ไม่ถูกต้อง')
        const count = Math.max(MIN_LINES, Math.min(MAX_LINES, Number(lines) || DEFAULT_LINES))
        const data = await json(bins.orca, ['terminal', 'read', '--terminal', handle, '--json'], env)
        const tail: string[] = (data.result?.terminal?.tail ?? []).map(strip).filter((l: string) => l.trim())
        return tail.slice(-count).join('\n') || '(ไม่มีข้อความ)'
      },
    },
    orca_runs: {
      description: 'งาน orchestration ใน Orca (Run): เป้าหมาย สถานะ และ worker แต่ละตัวสำเร็จ/กำลังทำ/ล้มเหลว',
      schema: objectSchema(),
      async call() {
        const [runs, workers] = await Promise.all([
          json(bins.orca, ['orchestration', 'run-list', '--json'], env),
          json(bins.orca, ['orchestration', 'worker-list', '--json'], env).catch(() => null),
        ])
        const runList: any[] = runs.result?.runs ?? []
        const workerList: any[] = workers?.result?.workers ?? []
        if (!runList.length) return 'ไม่มี Run'
        return runList.slice(0, MAX_RUNS).map(r => {
          const byState: Record<string, number> = {}
          for (const w of workerList.filter(w => w.runId === r.id)) {
            const state = w.workerState || w.dispatchStatus
            byState[state] = (byState[state] ?? 0) + 1
          }
          return `run: ${r.id}\nobjective: ${String(r.objective ?? '').slice(0, 200)}\nstatus: ${r.status || '-'}\ncreated: ${r.created_at || r.createdAt || '-'}\nworkers: ${JSON.stringify(byState)}`
        }).join('\n\n')
      },
    },
    orca_run_tasks: {
      description: 'รายการ task ของ Run หนึ่งใน Orca พร้อมสถานะ',
      schema: objectSchema({ run_id: { type: 'string' } }, ['run_id']),
      async call({ run_id }) {
        if (!/^run_[0-9a-z]+$/i.test(String(run_id ?? ''))) throw new Error('run_id ไม่ถูกต้อง')
        const data = await json(bins.orca, ['orchestration', 'task-list', '--run', run_id, '--json'], env)
        const tasks: any[] = data.result?.tasks ?? []
        return tasks.map(t => `${t.id} [${t.status}] ${String(t.title || t.spec || t.description || '').slice(0, 160)}`).join('\n') || 'ไม่มี task'
      },
    },
    browser_search: {
      description: 'ค้นหาด้วย Google ใน ego browser ของผู้ใช้ (เห็นผลแบบที่ผู้ใช้เห็น รวมเว็บที่ login ไว้) คืนรายการผลค้นหา (ชื่อ+URL) และข้อความหน้า — อ่านอย่างเดียว',
      schema: objectSchema({ query: { type: 'string' } }, ['query']),
      async call({ query }) {
        const q = String(query ?? '').trim().slice(0, QUERY_MAX)
        if (!q) throw new Error('ไม่มีคำค้น')
        const page = await egoRead('https://www.google.com/search?hl=th&q=' + encodeURIComponent(q), true)
        return `ผลค้นหา: ${page.title}\n` + page.links.map((l, i) => `${i + 1}. ${l.title} — ${l.url}`).join('\n') + `\n\nข้อความหน้า:\n${page.text.slice(0, SEARCH_TEXT_MAX)}`
      },
    },
    browser_read: {
      description: 'เปิด URL ใน ego browser ของผู้ใช้แล้วคืนข้อความในหน้า (รองรับเว็บที่ใช้ JavaScript และเว็บที่ผู้ใช้ login ไว้) — อ่านอย่างเดียว ไม่คลิก/ไม่กรอก',
      schema: objectSchema({ url: { type: 'string' } }, ['url']),
      async call({ url }) {
        const page = await egoRead(safeUrl(url), false)
        return `${page.title}\n${page.url}\n\n${page.text}`
      },
    },
  }
}
