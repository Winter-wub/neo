// "สมอง" ของ Neo ที่สลับได้ (Neo เป็น wrapper: เสียง/การ์ด/อารมณ์/console เหมือนเดิมทุก provider)
//   acp    — agent ใดก็ได้ที่พูด Agent Client Protocol ผ่าน stdio (claude-code-acp, opencode acp, qwen --experimental-acp …)
//   openai — endpoint แบบ OpenAI chat completions (Ollama, LM Studio, vLLM, OpenRouter …)
//   http   — endpoint ของผู้ใช้เอง: POST {text, sessionId, fresh} → {card} | {text} (+ sessionId)
// claude-code (claude -p) อยู่ใน server.js เพราะมีขั้น skill เฉพาะ
// ทุกตัวมี: ask(text) → การ์ด, cancel(), reset() และจำบทสนทนาเอง (เริ่มใหม่เมื่อเงียบ 15 นาที / 20 รอบ)
'use strict';
const { spawn } = require('child_process');

const IDLE_MS = 15 * 60000, MAX_TURNS = 20;
// tool kind ตาม ACP ที่ถือว่าอ่านอย่างเดียว → อนุญาตเอง; นอกนั้น (edit, delete, move, execute, other) ถามผู้ใช้ด้วยเสียง
const READ_KINDS = new Set(['read', 'search', 'fetch', 'think']);
// โหมดข้ามการขออนุญาต: เลือกโหมดที่สิทธิ์เต็มที่สุดจากที่ agent บอกมาเอง (ไม่เขียนชื่อโหมดตายตัวต่อ agent)
const PERMISSIVE = [/bypass/i, /yolo/i, /dont.?ask|never.?ask/i, /full|danger/i, /build|code|act/i, /accept/i, /auto/i];
function pickMode(ids) { for (const re of PERMISSIVE) { const m = ids.find(id => re.test(id) && !/plan|read/i.test(id)); if (m) return m; } return null; }

class Session {
  constructor() { this.reset(); }
  fresh(now) { return !this.id || now - this.last > IDLE_MS || this.turns >= MAX_TURNS; }
  done(id, fresh, now) { this.id = id; this.last = now; this.turns = fresh ? 1 : this.turns + 1; }
  reset() { this.id = null; this.last = 0; this.turns = 0; }
}

class AcpProvider {
  /** cfg: {label, command, args, config:{model, mode,…}}; deps: {emit, prompt, toCard, confirm, isReadTool, acpMcp, env, cwd, log} */
  constructor(name, cfg, deps) {
    Object.assign(this, { name, cfg, deps, label: cfg.label || name, kind: 'agent' });
    this.session = new Session(); this.proc = null; this.pending = new Map(); this.nextId = 1; this.text = ''; this.sid = null;
    this.model = null; this.modelList = null; this.modelVia = null; // agent บอกรายชื่อโมเดลมาตอนเปิด session (opencode: configOptions, claude-code-acp: models)
  }
  /** เลือกโมเดล (id จริง) — ถ้ามี session อยู่แล้วเปลี่ยนทันที */
  setModel(id) { this.model = id || null; if (this.sid) this.applyModel(); }
  applyModel() {
    if (!this.sid || !this.model) return Promise.resolve();
    const req = this.modelVia === 'models' ? this.request('session/set_model', { sessionId: this.sid, modelId: this.model })
      : this.request('session/set_config_option', { sessionId: this.sid, configId: 'model', value: this.model });
    return req.catch(e => this.deps.log(`${this.label} เปลี่ยนโมเดลเป็น ${this.model} ไม่ได้: ${e.message}`));
  }
  async openSession() {
    const r = await this.request('session/new', { cwd: this.deps.cwd, mcpServers: this.deps.acpMcp() });
    this.sid = r.sessionId;
    const opt = (r.configOptions || []).find(o => o.id === 'model');
    if (opt) { this.modelVia = 'config'; this.modelList = (opt.options || []).map(o => ({ id: o.value, name: o.name || o.value })); }
    else if (r.models) { this.modelVia = 'models'; this.modelList = (r.models.availableModels || []).map(m => ({ id: m.modelId, name: m.name + (m.description ? ' — ' + m.description : '') })); }
    const bypass = this.deps.bypass();
    for (const [k, v] of Object.entries(this.cfg.config || {})) {
      if (bypass && k === 'mode') continue; // โหมดข้ามการขออนุญาตเลือกเองด้านล่าง
      await this.request('session/set_config_option', { sessionId: this.sid, configId: k, value: v }).catch(e => this.deps.log(`${this.label} ตั้ง ${k}=${v} ไม่ได้: ${e.message}`));
    }
    if (bypass) { // ข้ามการขออนุญาตทั้งหมด: โหมดที่สิทธิ์เต็มที่สุดที่ agent มี
      const cm = (r.configOptions || []).find(o => o.id === 'mode');
      const mode = pickMode(cm ? (cm.options || []).map(o => o.value) : ((r.modes && r.modes.availableModes) || []).map(m => m.id));
      if (mode) {
        await (cm ? this.request('session/set_config_option', { sessionId: this.sid, configId: 'mode', value: mode }) : this.request('session/set_mode', { sessionId: this.sid, modeId: mode }))
          .then(() => this.deps.log(`${this.label} โหมด ${mode}`), e => this.deps.log(`${this.label} ตั้งโหมด ${mode} ไม่ได้: ${e.message}`));
      }
    }
    await this.applyModel();
  }
  /** รายชื่อโมเดลที่ agent มี (เปิด session เปล่าเพื่อถามถ้ายังไม่รู้ — ไม่ส่ง prompt ไม่เสีย quota) */
  async listModels() { if (!this.modelList) { await this.start(); await this.openSession(); } return this.modelList || []; }
  start() {
    if (this.proc) return this.ready;
    const p = spawn(this.cfg.command, this.cfg.args || [], { cwd: this.deps.cwd, env: this.deps.env() });
    this.proc = p; let buf = '', err = '';
    p.stdout.on('data', d => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); this.onLine(l); } });
    p.stderr.on('data', d => { err = (err + d).slice(-500); });
    const dead = why => { if (this.proc !== p) return; this.proc = null; this.session.reset(); for (const w of this.pending.values()) w.reject(new Error(this.label + ': ' + why)); this.pending.clear(); };
    p.on('error', e => dead(e.message));
    p.on('close', code => dead('ปิดตัว (' + code + ') ' + err.split('\n').filter(Boolean).pop()));
    this.ready = this.request('initialize', { protocolVersion: 1, clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false } })
      .then(r => { this.info = r; return r; });
    return this.ready;
  }
  request(method, params) {
    return new Promise((resolve, reject) => { const id = this.nextId++; this.pending.set(id, { resolve, reject }); this.write({ jsonrpc: '2.0', id, method, params }); });
  }
  write(m) { if (this.proc) this.proc.stdin.write(JSON.stringify(m) + '\n'); }
  onLine(line) {
    let m; try { m = JSON.parse(line); } catch { return; }
    if (m.id !== undefined && !m.method) { // คำตอบของคำขอเรา
      const w = this.pending.get(m.id); if (!w) return; this.pending.delete(m.id);
      return m.error ? w.reject(new Error(m.error.message || 'ACP error')) : w.resolve(m.result);
    }
    if (m.method === 'session/update') return this.onUpdate((m.params && m.params.update) || {});
    if (m.method === 'session/request_permission') return this.onPermission(m);
    if (m.id !== undefined) this.write({ jsonrpc: '2.0', id: m.id, error: { code: -32601, message: 'Neo ไม่รองรับ ' + m.method } }); // fs/terminal: ไม่เปิดให้
  }
  onUpdate(u) {
    if (u.sessionUpdate === 'agent_message_chunk' && u.content && u.content.type === 'text') this.text += u.content.text;
    else if (u.sessionUpdate === 'tool_call') this.deps.emit({ type: 'tool', name: u.title || u.kind || 'tool', input: u.kind || '' });
  }
  async onPermission(m) {
    const tc = (m.params && m.params.toolCall) || {}, opts = (m.params && m.params.options) || [];
    const pick = kinds => (opts.find(o => kinds.includes(o.kind)) || {}).optionId;
    const title = String(tc.title || tc.kind || 'ทำงาน').slice(0, 80);
    let ok = this.deps.bypass() || READ_KINDS.has(tc.kind) || this.deps.isReadTool(title); // bypass: อนุญาตทุกอย่าง
    if (!ok) ok = await this.deps.confirm({ title, kind: tc.kind, agent: this.label });
    const optionId = ok ? pick(['allow_once', 'allow_always']) : pick(['reject_once', 'reject_always']);
    this.deps.log(`permission ${ok ? 'allow' : 'deny'}: ${title}`);
    this.write({ jsonrpc: '2.0', id: m.id, result: { outcome: optionId ? { outcome: 'selected', optionId } : { outcome: 'cancelled' } } });
  }
  async ask(q) {
    await this.start();
    const fresh = this.session.fresh(Date.now());
    if (fresh) await this.openSession();
    this.deps.emit({ type: 'session', fresh, turn: fresh ? 1 : this.session.turns + 1, provider: this.label });
    this.text = '';
    const r = await this.request('session/prompt', { sessionId: this.sid, prompt: [{ type: 'text', text: this.deps.prompt(q, fresh, 'agent') }] });
    this.session.done(this.sid, fresh, Date.now());
    if (r && r.stopReason === 'cancelled') throw new Error('interrupted');
    return this.deps.toCard(this.text);
  }
  cancel() { if (this.sid && this.proc) this.write({ jsonrpc: '2.0', method: 'session/cancel', params: { sessionId: this.sid } }); }
  reset() { this.session.reset(); }
  stop() { if (this.proc) this.proc.kill(); }
}

// API key: ตัวแปรสภาพแวดล้อม (apiKeyEnv) หรือไฟล์ (apiKeyFile เช่น ~/.config/neo/openrouter.key สิทธิ์ 600) — ไม่เก็บ key ใน providers.json
function apiKey(cfg) {
  if (cfg.apiKeyEnv && process.env[cfg.apiKeyEnv]) return process.env[cfg.apiKeyEnv];
  if (cfg.apiKeyFile) { try { return require('fs').readFileSync(cfg.apiKeyFile.replace(/^~(?=\/)/, require('os').homedir()), 'utf8').trim(); } catch {} }
  return '';
}

class OpenAIProvider {
  /** cfg: {label, baseUrl, model, apiKeyEnv|apiKeyFile, headers} — ไม่มีเครื่องมือ; Neo เก็บประวัติข้อความเอง (ใช้กับ OpenRouter ได้) */
  constructor(name, cfg, deps) { Object.assign(this, { name, cfg, deps, label: cfg.label || name, kind: 'plain' }); this.session = new Session(); this.msgs = []; this.model = cfg.model; }
  setModel(id) { this.model = id || this.cfg.model; } // เปลี่ยนโมเดลกลางบทสนทนาได้ (ประวัติยังอยู่)
  /** GET /models ของ endpoint (OpenRouter, Ollama, LM Studio …) */
  async listModels() {
    const key = apiKey(this.cfg);
    const r = await fetch(String(this.cfg.baseUrl).replace(/\/$/, '') + '/models', { signal: AbortSignal.timeout(10000), headers: { ...(this.cfg.headers || {}), ...(key ? { Authorization: 'Bearer ' + key } : {}) } });
    if (!r.ok) throw new Error(`${this.label} /models ตอบ ${r.status}`);
    const j = await r.json();
    return (j.data || j.models || []).map(m => ({ id: m.id || m.name, name: m.name && m.name !== m.id ? `${m.id} — ${m.name}` : (m.id || m.name) }));
  }
  async ask(q) {
    const fresh = this.session.fresh(Date.now());
    if (fresh) this.msgs = [];
    this.deps.emit({ type: 'session', fresh, turn: fresh ? 1 : this.session.turns + 1, provider: this.label });
    if (!this.model) throw new Error(`${this.label}: ยังไม่ได้เลือกโมเดล — เลือกในหน้า console`);
    this.msgs.push({ role: 'user', content: this.deps.prompt(q, fresh, 'plain') });
    const key = apiKey(this.cfg);
    this.ctrl = new AbortController();
    const r = await fetch(String(this.cfg.baseUrl).replace(/\/$/, '') + '/chat/completions', {
      method: 'POST', signal: AbortSignal.any([this.ctrl.signal, AbortSignal.timeout(120000)]),
      headers: { 'Content-Type': 'application/json', ...(this.cfg.headers || {}), ...(key ? { Authorization: 'Bearer ' + key } : {}) },
      body: JSON.stringify({ model: this.model, messages: this.msgs, temperature: 0.3 }),
    }).catch(e => { throw new Error(e.name === 'AbortError' ? 'interrupted' : this.label + ': ' + e.message); });
    if (!r.ok) { this.msgs.pop(); const why = await r.text().catch(() => ''); throw new Error(`${this.label} ตอบ ${r.status}${r.status === 401 ? ' (ไม่มี/ผิด API key)' : ''} ${why.slice(0, 120)}`); }
    const j = await r.json(), text = (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '';
    this.msgs.push({ role: 'assistant', content: text }); this.session.done('chat', fresh, Date.now());
    return this.deps.toCard(text);
  }
  cancel() { if (this.ctrl) this.ctrl.abort(); }
  reset() { this.session.reset(); }
}

class HttpProvider {
  /** cfg: {label, url, headers} — endpoint ของผู้ใช้; ส่งกติกาการ์ดไปด้วยใน prompt ครั้งแรกของบทสนทนา */
  constructor(name, cfg, deps) { Object.assign(this, { name, cfg, deps, label: cfg.label || name, kind: 'plain' }); this.session = new Session(); this.model = cfg.model || null; }
  setModel(id) { this.model = id || this.cfg.model || null; }
  async listModels() { return []; } // endpoint เองไม่มีมาตรฐานบอกรายชื่อ — ใช้ชื่อที่ตั้งไว้ใน models
  async ask(q) {
    const fresh = this.session.fresh(Date.now());
    this.deps.emit({ type: 'session', fresh, turn: fresh ? 1 : this.session.turns + 1, provider: this.label });
    this.ctrl = new AbortController();
    const r = await fetch(this.cfg.url, {
      method: 'POST', signal: AbortSignal.any([this.ctrl.signal, AbortSignal.timeout(120000)]),
      headers: { 'Content-Type': 'application/json', ...(this.cfg.headers || {}), ...(apiKey(this.cfg) ? { Authorization: 'Bearer ' + apiKey(this.cfg) } : {}) },
      body: JSON.stringify({ text: q, prompt: this.deps.prompt(q, fresh, 'plain'), sessionId: fresh ? null : this.session.id, fresh, model: this.model }),
    }).catch(e => { throw new Error(e.name === 'AbortError' ? 'interrupted' : this.label + ': ' + e.message); });
    if (!r.ok) throw new Error(`${this.label} ตอบ ${r.status}`);
    const j = await r.json();
    this.session.done(j.sessionId || this.session.id || 'http', fresh, Date.now());
    return j.card ? this.deps.toCard(JSON.stringify(j.card)) : this.deps.toCard(String(j.text || j.reply || ''));
  }
  cancel() { if (this.ctrl) this.ctrl.abort(); }
  reset() { this.session.reset(); }
}

function create(name, cfg, deps) {
  if (cfg.type === 'acp') return new AcpProvider(name, cfg, deps);
  if (cfg.type === 'openai') return new OpenAIProvider(name, cfg, deps);
  if (cfg.type === 'http') return new HttpProvider(name, cfg, deps);
  throw new Error('ไม่รู้จัก provider type ' + cfg.type);
}

module.exports = { create, apiKey, pickMode, AcpProvider, OpenAIProvider, HttpProvider, READ_KINDS };
