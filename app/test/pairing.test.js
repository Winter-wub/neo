// node --test app/test/pairing.test.js
'use strict';
const test = require('node:test'), assert = require('node:assert'), os = require('os'), path = require('path'), fs = require('fs');
const { Pairing } = require('../pairing');
const req = (ip, url, token, extra = {}) => ({ socket: { remoteAddress: ip }, url, headers: { host: 'localhost:8000', ...(token ? { authorization: 'Bearer ' + token } : {}), ...extra } });

test('pairing: code once, 5 min, 5 tries; token stored hashed', () => {
  const f = path.join(os.tmpdir(), 'neo-devices-test.json'); try { fs.unlinkSync(f); } catch {}
  let t = 0; const p = new Pairing(f, () => t);
  assert.ok(p.pair('123456').error); // ยังไม่มีรหัส
  const { code } = p.start(); assert.match(code, /^\d{6}$/);
  assert.strictEqual(p.pair('000000x').error, 'รหัสไม่ถูกต้อง');
  const ok = p.pair(code, 'Galaxy A7'); assert.match(ok.token, /^[a-f0-9]{48}$/);
  assert.ok(p.pair(code).error); // ใช้ซ้ำไม่ได้
  assert.ok(!fs.readFileSync(f, 'utf8').includes(ok.token)); // ไม่เก็บ token ตรง ๆ
  assert.strictEqual((fs.statSync(f).mode & 0o777), 0o600);
  p.start(); t += 5 * 60000 + 1; assert.ok(p.pair(p.code && p.code.value || 'x').error); // หมดเวลา
  const c2 = p.start().code; for (let i = 0; i < 5; i++) p.pair('999999'); assert.ok(p.pair(c2).error); // ผิด 5 ครั้งแล้วรหัสถูกก็ไม่รับ
  fs.unlinkSync(f);
});

test('access: local = all; remote needs token and only phone APIs', () => {
  const f = path.join(os.tmpdir(), 'neo-devices-test2.json'); try { fs.unlinkSync(f); } catch {}
  const p = new Pairing(f); const { token } = p.pair(p.start().code, 'A7');
  assert.ok(p.check(req('127.0.0.1', '/api/providers/config')).ok); // บน Mac / adb reverse
  assert.ok(p.check(req('100.64.0.9', '/api/hello')).ok); assert.ok(p.check(req('100.64.0.9', '/api/pair')).ok);
  assert.strictEqual(p.check(req('100.64.0.9', '/api/audio')).code, 401);
  assert.strictEqual(p.check(req('100.64.0.9', '/api/audio', 'f'.repeat(48))).code, 401);
  assert.ok(p.check(req('100.64.0.9', '/api/audio', token)).ok); assert.ok(p.check(req('100.64.0.9', '/api/events?x=1', token)).ok);
  for (const u of ['/api/say', '/api/providers/config', '/api/settings', '/console.html', '/api/model']) assert.strictEqual(p.check(req('100.64.0.9', u, token)).code, 403, u);
  p.revoke(p.list()[0].id); assert.strictEqual(p.check(req('100.64.0.9', '/api/audio', token)).code, 401);
  fs.unlinkSync(f);
});

test('tunnel/proxy into 127.0.0.1 is NOT treated as the Mac itself', () => {
  const f = path.join(os.tmpdir(), 'neo-devices-test3.json'); try { fs.unlinkSync(f); } catch {}
  const p = new Pairing(f); const { token } = p.pair(p.start().code, 'A7');
  assert.ok(p.check(req('127.0.0.1', '/api/settings')).ok); // adb reverse / Neo.app
  for (const h of [{ 'x-forwarded-for': '1.2.3.4' }, { 'cf-connecting-ip': '1.2.3.4' }, { host: 'neo.example.com' }, { 'ngrok-trace-id': 'x' }]) {
    assert.strictEqual(p.check(req('127.0.0.1', '/api/settings', null, h)).code, 401, JSON.stringify(h)); // ต้องจับคู่ก่อน
    assert.strictEqual(p.check(req('127.0.0.1', '/api/settings', token, h)).code, 403); // จับคู่แล้วก็ใช้ API ของ Mac ไม่ได้
    assert.ok(p.check(req('127.0.0.1', '/api/audio', token, h)).ok); // แต่ใช้ API ของมือถือได้
  }
  fs.unlinkSync(f);
});

test('app token: browser/other local programs cannot use Mac APIs (CSRF), phone APIs still work over adb', () => {
  const f = path.join(os.tmpdir(), 'neo-devices-test4.json'); try { fs.unlinkSync(f); } catch {}
  const p = new Pairing(f, Date.now, 'a'.repeat(32));
  assert.strictEqual(p.check(req('127.0.0.1', '/api/say')).code, 401);                         // เว็บในเบราว์เซอร์ยิง localhost
  assert.strictEqual(p.check(req('127.0.0.1', '/api/say', null, { 'x-neo-token': 'b'.repeat(32) })).code, 401);
  assert.ok(p.check(req('127.0.0.1', '/api/say', null, { 'x-neo-token': 'a'.repeat(32) })).ok);  // Neo.app
  for (const u of ['/api/audio', '/api/events', '/api/arm', '/api/hello', '/neo.apk']) assert.ok(p.check(req('127.0.0.1', u)).ok, u); // มือถือผ่าน adb
  try { fs.unlinkSync(f); } catch {}
});
