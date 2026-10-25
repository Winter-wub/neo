# Neo — ฝั่ง Mac

ไม่มีหน้าเว็บแล้ว: ทุกอย่างอยู่ใน **Neo.app** (SwiftUI) — `app/mac/build.sh` สร้างแอปที่มีครบในตัว (node + server + ตัวถอดเสียงของ Apple + APK) ดู `INSTALL.md`

- `server.js` — สมองฝั่ง Mac (Neo.app เปิดให้เอง): รับเสียงสดจากมือถือ, ตัดช่วงพูด, ถอดเสียง (Apple on-device ผ่าน Neo.app ที่ 127.0.0.1:8001), ตรวจชื่อเรียก, ส่งให้สมองที่เลือก, ส่งการ์ดกลับ
- `voice.js` ตัดช่วงพูด/ชื่อเรียก/บทสนทนา · `places.js` อากาศตามที่ · `providers.js` ACP/OpenAI/HTTP · `discover.js` หา agent ในเครื่อง · `pairing.js` จับคู่มือถือ + สิทธิ์ · `neo-agents-mcp.js` MCP สถานะ Orca + ego browser
- ความปลอดภัย: API ของ Mac ต้องมี token ที่ Neo.app สร้างทุกครั้งที่เปิด (กันเว็บในเบราว์เซอร์ยิง localhost); เครื่องอื่น (Tailscale/Wi-Fi/tunnel) ต้องจับคู่ด้วยรหัส 6 หลัก และใช้ได้เฉพาะ API ของมือถือ
- ทดสอบ: `node --test app/voice.test.js app/test/*.test.js`
- รันแบบพัฒนา (ไม่ผ่านแอป): `cd app && NEO_HOME=… node server.js` — ไม่มี NEO_APP_TOKEN = API ของ Mac ไม่ต้องใช้ token
