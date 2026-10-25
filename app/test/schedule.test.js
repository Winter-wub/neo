const test = require('node:test');
const assert = require('node:assert');
const { fromSpeech, digits, parseCron, nextRun, Scheduler, describe } = require('../schedule');

// พุธ 22 ต.ค. 2026 10:00 เวลาเครื่อง
const NOW = new Date(2026, 9, 21, 10, 0, 0).getTime();
const at = r => { const d = new Date(r.job.at); return [d.getDate(), d.getHours(), d.getMinutes()]; };

test('คำอ่านตัวเลขไทย', () => {
  assert.strictEqual(digits('เจ็ดโมงครึ่ง'), '7โมงครึ่ง');
  assert.strictEqual(digits('สิบเอ็ดโมง ยี่สิบห้านาที'), '11โมง 25นาที');
  assert.strictEqual(digits('สองทุ่ม'), '2ทุ่ม');
  assert.strictEqual(digits('๗ โมง'), '7 โมง');
});

test('ปลุกครั้งเดียว: เวลาไทยแบบต่าง ๆ', () => {
  assert.deepStrictEqual(at(fromSpeech('ปลุก 7 โมงครึ่ง', NOW)), [22, 7, 30]); // เลยแล้ววันนี้ → พรุ่งนี้
  assert.deepStrictEqual(at(fromSpeech('ปลุกบ่ายสองโมง', NOW)), [21, 14, 0]);
  assert.deepStrictEqual(at(fromSpeech('ตั้งปลุกตีห้า', NOW)), [22, 5, 0]);
  assert.deepStrictEqual(at(fromSpeech('เตือนให้กินยาตอนสองทุ่ม', NOW)), [21, 20, 0]);
  assert.deepStrictEqual(at(fromSpeech('ปลุก 6 โมงเย็น', NOW)), [21, 18, 0]);
  assert.deepStrictEqual(at(fromSpeech('ปลุกพรุ่งนี้ 11:15', NOW)), [22, 11, 15]);
  assert.deepStrictEqual(at(fromSpeech('ปลุกเที่ยง', NOW)), [21, 12, 0]);
  assert.strictEqual(fromSpeech('เตือนอีก 10 นาที', NOW).job.at, NOW + 600000);
  assert.strictEqual(fromSpeech('เตือนให้กินยาตอนสองทุ่ม', NOW).job.title, 'กินยา');
  assert.strictEqual(fromSpeech('ช่วยปลุกตีห้าครึ่งหน่อย', NOW).job.title, 'ปลุก');
  assert.strictEqual(fromSpeech('ช่วยเตือนประชุมทีมบ่ายสองนะ', NOW).job.title, 'ประชุมทีม');
});

test('ปลุกซ้ำ / งานตั้งเวลา → cron', () => {
  assert.strictEqual(fromSpeech('ปลุกทุกวันธรรมดา 6 โมงครึ่ง', NOW).job.cron, '30 6 * * 1-5');
  assert.strictEqual(fromSpeech('ปลุกทุกวันเสาร์ 9 โมง', NOW).job.cron, '0 9 * * 6');
  const t = fromSpeech('ทุกเช้า 7 โมง สรุปข่าวเทคโนโลยี', NOW).job;
  assert.strictEqual(t.kind, 'task'); assert.strictEqual(t.cron, '0 7 * * *'); assert.strictEqual(t.prompt, 'สรุปข่าวเทคโนโลยี');
  assert.strictEqual(fromSpeech('ทุก 30 นาที ดูสถานะ agent ใน orca', NOW).job.cron, '*/30 * * * *');
});

test('ไม่ใช่เรื่องเวลา / ลบ / ดูรายการ / ไม่บอกเวลา', () => {
  assert.strictEqual(fromSpeech('อากาศวันนี้เป็นไง', NOW), null);
  assert.strictEqual(fromSpeech('ทุกวันนี้ชีวิตดีไหม', NOW), null);
  assert.strictEqual(fromSpeech('ยกเลิกปลุกทั้งหมด', NOW).action, 'clear');
  assert.strictEqual(fromSpeech('มีปลุกอะไรบ้าง', NOW).action, 'list');
  assert.strictEqual(fromSpeech('ตั้งปลุกหน่อย', NOW), null); // ไม่บอกเวลา → ให้ AI ถาม/ตีความ
  const w = fromSpeech('ช่วยเตือนพรุ่งนี้ 9 โมง ไปเช็คราคาตั๋วเครื่องบินใน google ผ่าน ego browser', NOW).job;
  assert.strictEqual(w.kind, 'task'); assert.ok(w.notify); assert.match(w.prompt, /ตั๋วเครื่องบิน/);
});

test('cron: เวลาถัดไป + คำอธิบาย', () => {
  parseCron('*/15 9-17 * * 1-5');
  assert.throws(() => parseCron('61 * * * *'));
  const n = new Date(nextRun({ cron: '30 6 * * 1-5' }, NOW)); // พุธ 10:00 → พฤหัส 06:30
  assert.deepStrictEqual([n.getDay(), n.getHours(), n.getMinutes()], [4, 6, 30]);
  assert.strictEqual(describe({ cron: '30 6 * * 1-5' }), '06:30 วันธรรมดา');
  assert.strictEqual(describe({ cron: '*/30 * * * *' }), 'ทุก 30 นาที');
  assert.strictEqual(describe({ at: NOW + 3600000 }, NOW), 'วันนี้ 11:00');
});

test('Scheduler ยิงตรงเวลา ครั้งเดียวต่อนาที; ครั้งเดียวแล้วลบทิ้ง', () => {
  let t = NOW; const fired = [];
  const s = new Scheduler(null, j => fired.push(j.title), () => t);
  s.add({ kind: 'alarm', title: 'a', at: NOW + 60000 });
  s.add({ kind: 'task', title: 'b', prompt: 'ทำ b', cron: '1 10 * * *' });
  s.check(); assert.deepStrictEqual(fired, []);
  t = NOW + 61000; s.check(); s.check();
  assert.deepStrictEqual(fired.sort(), ['a', 'b']);
  assert.strictEqual(s.jobs.length, 1);
});
