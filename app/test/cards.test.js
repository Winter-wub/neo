const test = require('node:test');
const assert = require('node:assert');
const { humanize, pixelArt } = require('../cards');

test('JSON ดิบจากเครื่องมือ → ภาษาคน', () => {
  const c = humanize({ title: '**ผลค้นหา**', layout: 'text', lines: ['{"name":"ร้าน A","rating":4.5,"url":"https://x.com/a"}', '[{"title":"ข่าว 1","source":"BBC"},{"title":"ข่าว 2","source":"CNN"}]', 'ดูที่ [ลิงก์](https://www.example.com/long/path?q=1)'] });
  assert.strictEqual(c.title, 'ผลค้นหา');
  assert.ok(!c.lines.some(l => /[{}"[\]]/.test(l)), c.lines.join(' | '));
  assert.ok(c.lines.includes('ร้าน A — 4.5'));
  assert.ok(c.lines.includes('ข่าว 1 — BBC'));
  assert.ok(c.lines.includes('ดูที่ ลิงก์'));
});

test('items ที่ค่าเป็น object + list ว่าง → text', () => {
  const c = humanize({ layout: 'list', items: [{ t: 'ราคา', v: { thb: 35, usd: 1 } }], lines: [] });
  assert.strictEqual(c.items[0].v, 'thb: 35 · usd: 1');
  assert.strictEqual(humanize({ layout: 'list', items: [], lines: ['x'] }).layout, 'text');
});

test('ภาพ pixel: ตรวจ/เติมแถว, สีไม่รู้จัก = พื้นหลัง; เสีย → การ์ดข้อความ', () => {
  const a = pixelArt({ w: 4, h: 4, palette: { g: '#00ff00', bad: '#fff' }, frames: [['.gg', 'gzgg']] });
  assert.deepStrictEqual(a.frames[0], ['.gg.', 'g.gg', '....', '....']);
  assert.strictEqual(a.fps, 3);
  const c = humanize({ layout: 'pixel', title: 'ต้นไม้', w: 2, h: 2, palette: {}, frames: [] });
  assert.strictEqual(c.layout, 'text');
});
