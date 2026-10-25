// node --test app/test/providers.test.js — provider ACP/OpenAI/HTTP กับ agent/endpoint จำลอง (ไม่ใช้ quota)
'use strict';
const test = require('node:test'), assert = require('node:assert'), http = require('http'), path = require('path');
const { create } = require('../providers');

function deps(over = {}) {
  const ev = [];
  return { ev, d: {
    emit: e => ev.push(e), prompt: (q, fresh, kind) => `[${kind}${fresh ? ' fresh' : ''}] ${q}`,
    toCard: t => { const m = String(t).match(/\{[\s\S]*\}/); return m ? JSON.parse(m[0]) : { title: 'text', lines: [String(t)] }; },
    confirm: async () => true, isReadTool: () => false, bypass: () => false, acpMcp: () => [{ name: 'neo-agents', command: 'node', args: [], env: [] }],
    env: () => process.env, cwd: __dirname, log: () => {}, ...over } };
}
const fake = (d, config) => create('fake', { type: 'acp', label: 'Fake', command: process.execPath, args: [path.join(__dirname, 'fake-acp-agent.js')], config }, d);

test('ACP: session continuity, config, MCP, tool events', async () => {
  const { ev, d } = deps(); const p = fake(d, { model: 'm1' });
  const a = await p.ask('hello'); assert.strictEqual(a.title, 'turn 1'); assert.ok(a.lines.includes('model m1')); assert.ok(a.lines.includes('mcp neo-agents'));
  const b = await p.ask('again'); assert.strictEqual(b.title, 'turn 2'); assert.strictEqual(b.lines[0], a.lines[0]); // คุยต่อ session เดิม
  assert.ok(ev.some(e => e.type === 'tool' && e.name === 'Search the web'));
  assert.deepStrictEqual(ev.filter(e => e.type === 'session').map(e => e.fresh), [true, false]);
  p.reset(); const c = await p.ask('new'); assert.strictEqual(c.title, 'turn 1'); assert.notStrictEqual(c.lines[0], a.lines[0]);
  p.stop();
});

test('ACP: write actions ask the user; read-only tools are allowed silently', async () => {
  let asked = 0; const yes = deps({ confirm: async () => (asked++, true) }), no = deps({ confirm: async () => false });
  const p1 = fake(yes.d); assert.ok((await p1.ask('PERM')).lines.includes('perm yes')); assert.strictEqual(asked, 1); p1.stop();
  const p2 = fake(no.d); assert.ok((await p2.ask('PERM')).lines.includes('perm no')); p2.stop();
  const p3 = fake(deps({ confirm: async () => { throw new Error('should not ask'); }, isReadTool: t => /README/.test(t) }).d);
  assert.ok((await p3.ask('PERM')).lines.includes('perm yes')); p3.stop();
});

test('ACP: cancel stops a running prompt; agent crash is reported', async () => {
  const { d } = deps(); const p = fake(d);
  const r = p.ask('SLOW'); setTimeout(() => p.cancel(), 100);
  await assert.rejects(r, /interrupted/);
  p.stop(); await new Promise(r => setTimeout(r, 100));
  const bad = create('x', { type: 'acp', command: '/no/such/agent' }, d);
  await assert.rejects(bad.ask('hi'), /x:/);
});

test('OpenAI-compatible + custom HTTP endpoint keep conversation', async () => {
  const seen = [];
  const srv = http.createServer((req, res) => { let b = ''; req.on('data', x => b += x); req.on('end', () => {
    const j = JSON.parse(b); seen.push({ ...j, auth: req.headers.authorization, title: req.headers['x-title'] });
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/v1/chat/completions') return res.end(JSON.stringify({ choices: [{ message: { content: '{"title":"msgs ' + j.messages.length + '","lines":[]}' } }] }));
    res.end(JSON.stringify({ text: 'สวัสดี ' + (j.sessionId || 'ใหม่'), sessionId: 'abc' }));
  }); }).listen(0, '127.0.0.1');
  await new Promise(r => srv.once('listening', r)); const port = srv.address().port;
  const { d } = deps();
  const keyFile = path.join(require('os').tmpdir(), 'neo-test-key'); require('fs').writeFileSync(keyFile, 'sk-test\n');
  const o = create('local', { type: 'openai', baseUrl: `http://127.0.0.1:${port}/v1`, model: 'x', apiKeyFile: keyFile, headers: { 'X-Title': 'Neo companion' } }, d);
  assert.strictEqual((await o.ask('a')).title, 'msgs 1'); assert.strictEqual((await o.ask('b')).title, 'msgs 3'); // ส่งประวัติไปด้วย
  assert.match(seen[0].messages[0].content, /\[plain fresh\] a/);
  assert.strictEqual(seen[0].auth, 'Bearer sk-test'); assert.strictEqual(seen[0].title, 'Neo companion'); // แบบ OpenRouter
  require('fs').unlinkSync(keyFile);
  const h = create('mine', { type: 'http', url: `http://127.0.0.1:${port}/neo` }, d);
  assert.deepStrictEqual((await h.ask('hi')).lines, ['สวัสดี ใหม่']); assert.deepStrictEqual((await h.ask('again')).lines, ['สวัสดี abc']);
  srv.close();
});

test('model selection: ACP (config + set_model), list models, OpenAI-compatible', async () => {
  const { d } = deps();
  const a = fake(d); a.setModel('m1');
  assert.deepStrictEqual((await a.listModels()).map(m => m.id), ['m0', 'm1']);
  assert.ok((await a.ask('x')).lines.includes('model m1'));
  a.setModel('m0'); assert.ok((await a.ask('y')).lines.includes('model m0')); // เปลี่ยนกลางบทสนทนา
  a.stop();
  process.env.FAKE_MODELS = 'models';
  const b = fake(d); b.setModel('sonnet'); assert.ok((await b.ask('x')).lines.includes('model sonnet'));
  assert.deepStrictEqual((await b.listModels()).map(m => m.id), ['haiku', 'sonnet']); b.stop(); delete process.env.FAKE_MODELS;
  const srv = http.createServer((req, res) => { let body = ''; req.on('data', x => body += x); req.on('end', () => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/v1/models') return res.end(JSON.stringify({ data: [{ id: 'x/fast' }, { id: 'y/smart', name: 'Smart' }] }));
    res.end(JSON.stringify({ choices: [{ message: { content: '{"title":"' + JSON.parse(body).model + '"}' } }] }));
  }); }).listen(0, '127.0.0.1'); await new Promise(r => srv.once('listening', r));
  const o = create('or', { type: 'openai', baseUrl: `http://127.0.0.1:${srv.address().port}/v1`, model: 'x/fast' }, d);
  assert.deepStrictEqual((await o.listModels()).map(m => m.id), ['x/fast', 'y/smart']);
  assert.strictEqual((await o.ask('a')).title, 'x/fast'); o.setModel('y/smart'); assert.strictEqual((await o.ask('b')).title, 'y/smart');
  srv.close();
});

test('bypass: picks the most permissive mode the agent offers, never plan; permissions auto-allowed', async () => {
  const { pickMode } = require('../providers');
  assert.strictEqual(pickMode(['auto', 'default', 'acceptEdits', 'plan', 'dontAsk', 'bypassPermissions']), 'bypassPermissions'); // claude-agent-acp
  assert.strictEqual(pickMode(['build', 'plan']), 'build'); // opencode
  assert.strictEqual(pickMode(['plan', 'read-only']), null);
  const p = fake(deps({ bypass: () => true, confirm: async () => { throw new Error('should not ask'); } }).d);
  assert.ok((await p.ask('PERM')).lines.includes('perm yes')); p.stop();
});
