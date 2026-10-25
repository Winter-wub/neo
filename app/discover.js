// หา agent ที่ใช้เป็นสมองของ Neo ได้แบบ dynamic — ไม่มีรายชื่อเขียนตายตัวในโค้ด
// รายชื่อ agent ACP มาจาก registry ของ acpx ที่ติดตั้งในเครื่อง (AGENT_REGISTRY) แล้วเลือกเฉพาะตัวที่รันได้จริงบนเครื่องนี้
// ไม่สั่ง npx ดาวน์โหลดเอง: คำสั่ง npx จะถูกแทนด้วยตัวที่ติดตั้งไว้แล้ว (global npm หรือ binary ใน PATH)
'use strict';
const fs = require('fs'), path = require('path'), os = require('os');
const { execFileSync } = require('child_process');

/** โฟลเดอร์ที่จะหา binary: PATH ของ server + ที่ติดตั้งทั่วไปของผู้ใช้ */
function searchPath(globalRoot) {
  const extra = [path.join(os.homedir(), '.local/bin'), '/opt/homebrew/bin', '/usr/local/bin', globalRoot && path.join(globalRoot, '..', '..', 'bin')];
  return [...new Set([...(process.env.PATH || '').split(':'), ...extra].filter(Boolean))];
}
function which(bin, dirs) {
  for (const d of dirs) { const f = path.join(d, bin); try { fs.accessSync(f, fs.constants.X_OK); if (fs.statSync(f).isFile()) return fs.realpathSync(f); } catch {} } // realpath: ไม่ใช้ path ชั่วคราวของ fnm
  return null;
}
function npmGlobalRoot() {
  try { return execFileSync('npm', ['root', '-g'], { encoding: 'utf8', timeout: 8000 }).trim(); } catch { return null; }
}

/** อ่าน AGENT_REGISTRY จากไฟล์ของ acpx → {name: "คำสั่ง args"} */
function acpxRegistry(globalRoot) {
  const dist = globalRoot && path.join(globalRoot, 'acpx', 'dist');
  if (!dist || !fs.existsSync(dist)) return {};
  for (const f of fs.readdirSync(dist).filter(f => f.endsWith('.js'))) {
    const s = fs.readFileSync(path.join(dist, f), 'utf8');
    const m = s.match(/const AGENT_REGISTRY = \{([\s\S]*?)\n\};/); if (!m) continue;
    const ranges = {}; const r = s.match(/const ACP_ADAPTER_PACKAGE_RANGES = \{([\s\S]*?)\};/);
    if (r) for (const [, k, v] of r[1].matchAll(/(\w+):\s*"([^"]*)"/g)) ranges[k] = v;
    const out = {};
    for (const [, k, v] of m[1].matchAll(/([\w-]+):\s*[`"]([^`"]+)[`"]/g)) out[k] = v.replace(/\$\{ACP_ADAPTER_PACKAGE_RANGES\.(\w+)\}/g, (_, x) => ranges[x] || '');
    return out;
  }
  return {};
}

/** แปลงคำสั่ง npx เป็น binary ที่ติดตั้งแล้ว (global npm bin หรือชื่อแพ็กเกจใน PATH เช่น opencode-ai → opencode) */
function resolveNpx(words, globalRoot, dirs) {
  const i = words.findIndex(w => !w.startsWith('-') && w !== 'npx');
  const spec = words[i], rest = words.slice(i + 1);
  const pkg = spec.replace(/@[^@/]*$/, '') || spec; // ตัดเวอร์ชันท้าย
  try { // ติดตั้งแบบ global แล้ว → ใช้ bin ของแพ็กเกจ
    const pj = JSON.parse(fs.readFileSync(path.join(globalRoot, pkg, 'package.json'), 'utf8'));
    const bins = typeof pj.bin === 'string' ? { [pkg.split('/').pop()]: pj.bin } : (pj.bin || {});
    for (const b of Object.keys(bins)) { const f = which(b, dirs); if (f) return { command: f, args: rest, via: 'global ' + pkg }; }
  } catch {}
  const base = pkg.split('/').pop();
  for (const b of new Set([base, base.replace(/-ai$/, '')])) { const f = which(b, dirs); if (f) return { command: f, args: rest, via: 'PATH ' + b }; } // opencode-ai → opencode (ไม่ตัด -acp: ตัวแปลงต่างจาก CLI)
  return null;
}

/** ทดลองคุย ACP (initialize อย่างเดียว ไม่ส่งคำถาม ไม่เสีย quota) ว่าคำสั่งนี้เป็น agent ACP จริง */
function probe(command, args, env, ms = 10000) {
  return new Promise(resolve => {
    let p; try { p = require('child_process').spawn(command, args, { env, cwd: os.tmpdir(), stdio: ['pipe', 'pipe', 'ignore'] }); } catch { return resolve(null); }
    let buf = ''; const done = v => { clearTimeout(t); try { p.kill(); } catch {} resolve(v); };
    const t = setTimeout(() => done(null), ms);
    p.on('error', () => done(null)); p.on('close', () => done(null));
    p.stdout.on('data', d => { buf += d; for (const l of buf.split('\n')) { try { const m = JSON.parse(l); if (m.id === 1) return done(m.result ? (m.result.agentInfo || {}) : null); } catch {} } });
    p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: 1, clientCapabilities: {} } }) + '\n');
  });
}

/** คืน agent ทั้งหมดใน registry พร้อมสถานะว่ารันได้บนเครื่องนี้ไหม + Claude Code CLI ถ้ามี (verify = ทดลองคุย ACP กับตัวที่เจอ) */
async function discoverVerified(env) {
  const r = discover();
  await Promise.all(r.agents.filter(a => a.type === 'acp' && a.available).map(async a => {
    const info = await probe(a.command, a.args, env);
    if (info) { a.agentInfo = info; if (info.title || info.name) a.label = a.name === 'claude-acp' ? 'Claude Code (ACP)' : (info.title || info.name); }
    else { a.available = false; a.why = 'เจอคำสั่ง ' + a.command + ' แต่ไม่ตอบ ACP'; }
  }));
  return r;
}

function discover() {
  const globalRoot = npmGlobalRoot(), dirs = searchPath(globalRoot), reg = acpxRegistry(globalRoot), out = [];
  const claude = which('claude', dirs);
  if (claude) out.push({ name: 'claude', label: 'Claude Code', type: 'claude-code', available: true, via: claude });
  for (const [name, line] of Object.entries(reg)) {
    const words = line.trim().split(/\s+/);
    const r = words[0] === 'npx' ? resolveNpx(words, globalRoot, dirs) : (which(words[0], dirs) ? { command: which(words[0], dirs), args: words.slice(1), via: 'PATH ' + words[0] } : null);
    out.push({ name: name === 'claude' ? 'claude-acp' : name, label: name === 'claude' ? 'Claude Code (ACP)' : name, type: 'acp', available: !!r, registry: line, ...(r || {}) });
  }
  return { agents: out, acpx: Object.keys(reg).length > 0 };
}

module.exports = { discover, discoverVerified, probe, acpxRegistry, resolveNpx, which };
