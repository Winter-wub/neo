// นาฬิกาปลุก / เตือน / งานตั้งเวลา (cron) ของ Neo — เก็บใน NEO_HOME/schedule.json, ตรวจทุก 15 วิ
// job: { id, kind: 'alarm'|'task', title, prompt?, at? (ms ครั้งเดียว) | cron? ("m h dom mon dow"), enabled, last? }
const fs = require('fs');

/* ---------- cron 5 ช่อง: นาที ชั่วโมง วันที่ เดือน วันในสัปดาห์ (0=อาทิตย์) — รองรับ * , - / ---------- */
function field(s, lo, hi) {
  const out = new Set();
  for (const part of String(s).split(',')) {
    const m = part.match(/^(\*|\d+)(?:-(\d+))?(?:\/(\d+))?$/);
    if (!m) throw new Error('cron ไม่ถูกต้อง: ' + part);
    let a = m[1] === '*' ? lo : +m[1], b = m[2] != null ? +m[2] : m[1] === '*' || m[3] ? hi : a;
    const step = m[3] ? +m[3] : 1;
    if (a < lo || b > hi || a > b || step < 1) throw new Error('cron เกินช่วง: ' + part);
    for (let i = a; i <= b; i += step) out.add(hi === 7 && i === 7 ? 0 : i);
  }
  return out;
}
function parseCron(expr) {
  const f = String(expr).trim().split(/\s+/);
  if (f.length !== 5) throw new Error('cron ต้องมี 5 ช่อง: นาที ชั่วโมง วันที่ เดือน วันในสัปดาห์');
  return { m: field(f[0], 0, 59), h: field(f[1], 0, 23), dom: field(f[2], 1, 31), mon: field(f[3], 1, 12), dow: field(f[4], 0, 7), anyDom: f[2] === '*', anyDow: f[4] === '*' };
}
function cronMatch(c, d) {
  if (!c.m.has(d.getMinutes()) || !c.h.has(d.getHours()) || !c.mon.has(d.getMonth() + 1)) return false;
  const dom = c.dom.has(d.getDate()), dow = c.dow.has(d.getDay());
  return c.anyDom || c.anyDow ? dom && dow : dom || dow; // แบบ cron มาตรฐาน: ระบุทั้งคู่ = อย่างใดอย่างหนึ่ง
}
/** เวลาครั้งถัดไปหลัง from (ms) — หาไม่เกิน 400 วัน */
function nextRun(job, from = Date.now()) {
  if (job.at) return job.at > from ? job.at : null;
  const c = parseCron(job.cron), d = new Date(from); d.setSeconds(0, 0); d.setMinutes(d.getMinutes() + 1);
  for (let i = 0; i < 400 * 1440; i++, d.setMinutes(d.getMinutes() + 1)) {
    if (!c.h.has(d.getHours())) { d.setMinutes(59); continue; } // ข้ามทั้งชั่วโมง
    if (cronMatch(c, d)) return d.getTime();
  }
  return null;
}

/* ---------- เวลาภาษาไทยจากเสียงพูด ---------- */
const DIG = { หนึ่ง: 1, เอ็ด: 1, สอง: 2, ยี่: 2, สาม: 3, สี่: 4, ห้า: 5, หก: 6, เจ็ด: 7, แปด: 8, เก้า: 9 };
const UNIT = '(?:หนึ่ง|สอง|สาม|สี่|ห้า|หก|เจ็ด|แปด|เก้า)';
/** คำอ่านตัวเลข (ไม่เกิน 99) + เลขไทย → เลขอารบิก */
function digits(t) {
  t = String(t).replace(/[๐-๙]/g, c => String('๐๑๒๓๔๕๖๗๘๙'.indexOf(c)));
  return t.replace(new RegExp(`(?:(${UNIT}|ยี่)?สิบ(เอ็ด|${UNIT})?|(${UNIT}))`, 'g'), (m, tens, ones, solo) => {
    if (solo) return String(DIG[solo]);
    return String((tens ? DIG[tens] : 1) * 10 + (ones ? DIG[ones] : 0));
  });
}
const DAYS = { อาทิตย์: 0, จันทร์: 1, อังคาร: 2, พุธ: 3, พฤหัส: 4, พฤหัสบดี: 4, ศุกร์: 5, เสาร์: 6 };
const DAY_RE = 'อาทิตย์|จันทร์|อังคาร|พุธ|พฤหัส(?:บดี)?|ศุกร์|เสาร์';

/** หาเวลา (ชั่วโมง:นาที) ในประโยค คืน { h, m, span } หรือ null — span = ส่วนที่ใช้ไป (ไว้ตัดออกจากชื่องาน) */
function clockOf(t) {
  const M = '(?:\\s*(ครึ่ง|(\\d{1,2})\\s*(?:นาที)?))?';
  const rules = [
    [/(\d{1,2})\s*[:.]\s*(\d{2})\s*(?:น\.|นาฬิกา)?/, m => [+m[1], +m[2]]],
    [/(\d{1,2})\s*นาฬิกา(?:\s*(\d{1,2})\s*นาที)?/, m => [+m[1], +(m[2] || 0)]],
    [new RegExp('เที่ยงคืน' + M), m => [0, mins(m[1], m[2])]],
    [new RegExp('เที่ยง(?:วัน)?' + M), m => [12, mins(m[1], m[2])]],
    [new RegExp('ตี\\s*(\\d{1,2})' + M), m => [+m[1] % 12, mins(m[2], m[3])]],
    [new RegExp('บ่าย\\s*(\\d{1,2})?\\s*โมง(?:เย็น)?' + M), m => [12 + (+(m[1] || 1) % 12), mins(m[2], m[3])]],
    [new RegExp('บ่าย\\s*(\\d{1,2})(?!\\s*(?:นาที|ชั่วโมง|วัน))' + M), m => [12 + (+m[1] % 12), mins(m[2], m[3])]], // "บ่ายสอง" ไม่มีโมง
    [new RegExp('(\\d{1,2})\\s*โมง\\s*เย็น' + M), m => [12 + (+m[1] % 12), mins(m[2], m[3])]],
    [new RegExp('(\\d{1,2})\\s*โมง\\s*เช้า' + M), m => [+m[1] % 12, mins(m[2], m[3])]],
    [new RegExp('(\\d{1,2})\\s*ทุ่ม' + M), m => [(18 + +m[1]) % 24, mins(m[2], m[3])]],
    [new RegExp('(\\d{1,2})\\s*โมง' + M), m => { const h = +m[1]; return [h >= 6 && h <= 12 ? h : h < 6 ? h + 12 : h, mins(m[2], m[3])]; }], // 6-12 โมง = เช้า, 1-5 โมง = บ่าย
  ];
  for (const [re, f] of rules) {
    const m = t.match(re);
    if (m) { const [h, mm] = f(m); if (h >= 0 && h < 24 && mm >= 0 && mm < 60) return { h, m: mm, span: m[0] }; }
  }
  return null;
}
const mins = (half, n) => half === 'ครึ่ง' ? 30 : n ? +n : 0;

const ALARM_RE = /(?:ตั้ง)?(?:นาฬิกา)?ปลุก|(?:ช่วย)?เตือน(?:ความจำ)?|(?:ตั้ง)?เวลาเตือน/;
const REPEAT_RE = new RegExp(`ทุก\\s*(?:วัน\\s*)?(?:${DAY_RE})|ทุกวัน(?:ทำงาน|ธรรมดา)|วันธรรมดา|จันทร์\\s*(?:ถึง|-)\\s*ศุกร์|ทุก\\s*(?:เสาร์\\s*อาทิตย์|วันหยุด|สุดสัปดาห์)|ทุก\\s*วัน|ทุก\\s*เช้า|ทุก\\s*เย็น|ทุก\\s*คืน`);
const TASK_RE = /ตั้งเวลา(?:ให้)?|ตั้งงาน/;
const WORK_RE = /เช็ค|เช็ก|ค้นหา|ค้น|หาข้อมูล|หา(?:ให้|ดู)|สรุป|ตรวจ|google|กูเกิ้?ล|browser|เบราว์เซอร์|เว็บ|ราคา|ตั๋ว|จอง|ไปดู|ดูให้|เปิด|รายงาน|อ่าน|เทียบ/i;

/**
 * แปลคำสั่งเสียงเรื่องเวลา (หลังตัดชื่อเรียกแล้ว) — ไม่ใช่เรื่องนี้คืน null
 * คืน { action: 'add', job } | { action: 'list' } | { action: 'clear', kind? } | { error }
 */
function fromSpeech(text, now = Date.now()) {
  const t = digits(String(text).trim());
  if (/(?:ยกเลิก|ลบ|ปิด|เลิก)\s*(?:นาฬิกา)?(?:ปลุก|การเตือน|เตือน|งานตั้งเวลา|ตั้งเวลา)/.test(t)) return { action: 'clear', kind: /ตั้งเวลา|งาน/.test(t) ? 'task' : /ทั้งหมด/.test(t) ? null : 'alarm' };
  if (/(?:มี|ดู|เช็ค|เช็ก)\s*(?:นาฬิกา)?(?:ปลุก|การเตือน|เตือน|งานตั้งเวลา|ตั้งเวลา).*(?:อะไร|บ้าง|ไหม|มั้ย)|(?:ตั้ง)?(?:ปลุก|เตือน)ไว้(?:กี่โมง|อะไร|บ้าง)/.test(t)) return { action: 'list' };
  const alarm = ALARM_RE.test(t), rep = t.match(REPEAT_RE), task = TASK_RE.test(t);
  // ทุก N นาที / ทุกชั่วโมง (งานวน)
  const every = t.match(/ทุก\s*(?:(\d{1,3})\s*)?(นาที|ชั่วโมง|ชม\.?)/);
  // อีก N นาที/ชั่วโมง (ครั้งเดียว)
  const rel = t.match(/(?:ใน)?อีก\s*(\d{1,3}|ครึ่ง)\s*(นาที|ชั่วโมง|ชม\.?)(?:\s*(ครึ่ง))?/);
  if (!alarm && !task && !(rep || every)) return null;
  const clock = clockOf(t);
  if (!clock && !rel && !every) return null; // ไม่รู้เวลาแน่ชัด → ให้ AI ตีความ (intent schedule)
  if (!alarm && !task && every && !rep && !clock) { /* "ทุก 30 นาที ดู…" = งานวน */ }
  else if (!alarm && !task && !clock) return null;

  let job = { kind: alarm ? 'alarm' : 'task', enabled: true };
  const spans = [];
  if (every && !rel) {
    const n = +(every[1] || 1), hour = /ชั่วโมง|ชม/.test(every[2]);
    if (!hour && (n < 1 || n > 59)) return { error: 'ทุกกี่นาทีได้ 1–59 นาที' };
    job.cron = hour ? `0 ${n > 1 ? '*/' + n : '*'} * * *` : `*/${n} * * * *`; spans.push(every[0]);
  } else if (rel) {
    const n = rel[1] === 'ครึ่ง' ? 0.5 : +rel[1], hour = /ชั่วโมง|ชม/.test(rel[2]);
    job.at = now + Math.round((n + (rel[3] ? 0.5 : 0)) * (hour ? 3600000 : 60000)); spans.push(rel[0]);
  } else {
    spans.push(clock.span);
    if (rep) {
      spans.push(rep[0]);
      const r = rep[0], day = r.match(new RegExp(DAY_RE));
      const dow = /ทำงาน|ธรรมดา|จันทร์\s*(?:ถึง|-)\s*ศุกร์/.test(r) ? '1-5' : /เสาร์\s*อาทิตย์|วันหยุด|สุดสัปดาห์/.test(r) ? '0,6' : day ? String(DAYS[day[0]]) : '*';
      job.cron = `${clock.m} ${clock.h} * * ${dow}`;
    } else {
      const d = new Date(now); d.setHours(clock.h, clock.m, 0, 0);
      const plus = /มะรืน/.test(t) ? 2 : /พรุ่งนี้/.test(t) ? 1 : 0;
      const wd = t.match(new RegExp(`วัน\\s*(${DAY_RE})`));
      if (plus) d.setDate(d.getDate() + plus);
      else if (wd) { const want = DAYS[wd[1]]; let k = (want - d.getDay() + 7) % 7; if (k === 0 && d.getTime() <= now) k = 7; d.setDate(d.getDate() + k); spans.push(wd[0]); }
      else if (d.getTime() <= now) d.setDate(d.getDate() + 1); // เลยเวลาแล้ว = พรุ่งนี้
      job.at = d.getTime();
    }
  }
  // ชื่องาน/สิ่งที่ให้ทำ = ส่วนที่เหลือหลังตัดเวลา/คำสั่ง
  let rest = t;
  for (const s of spans) rest = rest.replace(s, ' ');
  rest = rest.replace(/(?:ช่วย|ขอ|ฝาก|รบกวน)(?=\s*(?:ปลุก|เตือน|ตั้ง|$))|พรุ่งนี้|มะรืน(?:นี้)?|วันนี้|คืนนี้|เช้านี้|ตอน|เวลา|ด้วย(?:นะ|ครับ|ค่ะ|คะ)?|หน่อย|นะ(?:ครับ|คะ|ค่ะ)?|ครับ|ค่ะ|คะ|จ้า|จ๊ะ/g, ' ')
    .replace(ALARM_RE, ' ').replace(TASK_RE, ' ').replace(/^\s*(?:ให้|ว่า|ไป|มา)\s*/, '').replace(/\s+/g, ' ').trim()
    .replace(/^(?:ให้|ว่า)\s*/, '').trim();
  if (job.kind === 'alarm' && WORK_RE.test(rest) && rest.length > 6) { job.kind = 'task'; job.notify = true; } // "เตือน 9 โมง ไปเช็คตั๋วใน google" = ไปทำให้ แล้วร้องเรียก
  if (job.kind === 'alarm') job.title = rest.length >= 2 ? rest.slice(0, 60) : (/เตือน/.test(t) ? 'เตือน' : 'ปลุก');
  else {
    if (rest.length < 3) return { error: 'ตั้งเวลาแล้วให้ทำอะไร? เช่น "ทุกเช้า 7 โมง สรุปข่าววันนี้"' };
    job.title = rest.slice(0, 60); job.prompt = rest.slice(0, 300);
  }
  return { action: 'add', job };
}

/* ---------- คำบอกเวลาแบบคนอ่าน ---------- */
const DOW_TH = ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'];
const MON_TH = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const hm = d => String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
/** "07:30 ทุกวัน", "พรุ่งนี้ 07:30", "ทุก 15 นาที" */
function describe(job, now = Date.now()) {
  if (job.at) {
    const d = new Date(job.at), t0 = new Date(now); t0.setHours(0, 0, 0, 0);
    const day = Math.floor((new Date(job.at).setHours(0, 0, 0, 0) - t0.getTime()) / 86400000);
    return (day === 0 ? 'วันนี้ ' : day === 1 ? 'พรุ่งนี้ ' : `${DOW_TH[d.getDay()]} ${d.getDate()} ${MON_TH[d.getMonth()]} `) + hm(d);
  }
  const f = String(job.cron).split(/\s+/);
  if (/^\*\/\d+$/.test(f[0]) && f[1] === '*') return `ทุก ${f[0].slice(2)} นาที`;
  if (f[0] === '0' && /^\*(\/\d+)?$/.test(f[1])) return f[1] === '*' ? 'ทุกชั่วโมง' : `ทุก ${f[1].slice(2)} ชั่วโมง`;
  if (/^\d+$/.test(f[0]) && /^\d+$/.test(f[1]) && f[2] === '*' && f[3] === '*') {
    const t = String(f[1]).padStart(2, '0') + ':' + String(f[0]).padStart(2, '0');
    const days = { '*': 'ทุกวัน', '1-5': 'วันธรรมดา', '0,6': 'เสาร์-อาทิตย์', '6,0': 'เสาร์-อาทิตย์' }[f[4]] || 'ทุก ' + [...field(f[4], 0, 7)].map(i => DOW_TH[i]).join(' ');
    return t + ' ' + days;
  }
  return 'cron ' + job.cron;
}

/* ---------- ตัวตั้งเวลา ---------- */
class Scheduler {
  /** fire(job) เรียกเมื่อถึงเวลา; file = ที่เก็บ (null = ไม่บันทึก ใช้ในเทส) */
  constructor(file, fire, now = Date.now) {
    Object.assign(this, { file, fire, now });
    this.jobs = [];
    if (file) try { this.jobs = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
    this.timer = null;
  }
  start() { this.check(); this.timer = setInterval(() => this.check(), 15000); return this; }
  stop() { clearInterval(this.timer); }
  save() { if (this.file) fs.writeFileSync(this.file, JSON.stringify(this.jobs, null, 1), { mode: 0o600 }); }
  list() { const now = this.now(); return this.jobs.map(j => ({ ...j, next: j.enabled ? nextRun(j, now - 60000 < (j.last || 0) ? now : now - 1) : null, when: describe(j, now) })); }
  add(j) {
    const job = { id: Math.random().toString(36).slice(2, 10), kind: j.kind === 'task' ? 'task' : 'alarm', title: String(j.title || (j.kind === 'task' ? 'งาน' : 'ปลุก')).slice(0, 80), enabled: j.enabled !== false };
    if (job.kind === 'task') { job.prompt = String(j.prompt || j.title || '').slice(0, 1000); if (!job.prompt.trim()) throw new Error('งานตั้งเวลาต้องบอกว่าให้ทำอะไร'); }
    if (j.cron) { parseCron(j.cron); job.cron = String(j.cron).trim(); }
    else if (Number.isFinite(+j.at) && +j.at > this.now()) job.at = +j.at;
    else throw new Error('ต้องระบุเวลา (at) ในอนาคต หรือ cron');
    this.jobs.push(job); this.save(); return job;
  }
  update(id, patch) {
    const j = this.jobs.find(x => x.id === id); if (!j) throw new Error('ไม่พบงานนี้');
    if (typeof patch.enabled === 'boolean') j.enabled = patch.enabled;
    if (typeof patch.title === 'string') j.title = patch.title.slice(0, 80);
    if (typeof patch.prompt === 'string' && j.kind === 'task') j.prompt = patch.prompt.slice(0, 1000);
    if (patch.cron) { parseCron(patch.cron); j.cron = String(patch.cron).trim(); delete j.at; }
    else if (patch.at) { if (+patch.at <= this.now()) throw new Error('เวลาต้องอยู่ในอนาคต'); j.at = +patch.at; delete j.cron; }
    this.save(); return j;
  }
  remove(id) { const n = this.jobs.length; this.jobs = this.jobs.filter(j => j.id !== id); this.save(); return n !== this.jobs.length; }
  clear(kind) { const n = this.jobs.length; this.jobs = this.jobs.filter(j => kind && j.kind !== kind); this.save(); return n - this.jobs.length; }
  check() {
    const now = this.now(), d = new Date(now), minute = Math.floor(now / 60000);
    let changed = false;
    for (const j of [...this.jobs]) {
      if (!j.enabled) continue;
      if (j.at) {
        if (j.at <= now) { this.jobs = this.jobs.filter(x => x !== j); changed = true; if (now - j.at < 30 * 60000) this.fire(j); } // ปิดเครื่องนานเกิน 30 นาที = ไม่ปลุกย้อนหลัง
      } else if (Math.floor((j.last || 0) / 60000) !== minute) {
        let c; try { c = parseCron(j.cron); } catch { continue; }
        if (cronMatch(c, d)) { j.last = now; changed = true; this.fire(j); }
      }
    }
    if (changed) this.save();
  }
}

module.exports = { Scheduler, parseCron, cronMatch, nextRun, fromSpeech, clockOf, digits, describe };
