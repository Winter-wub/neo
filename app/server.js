// Neo backend: เสิร์ฟแอป + /api/ask (อากาศแบบเร็ว / อย่างอื่นถาม Claude Code CLI ผ่าน quota ที่มีอยู่)
// รัน: node server.js   (ฟังเฉพาะ 127.0.0.1 — มือถือเข้าผ่าน `adb reverse tcp:8000 tcp:8000`)
// ตั้งเมือง: MOCHI_LAT=13.75 MOCHI_LON=100.52 MOCHI_CITY="กรุงเทพฯ" (default กรุงเทพฯ)
const http = require('http'), fs = require('fs'), path = require('path'), os = require('os');
const { spawn, execFile } = require('child_process');
const PORT = +process.env.PORT || 8000, ROOT = __dirname;
const MODELS = path.join(ROOT, '..', 'models'), BIG = path.join(MODELS, 'ggml-large-v3-turbo-q5_0.bin');
const WHISPER_MODEL = process.env.MOCHI_WHISPER_MODEL || (fs.existsSync(BIG) ? BIG : path.join(MODELS, 'ggml-small.bin'));
const CITY = process.env.MOCHI_CITY || 'กรุงเทพฯ';
const LAT = process.env.MOCHI_LAT || '13.75', LON = process.env.MOCHI_LON || '100.52';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mp3': 'audio/mpeg', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.md': 'text/plain; charset=utf-8' };

const WMO = c => c === 0 ? ['sun', 'ท้องฟ้าแจ่มใส'] : c <= 2 ? ['cloudsun', 'มีเมฆบางส่วน'] : c === 3 ? ['cloud', 'เมฆมาก']
  : c <= 48 ? ['fog', 'มีหมอก'] : c <= 57 ? ['rain', 'ฝนปรอย'] : c <= 67 ? ['rain', 'ฝนตก'] : c <= 77 ? ['cloud', 'อากาศเย็นจัด']
  : c <= 82 ? ['rain', 'ฝนตกเป็นช่วง'] : ['storm', 'พายุฟ้าคะนอง'];

async function weather() {
  const u = `https://api.open-meteo.com/v1/forecast?latitude=${LAT}&longitude=${LON}&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code&daily=precipitation_probability_max,temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=1`;
  const r = await fetch(u, { signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error('weather ' + r.status);
  const j = await r.json(), c = j.current, d = j.daily;
  const [icon, desc] = WMO(c.weather_code), rain = d.precipitation_probability_max[0];
  const wet = icon === 'rain' || icon === 'storm' || rain >= 60;
  return {
    kind: 'weather', icon, title: Math.round(c.temperature_2m) + '°C',
    lines: [CITY + ' · ' + desc, 'รู้สึกเหมือน ' + Math.round(c.apparent_temperature) + '°  ชื้น ' + c.relative_humidity_2m + '%',
      'วันนี้ ' + Math.round(d.temperature_2m_min[0]) + '–' + Math.round(d.temperature_2m_max[0]) + '°  ฝน ' + rain + '%'],
    emotion: wet ? 'curious' : 'happy', sounds: wet ? ['greet', 'curious'] : ['greet', 'happy'], seconds: 15,
  };
}

const PROMPT = q => `คุณคือ "Neo" สัตว์เลี้ยงบนจอมือถือ ซุกซน ร่าเริง ผู้ใช้พูดกับคุณว่า: "${q}"
ข้อความนี้มาจากการถอดเสียงพูดภาษาไทยที่อาจผิดเพี้ยน (เช่น "อากาศ" อาจกลายเป็น "อังกลับ/อากาด") ให้เดาเจตนาที่เป็นไปได้มากที่สุด
ถ้าผู้ใช้น่าจะถามเรื่องสภาพอากาศ/ฝน/อุณหภูมิ ให้ตอบเพียง {"intent":"weather"}
ไม่เช่นนั้นตอบเป็น JSON บรรทัดเดียวเท่านั้น ห้ามมีข้อความอื่น/ห้ามใช้เครื่องมือ รูปแบบ:
{"title":"หัวข้อสั้น ไม่เกิน 12 ตัวอักษร","lines":["บรรทัดสั้น ไม่เกิน 28 ตัวอักษร (สูงสุด 3 บรรทัด)"],"emotion":"happy|curious|sleepy|startle","sounds":["greet|happy|curious|startle|sleepy"]}
ถ้าไม่รู้/ต้องใช้ข้อมูลสด (ข่าว ราคา) ให้บอกตรง ๆ ว่าไม่รู้ ห้ามเดา`;

let current = null; // คำขอที่กำลังรัน — คำขอใหม่ยกเลิกอันเก่า (interrupt)
function askClaude(q) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env, CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.ccs/instances/personal') };
    const p = spawn('claude', ['-p', '--model', 'haiku', '--tools', ''], { cwd: os.tmpdir(), env });
    p.stdin.end(PROMPT(q)); // ส่งผ่าน stdin (--tools รับหลายค่า จะกลืน prompt)
    let out = '', done = false;
    const fin = (f, v) => { if (!done) { done = true; clearTimeout(t); f(v); } };
    const t = setTimeout(() => { p.kill(); fin(reject, new Error('timeout')); }, 30000);
    p.stdout.on('data', d => out += d);
    p.on('error', e => fin(reject, e));
    p.on('close', () => {
      const m = out.match(/\{[\s\S]*\}/);
      try { const j = JSON.parse(m[0]); fin(resolve, { kind: 'text', ...j, seconds: 15 }); } catch (e) { fin(reject, new Error('bad json')); }
    });
    current = { kill: () => { p.kill(); fin(reject, new Error('interrupted')); } };
  });
}

async function ask(text) {
  if (current) { current.kill(); current = null; }
  if (/อากาศ|ฝน|ร้อน|หนาว|อุณหภูมิ|weather|temperature/i.test(text)) return weather();
  const r = await askClaude(text);
  if (r.intent === 'weather') return weather();
  return r;
}


let sttBusy = false;
const DBG_DIR = path.join(os.tmpdir(), 'mochi-audio'); let seq = 0;
function transcribe(wav) { // wav: 16kHz mono 16-bit จากมือถือ → ข้อความไทย (whisper.cpp บนเครื่อง ไม่ส่งเสียงออกนอกบ้าน)
  return new Promise((resolve, reject) => {
    fs.mkdirSync(DBG_DIR, { recursive: true });
    const raw = path.join(DBG_DIR, 'seg' + (seq++ % 10) + '-raw.wav'), f = path.join(DBG_DIR, 'seg' + ((seq - 1) % 10) + '-norm.wav'); // เก็บ 10 ไฟล์ล่าสุดไว้ตรวจ (ลบเองเมื่อรีสตาร์ท/ล้าง tmp)
    fs.writeFile(raw, wav, err => {
      if (err) return reject(err);
      // เร่งเสียงให้พอดี + ตัดความถี่ต่ำ แล้วค่อยถอดเสียง
      execFile('ffmpeg', ['-y', '-loglevel', 'error', '-i', raw, '-af', 'highpass=f=80,dynaudnorm=f=150:g=15:p=0.9', '-ar', '16000', '-ac', '1', f], { timeout: 10000 }, e1 => {
        execFile('whisper-cli', ['-m', WHISPER_MODEL, '-l', 'th', '-nt', '-np', '-bs', '5', '-f', e1 ? raw : f], { timeout: 25000 }, (e, out) => {
          if (e) return reject(e);
          let t = out.replace(/\[[^\]]*\]/g, '').trim();
          const m = t.match(/^(.{4,}?)\1+$/); if (m) t = m[1]; // whisper มักวนซ้ำประโยคเดิม
          const th = (t.match(/[\u0E00-\u0E7F]/g) || []).length, lat = (t.match(/[A-Za-z\u0400-\u04FF\u3040-\u30FF\u4E00-\u9FFF\uAC00-\uD7AF]/g) || []).length;
          if (th < 2 || lat > th) t = ''; // รับเฉพาะภาษาไทย: ทิ้งผลที่เป็นภาษาอื่น/ฟังไม่ออก
          resolve(t);
        });
      });
    });
  });
}

http.createServer((req, res) => {
  const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(obj)); };
  if (req.method === 'POST' && req.url === '/api/stt') {
    if (sttBusy) return send(429, { error: 'busy' });
    const chunks = []; let n = 0;
    req.on('data', d => { n += d.length; if (n > 2e6) req.destroy(); else chunks.push(d); });
    req.on('end', async () => {
      sttBusy = true;
      try { const text = await transcribe(Buffer.concat(chunks)); console.log(new Date().toISOString(), 'heard:', text); send(200, { text }); }
      catch (e) { send(500, { error: e.message }); }
      finally { sttBusy = false; }
    });
    return;
  }
  if (req.method === 'POST' && req.url === '/api/ask') {
    let b = ''; req.on('data', d => { b += d; if (b.length > 4000) req.destroy(); });
    req.on('end', async () => {
      try {
        const text = String(JSON.parse(b).text || '').slice(0, 300).trim();
        if (!text) return send(400, { error: 'empty' });
        console.log(new Date().toISOString(), 'ask:', text);
        send(200, await ask(text));
      } catch (e) { send(e.message === 'interrupted' ? 409 : 500, { error: e.message }); }
    });
    return;
  }
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || /server\.js$/.test(f)) { res.writeHead(403); return res.end(); }
  fs.readFile(f, (e, d) => {
    if (e) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(d);
  });
}).listen(PORT, '127.0.0.1', () => console.log('mochi on http://127.0.0.1:' + PORT));
