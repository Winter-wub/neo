const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), os = require('os'), path = require('path');
const { Dreamer, DEEP_IDLE, LONG_IDLE } = require('../dream');

const home = () => fs.mkdtempSync(path.join(os.tmpdir(), 'neo-dream-'));

test('ฝันเมื่อไม่อยู่นาน มีเรื่องใหม่ → เก็บความจำ + การ์ดตอนตื่น', async () => {
  let t = new Date(2026, 9, 21, 14, 0).getTime(); const evs = [];
  const d = new Dreamer({ home: home(), now: () => t, emit: e => evs.push(e.type), think: async p => { assert.ok(p.includes('ราคาทอง')); return '{"memory":"## ผู้ใช้\\n- สนใจราคาทองทุกวัน ตอนเช้า","insights":[{"q":"ราคาทอง","finding":"ทองขึ้น 3 วันติด"}],"patterns":["ถามราคาทองตอนเช้า"],"dream":"ฝันว่ากองทองสูงเท่าภูเขา","card":{"title":"ตื่นแล้ว!","lines":["ทองขึ้น 3 วันติด"]}}'; } });
  d.activity(); d.record('ราคาทองวันนี้', 'บาทละ 40,000');
  assert.strictEqual(d.why(), null); // เพิ่งคุย
  t += DEEP_IDLE + 1000; assert.strictEqual(d.why(), null); // หลับลึกแล้ว แต่ยังไม่ใช่ช่วงที่ไม่อยู่ และยังไม่นานพอ
  t += LONG_IDLE; assert.ok(d.why());
  const r = await d.dream('test');
  assert.match(d.memory(), /ราคาทอง/);
  assert.strictEqual(r.card.lines[0], 'ฝันว่ากองทองสูงเท่าภูเขา');
  assert.deepStrictEqual(evs, ['dreaming', 'dream_done']);
  assert.ok(d.pending); d.delivered(); assert.strictEqual(d.pending, null);
  assert.strictEqual(d.why(), null); // เพิ่งฝัน ไม่มีเรื่องใหม่
});

test('เรียนรู้ชั่วโมงที่ผู้ใช้อยู่ → ช่วงเงียบ', () => {
  const start = new Date(2026, 9, 1, 0, 0).getTime(); let t = start;
  const d = new Dreamer({ home: home(), now: () => t, emit: () => {}, think: async () => '{}' });
  for (let day = 0; day < 7; day++) for (const h of [8, 9, 12, 18, 19, 20, 21, 22]) { t = start + day * 86400000 + h * 3600000; d.activity(t); }
  t = start + 8 * 86400000;
  const q = d.quietHours();
  assert.ok(!q.includes(19)); assert.ok(q.includes(3));
});

test('ความจำแยกเป็นข้อ บอกได้ว่ามาจากความฝันไหน + แก้/ลบได้', async () => {
  let t = new Date(2026, 9, 21, 14, 0).getTime();
  const d = new Dreamer({ home: home(), now: () => t, emit: () => {}, name: () => 'John', think: async p => { assert.ok(p.startsWith('คุณคือ "John"')); return '{"memory":"## ผู้ใช้\\n- อยู่กรุงเทพฯ\\n- ชอบแมว","dream":"ฝันถึงแมว"}'; } });
  d.setMemory('## ผู้ใช้\n- อยู่กรุงเทพฯ\n- ชอบหมา');
  d.record('ชอบแมวนะ', 'โอเค'); t += 1000;
  const r = await d.dream('test');
  assert.deepStrictEqual([r.added, r.removed], [['ชอบแมว'], ['ชอบหมา']]);
  const f = d.facts();
  assert.deepStrictEqual(f.map(x => [x.section, x.text, !!x.from]), [['ผู้ใช้', 'อยู่กรุงเทพฯ', false], ['ผู้ใช้', 'ชอบแมว', true]]);
  d.setFacts([f[1], { section: 'งาน', text: 'ทำ Neo' }]);
  assert.strictEqual(d.memory(), '## ผู้ใช้\n- ชอบแมว\n\n## งาน\n- ทำ Neo');
  d.record('อีกเรื่อง', 'x', true, t + 5);
  assert.strictEqual(d.forgetJournal(t + 5), 1);
  assert.strictEqual(d.forgetDream(r.at), 0); assert.strictEqual(d.pending, null);
  d.clearJournal(); assert.strictEqual(d.journal().length, 0);
});
