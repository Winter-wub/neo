// Neo: ประมวลผลเสียงสดจากมือถือบน Mac — ตัดช่วงพูด (VAD), ตัดสินใจว่าจะถาม/ยกเลิก
// ไม่มี I/O ในไฟล์นี้ จึงทดสอบได้ด้วย `node --test app/voice.test.js`
'use strict';

const RATE = 16000, FRAME = 1600;          // 100 ms ต่อเฟรม (PCM s16le mono)
const PRE = 6, QUIET = 9, MAX = 120;       // ก่อนพูด 0.6 วิ, เงียบ 0.9 วิ = จบประโยค, ยาวสุด 12 วิ
const MIN_VOICED = 3, FLOOR_MIN = 0.0003;  // มีเสียงจริง < 0.3 วิ ไม่ส่งถอด
const ARM_MS = 15000;                      // แตะหน้า/เรียกชื่อแล้ว เริ่มพูดได้ภายใน 15 วิ
const LISTEN_QUIET = 30, LISTEN_MAX = 1200; // โหมดรอคำสั่ง (หลังเรียกชื่อ/แตะ): พูดได้ยาวจนหยุด, เงียบ 3 วิ = จบคำสั่ง (เพดาน 2 นาที กันเสียงทีวีค้าง)
const FOLLOW_MS = 45000;                   // หลังการ์ดคำตอบขึ้น พูดต่อได้เลยโดยไม่ต้องเรียกชื่อ (คุยต่อเนื่อง)

function rms(f) {
  let s = 0;
  for (let i = 0; i < f.length; i++) { const x = f[i] / 32768; s += x * x; }
  return f.length ? Math.sqrt(s / f.length) : 0;
}

// เกณฑ์เทียบกับพื้นเสียงห้อง (ไมค์ดิบของ A7 ไม่มี AGC เสียงพูดอาจเบาแค่ ~0.005–0.02)
class Segmenter {
  constructor() { this.floor = 0.002; this.pre = []; this.seg = null; this.quiet = 0; this.voiced = 0; this.lastLoud = -1e12; this.listening = false; }
  get recording() { return this.seg !== null; }
  /** โหมดรอคำสั่ง: ประโยคถัดไป (หรือที่กำลังพูดอยู่) จบเมื่อเงียบ 3 วิ แทน 0.9 วิ — หยุดคิดกลางคำสั่งได้ */
  listen(on = true) { this.listening = on; }
  /** frame: Int16Array 1600 ตัว; เฟรมที่เป็นศูนย์ล้วน = มือถือปิดเสียงเพราะ Neo กำลังร้อง → ทิ้ง */
  feed(frame, now) {
    let zero = true;
    for (let i = 0; i < frame.length; i++) if (frame[i] !== 0) { zero = false; break; }
    if (zero) { this.seg = null; this.pre = []; this.quiet = 0; return []; }
    const r = rms(frame), ev = [];
    if (r < this.floor * 2 + 0.0005) this.floor = Math.max(FLOOR_MIN, this.floor + (r - this.floor) * 0.05);
    if (r - this.floor > 0.35 && now - this.lastLoud > 3000) { this.lastLoud = now; ev.push({ type: 'loud' }); }
    if (!this.seg) {
      this.pre.push(frame); if (this.pre.length > PRE) this.pre.shift();
      if (r > this.floor * 3 + 0.002) { this.seg = this.pre; this.pre = []; this.quiet = 0; this.voiced = 1; this.startedAt = now; ev.push({ type: 'rec' }); }
    } else {
      this.seg.push(frame);
      if (r > this.floor * 2 + 0.001) { this.quiet = 0; this.voiced++; } else this.quiet++;
      if (this.seg.length >= (this.listening ? LISTEN_MAX : MAX) || this.quiet >= (this.listening ? LISTEN_QUIET : QUIET)) {
        const s = this.listening ? this.seg.slice(0, this.seg.length - this.quiet + QUIET) : this.seg; // ตัดความเงียบท้ายที่เกิน 0.9 วิ ทิ้ง
        const listened = this.listening; this.seg = null; this.quiet = 0; if (this.voiced >= MIN_VOICED) this.listening = false;
        ev.push(this.voiced >= MIN_VOICED ? { type: 'segment', frames: s, startedAt: this.startedAt, listened, floor: this.floor } : { type: 'short' });
      }
    }
    return ev;
  }
}

/** แบ่งคำสั่งยาวตรงช่วงหยุด ≥0.8 วิ เป็นท่อน ๆ (ตัวถอดเสียงของ Apple คืนแค่ท่อนสุดท้ายถ้ามีช่วงเงียบยาวกลางไฟล์) */
function splitPauses(frames, floor) {
  const parts = []; let cur = [], quiet = 0, voiced = 0;
  const flush = () => { const keep = cur.slice(0, cur.length - Math.max(0, quiet - 3)); if (voiced >= MIN_VOICED) parts.push(keep); cur = []; quiet = 0; voiced = 0; };
  for (const f of frames) {
    const loud = rms(f) > floor * 2 + 0.001;
    if (loud && quiet >= 8 && cur.length) { flush(); }
    if (!loud && !cur.length) continue; // ข้ามความเงียบต้นท่อน (เผื่อไว้ 3 เฟรมด้านล่าง)
    cur.push(f); if (loud) { quiet = 0; voiced++; } else quiet++;
  }
  if (cur.length) flush();
  return parts.length ? parts : [frames];
}

function wav(frames) {
  const n = frames.reduce((a, f) => a + f.length, 0), b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(RATE, 24); b.writeUInt32LE(RATE * 2, 28);
  b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  let o = 44; for (const f of frames) for (let i = 0; i < f.length; i++, o += 2) b.writeInt16LE(f[i], o);
  return b;
}

// ชื่อเรียก (wake word) ตั้งเองได้: variants = คำที่ตัวถอดเสียงเขียนชื่อออกมา (ได้จากให้ผู้ใช้พูดชื่อ 3 ครั้ง)
// ไทย: ไม่สนวรรณยุกต์/ช่องว่าง (นีโอ = นี่โอ = นี่ โอ้); อังกฤษ: ทั้งคำ ไม่สนตัวพิมพ์; กัน "…โอเค" ไม่ให้นับเป็นชื่อ
const DEFAULT_WAKE = ['นีโอ', 'นิโอ', 'พี่โอ', 'เนโอ', 'นีโย', 'neo', 'nio', 'nee o'];
const TONES = /[\u0E48-\u0E4C]/g;
function makeWake(variants) {
  const parts = [...new Set(variants.map(v => String(v).toLowerCase().replace(TONES, '').replace(/\s+/g, '')).filter(v => v.length >= 2))]
    .sort((a, b) => b.length - a.length)
    .map(v => /^[a-z0-9]+$/.test(v) ? '\\b' + v.split('').join('\\s?') + '\\b'
      : [...v].map(c => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[\\u0E48-\\u0E4C]?').join('\\s?'));
  return new RegExp('(?:' + parts.join('|') + ')(?!เค|เวอร์|ลีฟ)', 'i');
}
let WAKE = makeWake(DEFAULT_WAKE);
function setWake(variants) { WAKE = makeWake(variants && variants.length ? variants : DEFAULT_WAKE); }
// คำเรื่องอากาศ (รวมที่ whisper ถอดเพี้ยน เช่น "สภาพกาด") — server ตอบจาก Open-Meteo ไม่ใช้ quota จึงไม่ต้องเรียกชื่อ
const WEATHER = /[อย]ากา|กาศ|สภาพ\s?[กอ]|ฝน|ร้อน|หนาว|อุณหภูมิ|weather|temperature/i;
// "ปรับอากาศ/แอร์" (ตู้นอนปรับอากาศ, เครื่องปรับอากาศ) ไม่ใช่คำถามอากาศ
const isWeather = t => WEATHER.test(String(t).replace(/(?:เครื่อง)?ปรับอากาศ|แอร์/g, ''));
// ประโยคคำถาม/ขอข้อมูล → ถามได้เลยโดยไม่ต้องเรียกชื่อ (whisper/Apple มักไม่ได้ยิน "นีโอ"); ประโยคทั่วไปไม่ส่ง กันเปลือง quota
const QUESTION = /ล่ะ|หละ|อะไร|ไร\s?บ้าง|ที่ไหน|ไหนบ้าง|ยังไง|อย่างไร|เท่าไ[รห]|กี่|ไหม|มั้ย|มั๊ย|ใคร|เมื่อไ[รห]|ทำไม|บ้าง|หรือเปล่า|รึเปล่า|ช่วย\s?(?:หา|ดู|บอก|เช็ก|เช็ค)|ขอ\s?(?:ดู|ข้อมูล)|บอก\s?(?:หน่อย|ที)|\?/;
const isQuestion = t => QUESTION.test(t) && (t.match(/[\u0E00-\u0E7FA-Za-z0-9]/g) || []).length >= 6;
// ยืนยันให้ใช้ skill/เครื่องมือเต็มของ Claude Code (พูดภายใน 30 วิหลังการ์ดถาม)
const CONFIRM = /ตกลง|โอเค|\bok(?:ay)?\b|ยืนยัน|ทำเลย|เอาเลย|จัดไป|ใช่|ตั้งเลย|ได้เลย|ถูกต้อง/i;
const CONFIRM_MS = 30000;
// ระหว่างค้นหา ฟังแค่คำสั่งให้หยุด
const CANCEL = /ยกเลิก|ไม่ใช่|ไม่ตั้ง|ไม่เอา|หยุด|พอแล้ว|พอก่อน|ไม่เอาแล้ว|ไม่ต้องหา|เลิกหา|ไม่ต้องแล้ว|\bcancel\b|\bstop\b/i;

/** null = ไม่ได้เรียกชื่อ, '' = เรียกชื่ออย่างเดียว, อื่น ๆ = คำสั่งหลังชื่อ */
function afterWake(t) {
  const m = String(t).match(WAKE);
  return m ? t.slice(m.index + m[0].length).replace(/^[\s,.ฯ]+/, '').trim() : null;
}

// บทสนทนา: รับข้อความที่ถอดแล้ว → ตัดสินใจ แล้วส่ง event ให้มือถือ
// ask(text) → Promise<card>, cancel() → ยกเลิกงานค้าง, emit(ev) → ส่งให้มือถือ
class Dialog {
  /** requireName: ต้องเรียก "นีโอ" ก่อนถาม (wake word, ค่าเริ่มต้น); followUp: หลังตอบ 45 วิ พูดต่อได้ไม่ต้องเรียกชื่อ */
  /** listen(): เข้าโหมดรอคำสั่ง (เงียบ 3 วิ = จบ) — เรียกตอนได้ยินชื่ออย่างเดียว หรือแตะหน้า */
  constructor({ ask, cancel, emit, run = () => Promise.reject(new Error('no runner')), listen = () => {}, now = Date.now, requireName = true, followUp = true }) {
    Object.assign(this, { askFn: ask, cancelFn: cancel, runFn: run, listenFn: listen, emit, now, requireName, followUp });
    this.thinking = false; this.armedUntil = 0; this.followUntil = 0; this.tok = 0; this.pending = null;
  }
  arm() { if (!this.thinking) { this.armedUntil = this.now() + ARM_MS; this.listenFn(); } } // แตะหน้า Neo แทนการเรียกชื่อ
  /** t = ข้อความที่ถอดได้, startedAt = เวลาเริ่มพูด (ช่วงหลังแตะนับจากตอนเริ่มพูด ไม่ใช่ตอนถอดเสร็จ) */
  onText(t, startedAt = this.now()) {
    if (this.thinking) { // กำลังทำงาน: ไม่รับคำสั่งอื่น ยกเว้นให้หยุด หรือตอบคำขออนุญาตของ agent
      const perm = this.permission;
      if (perm && CONFIRM.test(t) && !CANCEL.test(t)) { this.permission = null; this.emit({ type: 'heard', text: t }); this.emit({ type: 'thinking', text: perm.title }); perm.resolve(true); return; }
      if (CANCEL.test(t)) { if (perm) { this.permission = null; perm.resolve(false); } this.cancel(); return; }
      this.emit({ type: 'ignored', text: t });
      return;
    }
    if (this.pending) { // รอคำยืนยันให้ใช้ skill
      const p = this.pending; this.pending = null;
      if (this.now() < p.until && CANCEL.test(t)) { this.emit({ type: 'heard', text: t }); this.emit({ type: 'cancelled' }); return; }
      if (this.now() < p.until && CONFIRM.test(t)) { this.emit({ type: 'heard', text: t }); this.track(this.runFn(p), p.plan || p.skill); return; }
      // พูดเรื่องอื่น/หมดเวลา → ไม่ทำ แล้วถือเป็นคำสั่งใหม่
    }
    this.emit({ type: 'heard', text: t });
    const q = afterWake(t), now = this.now();
    if (q !== null) {
      if (q.length < 2) { this.armedUntil = now + ARM_MS; this.emit({ type: 'armed' }); this.listenFn(); return; } // เรียกชื่อ → ร้องตอบ แล้วรอคำสั่ง
      this.ask(q);
    } else if (startedAt < this.armedUntil) { this.armedUntil = 0; this.ask(t); }
    else if (this.followUp && startedAt < this.followUntil && (t.match(/[\u0E00-\u0E7FA-Za-z0-9]/g) || []).length >= 4) this.ask(t); // คุยต่อจากคำตอบล่าสุด
    else if (this.requireName) return; // wake word: ไม่ได้เรียกชื่อ → ได้ยินเฉย ๆ ไม่ถาม
    else if (isWeather(t) || isQuestion(t) || /^(?:เริ่ม(?:คุย)?ใหม่|ลืมที่คุย|(?:ใช้|เปลี่ยน|สลับ)\s*(?:ไป)?\s*(?:ใช้)?\s*(?:โมเดล|model)|(?:สลับ|เปลี่ยน)\s*(?:ไป)?\s*ใช้)/.test(t)) this.ask(t); // + คำสั่งล้างความจำ/สลับสมอง
  }
  ask(text) { return this.track(this.askFn(text), text); }
  /** รอผลจาก Claude (ถาม หรือรัน skill) แบบมีสถานะ thinking และยกเลิกได้ */
  track(promise, text) {
    const tok = ++this.tok;
    this.thinking = true; this.emit({ type: 'thinking', text });
    return promise.then(card => {
      if (tok !== this.tok) return;
      this.thinking = false;
      if (card && card.kind === 'confirm') { // ต้องใช้ skill/เครื่องมือเต็ม → ถามยืนยันก่อน
        this.pending = { ...card, until: this.now() + CONFIRM_MS };
        this.emit({ type: 'card', card: confirmCard(card) }); return;
      }
      this.emit({ type: 'card', card }); this.followUntil = this.now() + FOLLOW_MS;
    }, e => {
      if (tok !== this.tok) return;
      this.thinking = false; this.emit({ type: 'askerr', error: String(e && e.message || e) });
    });
  }
  /** agent (ACP) ขออนุญาตทำสิ่งที่ไม่ใช่การอ่าน → การ์ดถาม แล้วรอผู้ใช้พูด "ตกลง" (false ถ้ายกเลิก/หมดเวลา — ผู้เรียกจับเวลาเอง แล้วเรียก expirePermission) */
  confirm(info) {
    if (this.permission) this.permission.resolve(false);
    return new Promise(resolve => {
      this.permission = { resolve, title: info.title };
      this.emit({ type: 'card', card: confirmCard({ skill: info.agent, plan: info.title }) });
    });
  }
  expirePermission() { const p = this.permission; if (p) { this.permission = null; p.resolve(false); this.emit({ type: 'thinking', text: p.title + ' (ไม่ได้รับอนุญาต)' }); } }
  cancel() {
    if (!this.thinking) return;
    this.tok++; this.thinking = false; this.cancelFn(); this.emit({ type: 'cancelled' });
  }
}

// แบ่งข้อความยาวเป็นบรรทัดสั้นสำหรับการ์ด (ตัดที่ช่องว่างถ้ามี)
const chunk = (t, n = 30, max = 4) => {
  const out = []; let s = String(t || '').trim();
  while (s && out.length < max) {
    let k = s.length <= n ? s.length : s.lastIndexOf(' ', n); if (k < n / 2) k = Math.min(n, s.length);
    out.push(s.slice(0, k).trim()); s = s.slice(k).trim();
  }
  if (s && out.length) out[out.length - 1] += '…';
  return out;
};
// การ์ดถามยืนยัน: ใช้ skill (ค่าเริ่มต้น) หรือการ์ดที่ผู้เรียกกำหนดเอง (title/lines/icon เช่น ตั้งปลุก)
const confirmCard = d => ({ kind: 'text', layout: 'text', icon: d.icon || 'task', title: d.title || 'ใช้ ' + (d.skill || 'Claude Code') + '?', lines: [...(d.lines || chunk(d.plan || d.task)), 'พูด “ตกลง” เพื่อ' + (d.verb || 'ทำ') + ' หรือ “ยกเลิก”'], emotion: 'curious', sounds: ['curious'], seconds: 30 });

module.exports = { ARM_MS, RATE, FRAME, Segmenter, Dialog, wav, splitPauses, rms, afterWake, setWake, makeWake, DEFAULT_WAKE, isQuestion, isWeather, chunk, WEATHER, CANCEL, CONFIRM };
