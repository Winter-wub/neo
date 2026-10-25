// จับคู่มือถือกับ Mac ผ่าน Tailscale: Neo.app ขอรหัส 6 หลัก (ใช้ได้ 5 นาที ครั้งเดียว) → มือถือส่งรหัส → ได้ token ประจำเครื่อง
// เก็บแค่ sha256 ของ token (devices.json สิทธิ์ 600); เครื่องที่เข้ามาทาง Tailscale ต้องมี token และใช้ได้เฉพาะ API ของมือถือ
'use strict';
const crypto = require('crypto'), fs = require('fs');

const CODE_MS = 5 * 60000, MAX_TRIES = 5;
// API ที่มือถือ (เครื่องที่จับคู่แล้ว) ใช้ได้ — นอกนั้น (console, ตั้งค่า, provider, พิมพ์สั่ง) ใช้ได้เฉพาะบน Mac
const DEVICE_API = new Set(['/api/audio', '/api/events', '/api/arm', '/api/cancel', '/api/face', '/api/hello', '/api/alarm/stop', '/api/dream/seen', '/api/pet', '/api/wakeup']);
const OPEN_API = new Set(['/api/hello', '/api/pair', '/neo.apk']); // ยังไม่จับคู่ก็เรียกได้ (APK ไว้ให้มือถือดาวน์โหลดไปติดตั้ง)

const sha = t => crypto.createHash('sha256').update(String(t)).digest('hex');
/** มาจาก Mac เองจริง ๆ (รวม adb reverse) — ไม่ใช่ tunnel/proxy ที่ต่อเข้า 127.0.0.1 (cloudflared, ngrok, nginx) */
function isLocal(req) {
  if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress)) return false;
  const h = req.headers || {};
  if (['x-forwarded-for', 'x-forwarded-host', 'x-real-ip', 'forwarded', 'cf-connecting-ip', 'true-client-ip', 'ngrok-trace-id'].some(k => h[k])) return false;
  return /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(String(h.host || 'localhost'));
}

class Pairing {
  /** appToken: Neo.app ส่งมาใน header x-neo-token — API ของ Mac ต้องมี (กันเว็บในเบราว์เซอร์ยิงเข้า localhost แบบ CSRF) */
  constructor(file, now = Date.now, appToken = '') { this.file = file; this.now = now; this.appToken = appToken; this.code = null; this.devices = {}; try { this.devices = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {} }
  save() { fs.writeFileSync(this.file, JSON.stringify(this.devices, null, 1), { mode: 0o600 }); }
  /** เริ่มจับคู่ (เรียกจาก Neo.app บน Mac เท่านั้น) */
  start() { this.code = { value: String(crypto.randomInt(0, 1e6)).padStart(6, '0'), until: this.now() + CODE_MS, tries: 0 }; return { code: this.code.value, expiresAt: this.code.until }; }
  /** มือถือส่งรหัส → token (ครั้งเดียว) หรือ null */
  pair(code, name) {
    const c = this.code;
    if (!c || this.now() > c.until) return { error: 'ไม่มีรหัสที่ใช้ได้ — กดจับคู่ใหม่ใน Neo.app' };
    if (++c.tries > MAX_TRIES) { this.code = null; return { error: 'ใส่รหัสผิดหลายครั้ง — ขอรหัสใหม่' }; }
    if (String(code).trim() !== c.value) return { error: 'รหัสไม่ถูกต้อง' };
    this.code = null;
    const token = crypto.randomBytes(24).toString('hex'), id = sha(token).slice(0, 12);
    this.devices[sha(token)] = { id, name: String(name || 'Android').slice(0, 40), paired: new Date(this.now()).toISOString(), lastSeen: null };
    this.save();
    return { token, id };
  }
  /** อุปกรณ์จาก header Authorization: Bearer <token> */
  device(req) {
    const m = String(req.headers.authorization || '').match(/^Bearer\s+([a-f0-9]{48})$/i);
    const d = m && this.devices[sha(m[1])];
    if (d) d.lastSeen = new Date(this.now()).toISOString();
    return d || null;
  }
  list() { return Object.values(this.devices); }
  revoke(id) { for (const [k, d] of Object.entries(this.devices)) if (d.id === id) delete this.devices[k]; this.save(); }
  /** อนุญาตคำขอไหม: local (127.0.0.1 รวม adb reverse) ทุกอย่าง; remote ต้องเป็นเครื่องที่จับคู่และเรียกเฉพาะ API ของมือถือ */
  check(req) {
    const local = isLocal(req), path = req.url.split('?')[0];
    if (local) {
      // บน Mac: API ของมือถือ (adb reverse) ใช้ได้เลย; API ของ Mac (ตั้งค่า, สั่งงาน) ต้องมี token ของ Neo.app
      if (!this.appToken || DEVICE_API.has(path) || OPEN_API.has(path)) return { ok: true, local: true };
      const t = String(req.headers['x-neo-token'] || '');
      if (t.length === this.appToken.length && crypto.timingSafeEqual(Buffer.from(t), Buffer.from(this.appToken))) return { ok: true, local: true, app: true };
      return { ok: false, code: 401, error: 'ใช้ได้เฉพาะจาก Neo.app' };
    }
    if (OPEN_API.has(path)) return { ok: true, local: false };
    const d = this.device(req);
    if (!d) return { ok: false, code: 401, error: 'ยังไม่ได้จับคู่ — ใส่รหัสจาก Neo.app' };
    if (!DEVICE_API.has(path)) return { ok: false, code: 403, error: 'ใช้ได้เฉพาะบน Mac' };
    return { ok: true, local: false, device: d };
  }
}

module.exports = { Pairing, DEVICE_API, sha, isLocal };
