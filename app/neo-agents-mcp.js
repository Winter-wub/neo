#!/usr/bin/env node
// MCP server (stdio) ให้ Claude ของ Neo ดูสถานะ agent — อ่านอย่างเดียวทั้งหมด
// Orca: terminal list/read, orchestration run-list/worker-list/task-list  (ผู้ใช้เลือก "ดูสถานะอย่างเดียว")
// ego browser (ใช้ session ที่ผู้ใช้ login ไว้): ค้นหา/เปิดหน้าแล้วดึงข้อความเท่านั้น — สคริปต์ตายตัว ไม่มีคลิก/พิมพ์/กรอกฟอร์ม
'use strict';
const { execFile } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');

const ORCA = process.env.ORCA_BIN || (fs.existsSync('/Applications/Orca.app/Contents/Resources/bin/orca') ? '/Applications/Orca.app/Contents/Resources/bin/orca' : 'orca');

function run(cmd, args) {
  return new Promise(res => execFile(cmd, args, { timeout: 20000, maxBuffer: 8 << 20, cwd: os.tmpdir() }, (e, out, err) => res({ e, out: String(out || ''), err: String(err || '') })));
}
async function json(cmd, args) {
  const r = await run(cmd, args);
  try { return JSON.parse(r.out); } catch { throw new Error((r.err || r.out || (r.e && r.e.message) || 'no output').slice(0, 300)); }
}
const EGO = process.env.EGO_BIN || (fs.existsSync(path.join(os.homedir(), '.local/bin/ego-browser')) ? path.join(os.homedir(), '.local/bin/ego-browser') : 'ego-browser');

// เปิดได้เฉพาะเว็บภายนอก (กันยิงเข้า server ในเครื่อง/วงแลน ด้วย session ของผู้ใช้)
function safeUrl(u) {
  let x; try { x = new URL(String(u)); } catch { throw new Error('URL ไม่ถูกต้อง'); }
  if (!/^https?:$/.test(x.protocol)) throw new Error('เปิดได้เฉพาะ http/https');
  const h = x.hostname.toLowerCase();
  if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal') || /^\[|^(127|10|0)\.|^192\.168\.|^169\.254\.|^172\.(1[6-9]|2\d|3[01])\.|^::1$/.test(h) || !h.includes('.')) throw new Error('ไม่เปิดที่อยู่ในเครื่อง/วงแลน');
  return x.href;
}
let egoQueue = Promise.resolve(); // ใช้แท็บเดียว ทีละงาน
function egoRead(url, withLinks) {
  const script = `const task = await taskSpace("neo-reader");
const page = task.page("p1");
await page.goto(${JSON.stringify(url)});
await page.waitForLoadState("domcontentloaded");
const r = await page.evaluate((withLinks) => ({
  title: document.title, url: location.href,
  links: withLinks ? [...document.querySelectorAll("a h3")].slice(0, 10).map(h => ({ title: h.innerText, url: h.closest("a").href })) : [],
  text: document.body.innerText.replace(/\\n{3,}/g, "\\n\\n").slice(0, 8000),
}), ${withLinks ? 'true' : 'false'});
console.log("@@NEO@@" + JSON.stringify(r));`;
  const job = egoQueue.then(() => new Promise((resolve, reject) => {
    const p = require('child_process').spawn(EGO, ['nodejs'], { cwd: os.tmpdir() });
    let out = ''; p.stdout.on('data', d => out += d); p.stderr.on('data', d => out += d);
    const t = setTimeout(() => p.kill(), 40000);
    p.on('error', reject);
    p.on('close', () => {
      clearTimeout(t);
      const m = out.match(/@@NEO@@(.*)/);
      if (!m) return reject(new Error(out.replace(/\[ego-browser:notice\][^\n]*\n?/g, '').slice(0, 300) || 'ego browser ไม่ตอบ'));
      try { resolve(JSON.parse(m[1])); } catch (e) { reject(e); }
    });
    p.stdin.end(script);
  }));
  egoQueue = job.catch(() => {});
  return job;
}

const strip = s => String(s).replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').replace(/[─-╿]{4,}/g, '──').trimEnd();
const ago = ms => { if (!ms) return 'ไม่มีข้อมูล'; const m = Math.round((Date.now() - Number(ms)) / 60000); return m < 1 ? 'เมื่อกี้' : m < 60 ? `${m} นาทีก่อน` : `${Math.round(m / 60)} ชม.ก่อน`; };
const short = p => String(p || '').replace(os.homedir(), '~');

const TOOLS = {
  orca_agents: {
    description: 'รายการ agent/terminal ที่เปิดใน Orca ตอนนี้: ชื่องาน (title), ชนิด agent, repo/worktree, branch, ออนไลน์ไหม, ข้อความล่าสุดเมื่อไร และตัวอย่างบรรทัดท้าย ใช้ handle กับ orca_agent_output',
    schema: { type: 'object', properties: {} },
    async call() {
      const d = await json(ORCA, ['terminal', 'list', '--json']);
      const ts = (d.result && d.result.terminals) || [];
      if (!ts.length) return 'ไม่มี terminal ใน Orca';
      return ts.map(t => [
        `handle: ${t.handle}`, `title: ${t.title || '-'}`, `agent: ${t.agentIdentity || 'shell'}`,
        `worktree: ${short(t.worktreePath)} (${String(t.branch || '').replace('refs/heads/', '')})`,
        `connected: ${t.connected}`, `last output: ${ago(t.lastOutputAt)}`,
        `preview: ${strip(t.preview || '').split('\n').slice(-3).join(' / ').slice(0, 300)}`,
      ].join('\n')).join('\n\n');
    },
  },
  orca_agent_output: {
    description: 'อ่านบรรทัดท้ายของ terminal/agent ใน Orca (ดูว่าทำถึงไหน ผลเป็นอย่างไร)',
    schema: { type: 'object', properties: { handle: { type: 'string', description: 'term_... จาก orca_agents' }, lines: { type: 'number', description: 'จำนวนบรรทัดท้าย (ค่าเริ่มต้น 60, สูงสุด 200)' } }, required: ['handle'] },
    async call({ handle, lines }) {
      if (!/^term_[0-9a-f-]{8,}$/i.test(String(handle || ''))) throw new Error('handle ไม่ถูกต้อง');
      const n = Math.max(5, Math.min(200, Number(lines) || 60));
      const d = await json(ORCA, ['terminal', 'read', '--terminal', handle, '--json']);
      const tail = ((d.result && d.result.terminal && d.result.terminal.tail) || []).map(strip).filter(l => l.trim());
      return tail.slice(-n).join('\n') || '(ไม่มีข้อความ)';
    },
  },
  orca_runs: {
    description: 'งาน orchestration ใน Orca (Run): เป้าหมาย สถานะ และ worker แต่ละตัวสำเร็จ/กำลังทำ/ล้มเหลว',
    schema: { type: 'object', properties: {} },
    async call() {
      const [r, w] = await Promise.all([json(ORCA, ['orchestration', 'run-list', '--json']), json(ORCA, ['orchestration', 'worker-list', '--json']).catch(() => null)]);
      const runs = (r.result && r.result.runs) || [], workers = (w && w.result && w.result.workers) || [];
      if (!runs.length) return 'ไม่มี Run';
      return runs.slice(0, 15).map(x => {
        const ws = workers.filter(k => k.runId === x.id), by = {};
        for (const k of ws) by[k.workerState || k.dispatchStatus] = (by[k.workerState || k.dispatchStatus] || 0) + 1;
        return `run: ${x.id}\nobjective: ${String(x.objective || '').slice(0, 200)}\nstatus: ${x.status || '-'}\ncreated: ${x.created_at || x.createdAt || '-'}\nworkers: ${JSON.stringify(by)}`;
      }).join('\n\n');
    },
  },
  orca_run_tasks: {
    description: 'รายการ task ของ Run หนึ่งใน Orca พร้อมสถานะ',
    schema: { type: 'object', properties: { run_id: { type: 'string' } }, required: ['run_id'] },
    async call({ run_id }) {
      if (!/^run_[0-9a-z]+$/i.test(String(run_id || ''))) throw new Error('run_id ไม่ถูกต้อง');
      const d = await json(ORCA, ['orchestration', 'task-list', '--run', run_id, '--json']);
      const ts = (d.result && d.result.tasks) || [];
      return ts.map(t => `${t.id} [${t.status}] ${String(t.title || t.spec || t.description || '').slice(0, 160)}`).join('\n') || 'ไม่มี task';
    },
  },
  browser_search: {
    description: 'ค้นหาด้วย Google ใน ego browser ของผู้ใช้ (เห็นผลแบบที่ผู้ใช้เห็น รวมเว็บที่ login ไว้) คืนรายการผลค้นหา (ชื่อ+URL) และข้อความหน้า — อ่านอย่างเดียว',
    schema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
    async call({ query }) {
      const q = String(query || '').trim().slice(0, 200); if (!q) throw new Error('ไม่มีคำค้น');
      const r = await egoRead('https://www.google.com/search?hl=th&q=' + encodeURIComponent(q), true);
      return `ผลค้นหา: ${r.title}\n` + r.links.map((l, i) => `${i + 1}. ${l.title} — ${l.url}`).join('\n') + `\n\nข้อความหน้า:\n${r.text.slice(0, 3000)}`;
    },
  },
  browser_read: {
    description: 'เปิด URL ใน ego browser ของผู้ใช้แล้วคืนข้อความในหน้า (รองรับเว็บที่ใช้ JavaScript และเว็บที่ผู้ใช้ login ไว้) — อ่านอย่างเดียว ไม่คลิก/ไม่กรอก',
    schema: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] },
    async call({ url }) {
      const r = await egoRead(safeUrl(url), false);
      return `${r.title}\n${r.url}\n\n${r.text}`;
    },
  },
};

// ---------- MCP stdio (JSON-RPC บรรทัดละข้อความ) ----------
const out = m => process.stdout.write(JSON.stringify(m) + '\n');
let buf = '';
process.stdin.on('data', d => {
  buf += d; let i;
  while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (line) handle(line); }
});
async function handle(line) {
  let m; try { m = JSON.parse(line); } catch { return; }
  const reply = result => m.id !== undefined && out({ jsonrpc: '2.0', id: m.id, result });
  const fail = (code, message) => m.id !== undefined && out({ jsonrpc: '2.0', id: m.id, error: { code, message } });
  if (m.method === 'initialize') return reply({ protocolVersion: (m.params && m.params.protocolVersion) || '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'neo-agents', version: '0.1.0' } });
  if (m.method === 'ping') return reply({});
  if (m.method === 'tools/list') return reply({ tools: Object.entries(TOOLS).map(([name, t]) => ({ name, description: t.description, inputSchema: t.schema, annotations: { readOnlyHint: true } })) });
  if (m.method === 'tools/call') {
    const t = TOOLS[m.params && m.params.name];
    if (!t) return fail(-32602, 'unknown tool');
    try { return reply({ content: [{ type: 'text', text: await t.call((m.params && m.params.arguments) || {}) }] }); }
    catch (e) { return reply({ content: [{ type: 'text', text: 'error: ' + e.message }], isError: true }); }
  }
  if (m.id !== undefined) fail(-32601, 'method not found');
}
