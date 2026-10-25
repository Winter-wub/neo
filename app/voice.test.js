// node --test app/voice.test.js
'use strict';
const test = require('node:test'), assert = require('node:assert');
const { Segmenter, Dialog, wav, afterWake, setWake, WEATHER, CANCEL, FRAME } = require('./voice');

let seed = 1;
const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
const gauss = () => Math.sqrt(-2 * Math.log(rand() + 1e-12)) * Math.cos(2 * Math.PI * rand());
const noise = () => Int16Array.from({ length: FRAME }, () => Math.round(gauss() * 26)); // ห้อง ~0.0008 rms (วัดจาก A7)
const speech = amp => Int16Array.from({ length: FRAME }, (_, i) => Math.round(amp * 32767 * Math.sin(i * 0.3) * (0.6 + 0.4 * Math.sin(i * 0.004)) + gauss() * 26));

function run(s, frames) { const ev = []; let t = 0; for (const f of frames) { ev.push(...s.feed(f, t)); t += 100; } return ev; }

test('quiet A7 speech (~-43 dB) becomes one segment, noise alone does not', () => {
  const s = new Segmenter();
  assert.deepStrictEqual(run(s, Array.from({ length: 50 }, noise)), []);
  const ev = run(s, [...Array.from({ length: 20 }, () => speech(0.012)), ...Array.from({ length: 12 }, noise)]);
  assert.strictEqual(ev[0].type, 'rec');
  const seg = ev.find(e => e.type === 'segment');
  assert.ok(seg && seg.frames.length >= 25 && seg.frames.length <= 40, JSON.stringify(ev.map(e => e.type)));
  assert.ok(s.floor < 0.002);
});

test('short blip is dropped, zero frames (Neo singing) reset', () => {
  const s = new Segmenter();
  run(s, Array.from({ length: 10 }, noise));
  const ev = run(s, [speech(0.05), speech(0.05), ...Array.from({ length: 10 }, noise)]);
  assert.deepStrictEqual(ev.map(e => e.type), ['rec', 'short']);
  const s2 = new Segmenter();
  assert.deepStrictEqual(run(s2, Array.from({ length: 30 }, () => new Int16Array(FRAME))), []);
});

test('wav header', () => {
  const w = wav([Int16Array.of(1, -1), Int16Array.of(0x1234)]);
  assert.strictEqual(w.length, 50); assert.strictEqual(w.toString('ascii', 0, 4), 'RIFF');
  assert.strictEqual(w.readUInt32LE(24), 16000); assert.strictEqual(w.readUInt32LE(40), 6); assert.strictEqual(w.readInt16LE(48), 0x1234);
});

test('wake word / weather / cancel matching (real whisper outputs)', () => {
  assert.strictEqual(afterWake('นี่โอวันนี้อากาศเป็นยังไงบ้าง'), 'วันนี้อากาศเป็นยังไงบ้าง');
  assert.strictEqual(afterWake('นี่โอ้ ไปเที่ยวไหนดี'), 'ไปเที่ยวไหนดี');
  assert.strictEqual(afterWake('นีโอ'), '');
  assert.strictEqual(afterWake('พี่โอวันนี้อากาศเป็นยังไงบ้าง'), 'วันนี้อากาศเป็นยังไงบ้าง'); // Apple STT
  assert.strictEqual(afterWake('พี่โอเคนะ'), null);
  assert.strictEqual(afterWake('นี่โอเคไหม'), null);
  assert.strictEqual(afterWake('neon light'), null);
  for (const w of ['ฉันดูลี่สภาพกาดอย่างไร', 'วันนี้ยากาเป็นไงบ้าง', 'พรุ่งนี้ฝนตกไหม']) assert.ok(WEATHER.test(w), w);
  assert.ok(!WEATHER.test('ไปเที่ยวเชียงใหม่'));
  for (const c of ['ยกเลิก', 'ไม่ต้องหาแล้ว', 'พอแล้วนีโอ', 'stop']) assert.ok(CANCEL.test(c), c);
});

function dialog(opts = {}) {
  const ev = [], asks = [], runs = []; let cancels = 0, t = 1000;
  const d = new Dialog({ ...opts,
    ask: q => new Promise((res, rej) => asks.push({ q, res, rej })),
    run: p => new Promise((res, rej) => runs.push({ p, res, rej })),
    cancel: () => cancels++, emit: e => ev.push(e), now: () => t,
  });
  return { d, ev, asks, runs, cancels: () => cancels, tick: ms => { t += ms; } };
}

test('dialog: name / armed / weather / ignored', async () => {
  const x = dialog({ requireName: false });
  x.d.onText('สวัสดีจ้า'); assert.strictEqual(x.asks.length, 0);
  x.d.onText('วันนี้อากาศเป็นไง'); assert.strictEqual(x.asks[0].q, 'วันนี้อากาศเป็นไง');
  x.asks[0].res({ title: '29°C' }); await new Promise(setImmediate);
  assert.strictEqual(x.ev.at(-1).type, 'card');
  x.d.onText('นีโอ'); assert.strictEqual(x.ev.at(-1).type, 'armed');
  x.tick(3000); x.d.onText('ไปเขาใหญ่ควรไปไหน'); assert.strictEqual(x.asks[1].q, 'ไปเขาใหญ่ควรไปไหน');
  x.asks[1].res({}); await new Promise(setImmediate);
  x.d.arm(); x.tick(2000); x.d.onText('ร้านกาแฟแถวนี้'); assert.strictEqual(x.asks[2].q, 'ร้านกาแฟแถวนี้');
});

test('requireName off: questions are asked without the name; chatter is not', async () => {
  const x = dialog({ requireName: false });
  for (const t of ['เฮ้ มาแล้ว!', 'อ่ะ', 'อีก', 'สวัสดีจ้า']) x.d.onText(t);
  assert.strictEqual(x.asks.length, 0);
  x.d.onText('มีงานอะไรบ้างไนจีลาของอาทิตย์ที่แล้ว'); // ถอดจริงจาก A7
  assert.strictEqual(x.asks.length, 1);
  x.asks[0].res({}); await new Promise(setImmediate);
  x.d.onText('มีงานไรบ้างไอ้จีลา'); assert.strictEqual(x.asks.length, 2);
});

test('tap window counts from when speech started', () => {
  const x = dialog();
  x.d.arm(); x.tick(14000);
  const started = 1000 + 14000; x.tick(6000); // พูดยาว ถอดเสร็จหลังหมดเวลา แต่เริ่มพูดทัน
  x.d.onText('ส่งงานพรุ่งนี้', started); assert.strictEqual(x.asks.length, 1);
});

test('dialog: while searching only cancel is accepted', async () => {
  const x = dialog();
  x.d.onText('นีโอ ทริปเชียงใหม่สามวัน');
  x.d.onText('นีโอ อากาศเป็นไง'); x.d.onText('เปิดเพลง');
  assert.strictEqual(x.asks.length, 1);
  assert.deepStrictEqual(x.ev.slice(-2).map(e => e.type), ['ignored', 'ignored']);
  x.d.arm(); assert.strictEqual(x.d.armedUntil, 0);
  x.d.onText('ไม่ต้องหาแล้ว');
  assert.strictEqual(x.cancels(), 1); assert.strictEqual(x.ev.at(-1).type, 'cancelled');
  x.asks[0].res({ title: 'late' }); await new Promise(setImmediate);
  assert.strictEqual(x.ev.at(-1).type, 'cancelled'); // ผลที่มาช้าถูกทิ้ง
  x.d.onText('นีโอ ยกเลิก'); assert.strictEqual(x.cancels(), 1); assert.strictEqual(x.asks.length, 2);
});

const PROPOSAL = { kind: 'confirm', skill: 'mappedin-cms', plan: 'เปิด Mappedin CMS ดู external id ของร้านในเซ็นทรัลเวิลด์', task: 'ใช้ skill mappedin-cms …' };

test('skill run needs spoken confirmation, then shows thinking and result', async () => {
  const x = dialog();
  x.d.onText('นีโอ เปิด mappedin ดูร้านในเซ็นทรัลเวิลด์');
  x.asks[0].res(PROPOSAL); await new Promise(setImmediate);
  const c = x.ev.at(-1); assert.strictEqual(c.type, 'card'); assert.match(c.card.title, /mappedin-cms/);
  assert.ok(c.card.lines.at(-1).includes('ตกลง')); assert.strictEqual(x.runs.length, 0); assert.ok(!x.d.thinking);
  x.tick(5000); x.d.onText('ตกลง');
  assert.strictEqual(x.runs.length, 1); assert.ok(x.d.thinking); assert.strictEqual(x.ev.at(-1).type, 'thinking');
  x.d.onText('วันนี้อากาศเป็นไง'); assert.strictEqual(x.asks.length, 1); // ระหว่างทำ ไม่รับคำสั่งอื่น
  x.runs[0].res({ title: 'เสร็จแล้ว' }); await new Promise(setImmediate);
  assert.strictEqual(x.ev.at(-1).card.title, 'เสร็จแล้ว');
});

test('skill run: cancel while running, timeout and other speech do not run', async () => {
  const x = dialog({ requireName: false });
  const offer = async () => { x.d.onText('นีโอ เปิด mappedin'); x.asks.at(-1).res(PROPOSAL); await new Promise(setImmediate); };
  await offer(); x.d.onText('ยกเลิก'); assert.strictEqual(x.ev.at(-1).type, 'cancelled');
  await offer(); x.tick(31000); x.d.onText('ตกลง');
  await offer(); x.d.onText('วันนี้อากาศเป็นไง');
  assert.strictEqual(x.runs.length, 0); assert.strictEqual(x.asks.at(-1).q, 'วันนี้อากาศเป็นไง');
  x.asks.at(-1).res({}); await new Promise(setImmediate);
  await offer(); x.d.onText('ตกลง'); assert.strictEqual(x.runs.length, 1);
  x.d.onText('หยุดก่อน'); assert.strictEqual(x.cancels(), 1); assert.ok(!x.d.thinking);
});

test('chunk breaks lines at spaces', () => {
  const { chunk } = require('./voice');
  assert.deepStrictEqual(chunk('รัน ccusage เพื่อดูการใช้ token วันนี้แยกตามโมเดล'), ['รัน ccusage เพื่อดูการใช้', 'token วันนี้แยกตามโมเดล']);
  assert.ok(chunk('ก'.repeat(200)).at(-1).endsWith('…'));
});

test('weather place + day from Thai questions', () => {
  const { placeOf, dayOf } = require('./places');
  const q = t => { const p = placeOf(t); return p && (p.name || p.query); };
  const none = t => { const p = placeOf(t); assert.ok(!p || (p.kind === 'guess' && p.query.length >= 3), t + ' → ' + JSON.stringify(p)); };
  none('วันนี้อากาศเป็นยังไงบ้าง');
  assert.strictEqual(q('อากาศที่เชียงใหม่เป็นยังไง'), 'เชียงใหม่');
  assert.strictEqual(q('ภูเก็ตฝนตกไหม'), 'ภูเก็ต');
  assert.strictEqual(q('พรุ่งนี้โคราชร้อนไหม'), 'นครราชสีมา');
  assert.strictEqual(q('นครศรีธรรมราชฝนตกไหม'), 'นครศรีธรรมราช');
  assert.strictEqual(q('เขาใหญ่หนาวไหม'), 'เขาใหญ่');                    // พิกัดตายตัว (geocode ได้ผิดที่)
  assert.strictEqual(q('ไปปายช่วงนี้อากาศดีไหม'), 'ปาย');
  assert.strictEqual(q('อากาศที่โตเกียวเป็นไง'), 'โตเกียว');             // ไม่อยู่ในรายชื่อ → หาจากคำนำหน้า
  assert.strictEqual(q('โตเกียวอากาศเป็นไง'), 'โตเกียว');                // ถอดจริงจาก A7: ไม่มีคำนำหน้า
  assert.strictEqual(q('พรุ่งนี้โซลฝนตกไหม'), 'โซล');
  none('นีโอ อากาศเป็นไง');
  none('วันนี้อากาศดีมากเลย');
  none('ตากผ้าได้ไหม ฝนจะตกไหม');
  assert.notStrictEqual(q('ตากผ้าได้ไหม ฝนจะตกไหม'), 'ตาก');
  assert.strictEqual(q('อากาศที่ตากเป็นไง'), 'ตาก');
  none('ฝนตกแถวบ้านไหม');
  assert.strictEqual(dayOf('พรุ่งนี้ฝนตกไหม'), 1); assert.strictEqual(dayOf('มะรืนนี้'), 2); assert.strictEqual(dayOf('วันนี้'), 0);
});

test('follow-up without the name right after an answer', async () => {
  const x = dialog();
  x.d.onText('นีโอ ตั๋วรถไฟไปเชียงใหม่ชั้น 2 เท่าไหร่'); x.asks[0].res({ title: '881 บาท' }); await new Promise(setImmediate);
  x.tick(10000); x.d.onText('แล้วชั้นหนึ่งล่ะ'); assert.strictEqual(x.asks.length, 2);
  x.asks[1].res({ title: '1,253 บาท' }); await new Promise(setImmediate);
  x.tick(20000); x.d.onText('จองที่ไหนดี'); assert.strictEqual(x.asks.length, 3);
  x.asks[2].res({}); await new Promise(setImmediate);
  x.tick(46000); x.d.onText('โอเคเลยนะ'); assert.strictEqual(x.asks.length, 3); // พ้นช่วงคุยต่อแล้ว
});

test('"ปรับอากาศ" is not a weather question', () => {
  const { isWeather } = require('./voice');
  assert.ok(!isWeather('ตั๋วรถไฟไปเชียงใหม่ชั้น 2 นอนปรับอากาศเท่าไหร่')); // เจอจริงตอนทดสอบ
  assert.ok(!isWeather('ร้านซ่อมเครื่องปรับอากาศแถวนี้'));
  assert.ok(isWeather('อากาศเชียงใหม่เป็นไง')); assert.ok(isWeather('รถไฟปรับอากาศไปเชียงใหม่ ฝนตกไหม'));
});

test('ACP permission: confirm by voice while working, cancel denies and stops', async () => {
  const x = dialog();
  x.d.onText('นีโอ แก้ไฟล์ README ให้หน่อย'); assert.ok(x.d.thinking);
  const p1 = x.d.confirm({ title: 'แก้ไฟล์ README.md', agent: 'opencode' });
  assert.match(x.ev.at(-1).card.title, /opencode/); assert.ok(x.ev.at(-1).card.lines.some(l => l.includes('README')));
  x.d.onText('เปิดเพลงหน่อย'); assert.strictEqual(x.ev.at(-1).type, 'ignored');
  x.d.onText('ตกลง'); assert.strictEqual(await p1, true); assert.strictEqual(x.ev.at(-1).type, 'thinking');
  const p2 = x.d.confirm({ title: 'รันคำสั่ง rm -rf build', agent: 'opencode' });
  x.d.onText('ไม่เอา ยกเลิก'); assert.strictEqual(await p2, false); assert.strictEqual(x.cancels(), 1); assert.ok(!x.d.thinking);
  x.d.onText('นีโอ ทำอีกที'); const p3 = x.d.confirm({ title: 'x', agent: 'a' }); x.d.expirePermission(); assert.strictEqual(await p3, false);
});

test('wake word (default): only "นีโอ …", name-then-sentence, tap, or follow-up start a question', async () => {
  const x = dialog();
  for (const t of ['วันนี้อากาศเป็นยังไง', 'มีงานอะไรบ้างใน Jira', 'สลับไปใช้ opencode', 'ช่วยหาร้านกาแฟหน่อย']) x.d.onText(t);
  assert.strictEqual(x.asks.length, 0); assert.ok(x.ev.filter(e => e.type === 'heard').length === 4); // ได้ยิน แต่ไม่ถาม
  x.d.onText('นี่โอ วันนี้อากาศเป็นยังไง'); assert.strictEqual(x.asks.at(-1).q, 'วันนี้อากาศเป็นยังไง');
  x.asks.at(-1).res({ title: 'อากาศ' }); await new Promise(setImmediate);
  x.tick(10000); x.d.onText('แล้วพรุ่งนี้ล่ะ'); assert.strictEqual(x.asks.length, 2); // คุยต่อหลังตอบ
  x.asks.at(-1).res({}); await new Promise(setImmediate);
  x.tick(60000); x.d.onText('แล้วมะรืนล่ะ'); assert.strictEqual(x.asks.length, 2); // พ้นช่วงคุยต่อ ต้องเรียกชื่อ
  x.d.onText('นีโอ'); x.tick(3000); x.d.onText('สลับไปใช้ opencode'); assert.strictEqual(x.asks.at(-1).q, 'สลับไปใช้ opencode');
  x.asks.at(-1).res({}); await new Promise(setImmediate);
  x.tick(60000); x.d.arm(); x.tick(2000); x.d.onText('ร้านกาแฟแถวนี้'); assert.strictEqual(x.asks.at(-1).q, 'ร้านกาแฟแถวนี้'); // แตะหน้า
  const y = dialog({ followUp: false }); y.d.onText('นีโอ ราคาทอง'); y.asks[0].res({}); await new Promise(setImmediate);
  y.tick(5000); y.d.onText('แล้วเงินล่ะ'); assert.strictEqual(y.asks.length, 1); // ปิดคุยต่อ
});

test('listen mode: after the name, a command with pauses < 3 s stays one sentence', () => {
  const pause = n => Array.from({ length: n }, noise), talk = n => Array.from({ length: n }, () => speech(0.012));
  const s = new Segmenter();
  run(s, pause(30));
  const normal = run(s, [...talk(10), ...pause(15), ...talk(10), ...pause(12)]);
  assert.strictEqual(normal.filter(e => e.type === 'segment').length, 2); // ปกติ: หยุด 1.5 วิ = 2 ประโยค
  s.listen(true);
  const ev = run(s, [...talk(10), ...pause(15), ...talk(10), ...pause(20), ...talk(8), ...pause(32)]);
  const segs = ev.filter(e => e.type === 'segment');
  assert.strictEqual(segs.length, 1); assert.ok(segs[0].listened);
  assert.ok(segs[0].frames.length >= 38 + 15 + 20 && segs[0].frames.length < 38 + 15 + 20 + 15, String(segs[0].frames.length)); // ไม่เก็บความเงียบท้าย 3 วิ
  assert.ok(!s.listening); // จบคำสั่งแล้วกลับโหมดปกติ
});

test('name alone or tap → listen mode is requested', () => {
  let n = 0; const x = dialog({ listen: () => n++ });
  x.d.onText('นีโอ'); assert.strictEqual(n, 1); assert.strictEqual(x.ev.at(-1).type, 'armed');
  x.d.arm(); assert.strictEqual(n, 2);
  x.d.onText('นีโอ อากาศเป็นไง'); assert.strictEqual(n, 2); // ชื่อ + คำสั่งในประโยคเดียว: ถามเลย ไม่ต้องรอ
});

test('listen mode: a long command (75 s with short pauses) stays one sentence', () => {
  const s = new Segmenter(); run(s, Array.from({ length: 30 }, noise)); s.listen(true);
  const frames = []; for (let i = 0; i < 30; i++) frames.push(...Array.from({ length: 20 }, () => speech(0.012)), ...Array.from({ length: 5 }, noise));
  const ev = run(s, [...frames, ...Array.from({ length: 31 }, noise)]);
  const segs = ev.filter(e => e.type === 'segment'); assert.strictEqual(segs.length, 1); assert.ok(segs[0].frames.length > 700);
});

test('splitPauses cuts a long command at pauses ≥ 0.8 s', () => {
  const { splitPauses } = require('./voice');
  const talk = n => Array.from({ length: n }, () => speech(0.012)), pause = n => Array.from({ length: n }, noise);
  const parts = splitPauses([...pause(5), ...talk(20), ...pause(20), ...talk(15), ...pause(4), ...talk(6), ...pause(30)], 0.0008);
  assert.strictEqual(parts.length, 2); // หยุด 0.4 วิ ไม่ตัด, หยุด 2 วิ ตัด
  assert.ok(parts[0].length >= 20 && parts[0].length <= 24); assert.ok(parts[1].length >= 25 && parts[1].length <= 29);
});

test('custom wake name: variants learned from STT, tone/space-insensitive', () => {
  setWake(['โมจิ', 'โมจี้', 'mochi']);
  assert.strictEqual(afterWake('โมจิ วันนี้อากาศเป็นไง'), 'วันนี้อากาศเป็นไง');
  assert.strictEqual(afterWake('โม่จี่ เปิดเพลง'), 'เปิดเพลง');           // วรรณยุกต์ต่างกัน
  assert.strictEqual(afterWake('โม จิ ช่วยหน่อย'), 'ช่วยหน่อย');         // มีช่องว่าง
  assert.strictEqual(afterWake('Mochi, what time is it'), 'what time is it');
  assert.strictEqual(afterWake('นีโอ อากาศ'), null);                       // ชื่อเก่าใช้ไม่ได้แล้ว
  setWake(null); assert.strictEqual(afterWake('นี่โอ้ อากาศ'), 'อากาศ');   // กลับค่าเริ่มต้น
});
