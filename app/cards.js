// ทำความสะอาดการ์ดก่อนส่งให้มือถือ: ผลจากเครื่องมือบางทีหลุดมาเป็น JSON/markdown/โค้ด → แปลงเป็นภาษาคนอ่านบนจอเล็ก
// + ตรวจภาพ pixel ที่ AI วาด (layout "pixel")

const LINE_MAX = 40, LINES_MAX = 14;

/** ข้อความบรรทัดเดียวที่คนอ่าน: ตัด markdown, ลิงก์ยาว → โดเมน, escape, วงเล็บ JSON */
function plain(s) {
  return String(s ?? '')
    .replace(/```[a-z]*|```/gi, ' ')
    .replace(/\[([^\]]+)\]\((?:https?:\/\/)?[^)]+\)/g, '$1')                   // [ข้อความ](ลิงก์)
    .replace(/https?:\/\/(?:www\.)?([^/\s]+)[^\s]*/g, '$1')                    // ลิงก์ → โดเมน
    .replace(/\\[nrt]/g, ' ').replace(/\\(["'\\/])/g, '$1').replace(/\\u([0-9a-f]{4})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/(^|\s)#{1,6}\s+/g, '$1').replace(/\*\*|__|`|~~/g, '').replace(/^\s*[-*•]\s+/, '')
    .replace(/[{}[\]]/g, ' ').replace(/"\s*:\s*/g, ': ').replace(/"/g, '').replace(/\s*,\s*(?=\S+:)/g, ' · ')
    .replace(/\s+/g, ' ').trim();
}

const looksJson = s => /^\s*[[{]/.test(s) || /"\s*:\s*["\d[{tfn]/.test(s);
// คีย์ที่เป็นเรื่องภายใน ไม่ต้องโชว์
const SKIP_KEY = /^(id|uuid|_id|url|href|link|icon|type|kind|created_?at|updated_?at|timestamp|self|avatar|thumbnail|raw)$/i;
const label = k => String(k).replace(/[_-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').trim();

/** JSON (object/array) → บรรทัดภาษาคน: "ชื่อ: ค่า", รายการซ้อนกันแบนลงทีละชั้น */
function flatten(v, out = [], prefix = '', depth = 0) {
  if (out.length >= LINES_MAX * 2 || depth > 3) return out;
  if (v == null || v === '') return out;
  if (Array.isArray(v)) {
    if (v.every(x => x == null || typeof x !== 'object')) { if (v.length) out.push((prefix ? prefix + ': ' : '') + v.filter(x => x != null).join(', ')); return out; }
    for (const x of v.slice(0, LINES_MAX)) flatten(x, out, '', depth + 1);
    return out;
  }
  if (typeof v === 'object') {
    const e = Object.entries(v).filter(([k, x]) => !SKIP_KEY.test(k) && x != null && x !== '');
    // วัตถุเล็ก ๆ ที่มีชื่อ/หัวข้อ → บรรทัดเดียว "ชื่อ — รายละเอียด"
    const name = e.find(([k]) => /^(name|title|summary|label|text|subject|headline)$/i.test(k));
    const simple = e.filter(([, x]) => typeof x !== 'object');
    if (name && e.length <= 4 && simple.length === e.length) {
      const rest = simple.filter(x => x !== name).map(([, x]) => x).join(' · ');
      out.push(String(name[1]) + (rest ? ' — ' + rest : '')); return out;
    }
    for (const [k, x] of e) {
      if (typeof x === 'object') { if (!Array.isArray(x) || x.some(y => y && typeof y === 'object')) out.push(label(k) + ':'); flatten(x, out, Array.isArray(x) && !x.some(y => y && typeof y === 'object') ? label(k) : '', depth + 1); }
      else out.push(label(k) + ': ' + x);
    }
    return out;
  }
  out.push((prefix ? prefix + ': ' : '') + String(v));
  return out;
}

/** แบ่งบรรทัดยาวที่ช่องว่าง */
function wrap(s, n = LINE_MAX) {
  const out = []; let t = s;
  while (t.length > n) { let k = t.lastIndexOf(' ', n); if (k < n / 2) k = n; out.push(t.slice(0, k).trim()); t = t.slice(k).trim(); }
  if (t) out.push(t);
  return out;
}

/** บรรทัดดิบ (อาจเป็น JSON) → บรรทัดที่อ่านได้ */
function readable(line) {
  const s = String(line ?? '');
  if (looksJson(s)) { try { return flatten(JSON.parse(s)).map(plain).filter(Boolean); } catch {} }
  return [plain(s)].filter(Boolean);
}

/** ตรวจภาพ pixel: palette {ตัวอักษร: "#rrggbb"}, frames [[แถว…]] — คืนภาพที่ใช้ได้ หรือ null */
function pixelArt(c) {
  const w = Math.round(+c.w), h = Math.round(+c.h);
  if (!(w >= 4 && w <= 64 && h >= 4 && h <= 48)) return null;
  const palette = {};
  for (const [k, v] of Object.entries(c.palette || {}).slice(0, 16)) if (k.length === 1 && k !== '.' && k !== ' ' && /^#[0-9a-f]{6}$/i.test(String(v))) palette[k] = String(v).toLowerCase();
  if (!Object.keys(palette).length) return null;
  let frames = Array.isArray(c.frames) ? c.frames : Array.isArray(c.pixels) ? [c.pixels] : [];
  if (frames.length && typeof frames[0] === 'string') frames = [frames]; // ส่งมาเฟรมเดียวแบบไม่ห่อ
  frames = frames.slice(0, 12).filter(Array.isArray).map(f => {
    const rows = f.slice(0, h).map(r => String(r).slice(0, w).padEnd(w, '.').replace(/[^\S]/g, '.'));
    while (rows.length < h) rows.push('.'.repeat(w));
    return rows.map(r => [...r].map(ch => palette[ch] ? ch : '.').join(''));
  }).filter(f => f.some(r => /[^.]/.test(r)));
  if (!frames.length) return null;
  return { w, h, palette, frames, fps: Math.max(1, Math.min(12, Math.round(+c.fps) || 3)) };
}

/** การ์ดที่ส่งให้มือถือ/console — ภาษาคน, ความยาวพอดีจอ */
function humanize(card) {
  if (!card || typeof card !== 'object') return card;
  const c = { ...card };
  if (c.layout === 'pixel') {
    const art = pixelArt(c);
    if (art) return { kind: 'text', layout: 'pixel', icon: c.icon || 'text', title: plain(c.title).slice(0, 24), lines: [], items: [], emotion: c.emotion || 'proud', sounds: c.sounds || ['happy'], seconds: Math.max(10, Math.min(90, +c.seconds || 25)), ...art };
    c.layout = 'text'; c.lines = ['วาดไม่สำเร็จ ลองใหม่อีกทีนะ']; c.emotion = 'confused';
  }
  c.title = plain(c.title).slice(0, 30);
  if (c.big != null) c.big = plain(c.big).slice(0, 14);
  const lines = [];
  for (const l of Array.isArray(c.lines) ? c.lines : c.lines ? [c.lines] : []) for (const r of readable(l)) lines.push(...wrap(r));
  c.lines = lines.slice(0, LINES_MAX);
  if (lines.length > LINES_MAX) c.lines[LINES_MAX - 1] = c.lines[LINES_MAX - 1].replace(/.{0,2}$/, '…');
  if (Array.isArray(c.items)) {
    const items = [];
    for (const it of c.items) {
      let t = it && typeof it === 'object' ? (it.t ?? it.text ?? '') : it, v = it && typeof it === 'object' ? (it.v ?? it.value ?? '') : '';
      if (typeof v === 'object') v = flatten(v).join(' · ');
      t = plain(typeof t === 'object' ? flatten(t).join(' · ') : t); v = plain(v);
      if (t || v) items.push({ t: t.slice(0, 40), v: v.slice(0, 20) });
    }
    c.items = items.slice(0, LINES_MAX);
  }
  if (c.layout === 'list' && !c.items.length) c.layout = 'text';
  if (!c.lines.length && !(c.items || []).length && !c.big) c.lines = ['(ไม่มีรายละเอียด)'];
  return c;
}

module.exports = { humanize, plain, flatten, readable, pixelArt };
