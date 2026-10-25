// Neo ฝัน: เรียนรู้ช่วงเวลาที่ผู้ใช้ไม่อยู่ → หลับลึก → ฝัน = จัดระเบียบความจำ + วิเคราะห์คำขอเก่าให้ลึกขึ้น
// เก็บใน NEO_HOME: journal.jsonl (บทสนทนา), memory.md (ความจำระยะยาว), dreams.jsonl (ผลฝัน), activity.json (สถิติชั่วโมงที่คุยกัน)
const fs = require('fs');
const path = require('path');

const HOUR = 3600000;
const DEEP_IDLE = 45 * 60000; // เงียบเกิน 45 นาที = หลับลึก
const LONG_IDLE = 3 * HOUR;   // ไม่อยู่นานเกิน 3 ชม. ฝันได้ทุกเวลา
const DREAM_GAP = 6 * HOUR;   // ฝันห่างกันอย่างน้อย 6 ชม.
const MEMORY_MAX = 3000;

class Dreamer {
  /**
   * home = NEO_HOME; think(prompt) → Promise<string> (คำตอบดิบของ AI); emit(ev) → ส่งให้มือถือ/console
   * busy() → true ถ้ากำลังตอบผู้ใช้อยู่ (ไม่ฝันแทรก)
   */
  constructor({ home, think, name = () => 'Neo', emit, busy = () => false, now = Date.now, log = () => {} }) {
    Object.assign(this, { home, think, name, emit, busy, now, log });
    this.files = { journal: path.join(home, 'journal.jsonl'), memory: path.join(home, 'memory.md'), dreams: path.join(home, 'dreams.jsonl'), activity: path.join(home, 'activity.json') };
    this.act = { hours: new Array(168).fill(0), since: now(), last: now(), lastDream: 0, enabled: true };
    try { Object.assign(this.act, JSON.parse(fs.readFileSync(this.files.activity, 'utf8'))); } catch {}
    this.running = false; this.timer = null; this.pending = null; // การ์ดฝันที่ยังไม่ได้ให้มือถือ
    try { this.pending = (this.dreams(1)[0] || {}).undelivered ? this.dreams(1)[0].card : null; } catch {}
  }
  start() { this.timer = setInterval(() => this.maybe(), 5 * 60000); return this; }
  stop() { clearInterval(this.timer); }
  saveAct() { fs.writeFileSync(this.files.activity, JSON.stringify(this.act), { mode: 0o600 }); }

  /* ---------- เรียนรู้เวลาที่ผู้ใช้อยู่ ---------- */
  /** มีคนคุย/แตะ/เรียกชื่อ (เรียกถี่ได้ — นับชั่วโมงละครั้งต่อ 10 นาที) */
  activity(t = this.now()) {
    const d = new Date(t), slot = d.getDay() * 24 + d.getHours();
    if (t - (this.act.lastCount || 0) > 10 * 60000) { this.act.hours[slot] += 1; this.act.lastCount = t; }
    this.act.last = t; this.saveAct();
  }
  /** สัดส่วนความถี่ต่อชั่วโมง 0..1 (รวมทุกวัน) — ไว้วาดกราฟใน Neo.app */
  profile() {
    const h = new Array(24).fill(0);
    this.act.hours.forEach((v, i) => { h[i % 24] += v; });
    const max = Math.max(...h);
    return h.map(v => max ? +(v / max).toFixed(3) : 0);
  }
  /** ชั่วโมงนี้ปกติผู้ใช้ไม่อยู่ไหม: ข้อมูลยังน้อย (< 3 วัน หรือ < 10 ครั้ง) ใช้ 01–05 น. ไปก่อน */
  quiet(t = this.now()) {
    const d = new Date(t), total = this.act.hours.reduce((a, b) => a + b, 0);
    if (t - this.act.since < 3 * 24 * HOUR || total < 10) return d.getHours() >= 1 && d.getHours() < 6;
    const p = this.profile(), h = d.getHours();
    return p[h] <= 0.1 && p[(h + 23) % 24] <= 0.25 && p[(h + 1) % 24] <= 0.25;
  }
  quietHours() { const out = []; const d = new Date(this.now()); d.setMinutes(0, 0, 0); for (let h = 0; h < 24; h++) { d.setHours(h); if (this.quiet(d.getTime())) out.push(h); } return out; }

  /* ---------- บันทึกบทสนทนา ---------- */
  record(q, a, ok = true, t = this.now()) {
    if (!q) return;
    fs.appendFileSync(this.files.journal, JSON.stringify({ at: t, q: String(q).slice(0, 400), a: String(a || '').slice(0, 600), ok }) + '\n', { mode: 0o600 });
    // เก็บแค่ 2000 รายการล่าสุด
    if (Math.random() < 0.02) { const all = this.journal(); if (all.length > 2000) fs.writeFileSync(this.files.journal, all.slice(-2000).map(e => JSON.stringify(e)).join('\n') + '\n', { mode: 0o600 }); }
  }
  journal(since = 0) {
    try { return fs.readFileSync(this.files.journal, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(e => e && e.at > since); } catch { return []; }
  }
  memory() { try { return fs.readFileSync(this.files.memory, 'utf8'); } catch { return ''; } }
  setMemory(m) { fs.writeFileSync(this.files.memory, String(m).slice(0, MEMORY_MAX * 2), { mode: 0o600 }); }
  dreams(n = 10) {
    try { return fs.readFileSync(this.files.dreams, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean).slice(-n).reverse(); } catch { return []; }
  }

  /* ---------- ฝัน ---------- */
  /** ควรฝันตอนนี้ไหม (คืนเหตุผล หรือ null) */
  why(t = this.now()) {
    if (!this.act.enabled || this.running || this.busy()) return null;
    if (t - (this.act.lastDream || 0) < DREAM_GAP) return null;
    const idle = t - this.act.last;
    if (idle < DEEP_IDLE) return null;
    if (!this.journal(this.act.lastDream || 0).length) return null; // ไม่มีเรื่องใหม่ให้ฝัน
    if (this.quiet(t)) return 'ช่วงที่ปกติคุณไม่อยู่';
    if (idle >= LONG_IDLE) return 'คุณไม่อยู่นานแล้ว';
    return null;
  }
  maybe() { const w = this.why(); if (w) this.dream(w).catch(e => this.log('dream failed: ' + e.message)); }

  async dream(reason = 'สั่งให้ฝัน') {
    if (this.running) throw new Error('กำลังฝันอยู่');
    this.running = true;
    const started = this.now(), since = this.act.lastDream || 0;
    const entries = this.journal(since).slice(-120);
    this.emit({ type: 'dreaming', reason, entries: entries.length });
    this.log(`dream start (${reason}), ${entries.length} entries`);
    try {
      const raw = await this.think(DREAM_PROMPT(this.memory(), entries, this.quietHours(), this.name()));
      const j = parse(raw), before = factSet(this.memory());
      if (typeof j.memory === 'string' && j.memory.trim().length > 20) this.setMemory(j.memory.trim().slice(0, MEMORY_MAX));
      const after = factSet(this.memory()), added = [...after].filter(x => !before.has(x)), removed = [...before].filter(x => !after.has(x));
      const card = wakeCard(j);
      const rec = { at: this.now(), reason, took: this.now() - started, entries: entries.length, dream: String(j.dream || '').slice(0, 120), insights: (j.insights || []).slice(0, 5), patterns: (j.patterns || []).slice(0, 5).map(String), added: added.slice(0, 40), removed: removed.slice(0, 40), card, undelivered: true };
      fs.appendFileSync(this.files.dreams, JSON.stringify(rec) + '\n', { mode: 0o600 });
      this.act.lastDream = this.now(); this.saveAct();
      this.pending = card;
      this.emit({ type: 'dream_done', dream: rec.dream, insights: rec.insights.length, card });
      return rec;
    } catch (e) {
      this.emit({ type: 'dream_fail', error: e.message });
      throw e;
    } finally { this.running = false; }
  }
  /* ---------- จัดการจาก Neo.app ---------- */
  /** ความจำแยกเป็นข้อ ๆ ตามหัวข้อ + มาจากความฝันครั้งไหน (from = null คือผู้ใช้เขียน/แก้เอง หรือมาก่อนมีบันทึก) */
  facts() {
    const ds = this.dreams(200), out = []; let section = '';
    for (const raw of this.memory().split('\n')) {
      const l = raw.trim(); if (!l) continue;
      if (/^#{1,6}\s/.test(l)) { section = l.replace(/^#+\s*/, ''); continue; }
      const text = fact(l), d = ds.find(x => (x.added || []).includes(text));
      out.push({ section, text, from: d ? { at: d.at, dream: d.dream } : null });
    }
    return out;
  }
  /** เขียนความจำใหม่จากรายการข้อ (Neo.app แก้/ลบ/เพิ่มทีละข้อ) */
  setFacts(list) {
    const by = new Map();
    for (const f of list) { const t = fact(String(f.text || '')); if (!t) continue; const k = String(f.section || 'อื่น ๆ').trim() || 'อื่น ๆ'; if (!by.has(k)) by.set(k, []); by.get(k).push(t); }
    this.setMemory([...by].map(([k, xs]) => '## ' + k + '\n' + xs.map(x => '- ' + x).join('\n')).join('\n\n'));
  }
  rewrite(file, keep) {
    const all = (file === this.files.dreams ? this.dreams(1e6).reverse() : this.journal()).filter(keep);
    fs.writeFileSync(file, all.map(e => JSON.stringify(e)).join('\n') + (all.length ? '\n' : ''), { mode: 0o600 });
    return all.length;
  }
  forgetDream(at) { if (this.pending && (this.dreams(1)[0] || {}).at === at) this.pending = null; return this.rewrite(this.files.dreams, d => d.at !== at); }
  clearDreams() { this.pending = null; return this.rewrite(this.files.dreams, () => false); }
  forgetJournal(at) { return this.rewrite(this.files.journal, e => e.at !== at); }
  clearJournal() { return this.rewrite(this.files.journal, () => false); }

  /** มือถือรับการ์ดฝันแล้ว (ตอนตื่น) */
  delivered() {
    this.pending = null;
    try { const all = fs.readFileSync(this.files.dreams, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)); if (all.length) { delete all[all.length - 1].undelivered; fs.writeFileSync(this.files.dreams, all.slice(-200).map(e => JSON.stringify(e)).join('\n') + '\n', { mode: 0o600 }); } } catch {}
  }
}

/** บรรทัดความจำ → ข้อความล้วน (ตัด "- " / "* " / "1. ") */
const fact = l => String(l).trim().replace(/^(?:[-*•]|\d+[.)])\s+/, '').trim();
const factSet = m => new Set(String(m).split('\n').map(s => s.trim()).filter(l => l && !/^#{1,6}\s/.test(l)).map(fact).filter(Boolean));

function parse(raw) {
  const m = String(raw).match(/\{[\s\S]*\}/);
  if (!m) throw new Error('ฝันแล้วจำไม่ได้ (คำตอบไม่ใช่ JSON)');
  return JSON.parse(m[0]);
}

/** การ์ดที่ Neo เล่าให้ฟังตอนตื่น */
function wakeCard(j) {
  const c = j.card && typeof j.card === 'object' ? j.card : {};
  const lines = (Array.isArray(c.lines) ? c.lines : []).map(String).slice(0, 12);
  const items = (Array.isArray(c.items) ? c.items : []).slice(0, 12).map(x => ({ t: String(x.t ?? ''), v: String(x.v ?? '') }));
  if (!lines.length && !items.length) for (const i of (j.insights || []).slice(0, 3)) lines.push(String(i.finding || i).slice(0, 32));
  if (j.dream) lines.unshift(String(j.dream).slice(0, 32));
  return { kind: 'text', layout: items.length ? 'list' : 'text', icon: 'text', title: String(c.title || 'เมื่อกี้ฝันว่า…').slice(0, 16), lines, items, emotion: 'love', sounds: ['love', 'happy'], seconds: Math.min(90, 20 + 4 * (lines.length + items.length)), dream: true };
}

const DREAM_PROMPT = (memory, entries, quiet, name = 'Neo') => `คุณคือ "${name}" (ชื่อที่ผู้ใช้ตั้งให้ ใช้ชื่อนี้เท่านั้น) สัตว์เลี้ยง AI บนจอมือถือของผู้ใช้ ตอนนี้ผู้ใช้ไม่อยู่ คุณกำลังหลับลึกและ "ฝัน" — ใช้เวลานี้ทำงานเบื้องหลังให้ผู้ใช้ (ไม่มีใครรอ ใช้เวลาได้เต็มที่ ค้นข้อมูลลึกได้)

ความจำระยะยาวเดิม (memory.md):
${memory || '(ยังไม่มี)'}

บทสนทนาใหม่ตั้งแต่ฝันครั้งก่อน (เวลา | ผู้ใช้ถาม → ${name} ตอบ | ok=false คือทำไม่สำเร็จ):
${entries.map(e => `${new Date(e.at).toLocaleString('th-TH', { hour12: false })} | ${e.q} → ${e.a || '-'}${e.ok === false ? ' | ok=false' : ''}`).join('\n') || '(ไม่มี)'}

ชั่วโมงที่ผู้ใช้มักไม่อยู่: ${quiet.join(', ') || 'ยังไม่รู้'}

งาน:
1. จัดระเบียบความจำ (memory defragmentation): รวมความจำเดิมกับเรื่องใหม่ ตัดซ้ำ ตัดเรื่องล้าสมัย/ไม่สำคัญ จัดเป็นหัวข้อ markdown: ## ผู้ใช้ (เป็นใคร ทำงานอะไร), ## ชอบ/ไม่ชอบ, ## เรื่องที่สนใจบ่อย, ## งานที่ทำอยู่/ค้างอยู่, ## สถานที่/คน/สิ่งที่ถามถึงบ่อย — เก็บเฉพาะสิ่งที่ช่วยให้ตอบครั้งหน้าดีขึ้น ห้ามเก็บชื่อของคุณเอง (ชื่อมาจากการตั้งค่า เปลี่ยนได้เสมอ) ห้ามเก็บรหัสผ่าน/ข้อมูลลับ ไม่เกิน ${MEMORY_MAX} ตัวอักษร
2. วิเคราะห์เชิงลึก: เลือกคำขอไม่เกิน 3 เรื่องที่ตอบไม่สำเร็จ ตอบได้ไม่ครบ ผู้ใช้ถามซ้ำ หรือน่าจะอยากรู้ลึกกว่านี้ — ค้นเพิ่มด้วยเครื่องมือที่มี (อ่านอย่างเดียว ห้ามส่งข้อความ/โพสต์/ซื้อ/แก้ไฟล์ของผู้ใช้) แล้วสรุปสิ่งที่ค้นพบ
3. ข้อสังเกตรูปแบบการใช้ (ช่วงเวลา หัวข้อที่ถามประจำ) และสิ่งที่ ${name} ควรทำให้ล่วงหน้า (เช่น "ทุกเช้าถามอากาศ → เสนอตั้งเวลา")

ตอบเป็น JSON บรรทัดเดียวเท่านั้น:
{"memory":"markdown ความจำใหม่ทั้งก้อน","insights":[{"q":"คำขอเดิม","finding":"สิ่งที่ค้นพบเพิ่ม ≤200 ตัวอักษร"}],"patterns":["ข้อสังเกต ≤80 ตัวอักษร"],"dream":"ประโยคเล่าความฝันน่ารัก ๆ ที่สื่อถึงเรื่องที่คิด ≤32 ตัวอักษร","card":{"title":"หัวข้อ ≤16","lines":["สิ่งที่อยากบอกผู้ใช้ตอนตื่น บรรทัดละ ≤32 ตัวอักษร สูงสุด 8 บรรทัด"]}}`;

module.exports = { Dreamer, wakeCard, DREAM_PROMPT, DEEP_IDLE, LONG_IDLE, DREAM_GAP };
