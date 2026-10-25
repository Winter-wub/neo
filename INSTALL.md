# ติดตั้ง Neo (สำหรับเพื่อน/ทีม)

Neo = สัตว์เลี้ยงบนจอมือถือ Android ที่ฟังคุณพูด แล้วให้ AI บน Mac (Claude Code หรือ agent อื่น) หาคำตอบมาแสดงเป็นการ์ด

## ต้องมี
- Mac ชิป Apple Silicon (M1 ขึ้นไป), macOS 13 ขึ้นไป
- AI อย่างน้อย 1 ตัว: [Claude Code](https://docs.anthropic.com/claude-code) (`npm i -g @anthropic-ai/claude-code` แล้วรัน `claude` เพื่อ login) หรือ agent ที่รองรับ ACP เช่น opencode — หรือใช้ endpoint ของคุณเอง (OpenRouter ฯลฯ)
- มือถือ Android 7 ขึ้นไป

## Mac
1. แตกไฟล์ `Neo.zip` แล้ว**ลาก Neo.app ลงโฟลเดอร์ Applications**
2. เปิดครั้งแรก: คลิกขวาที่ Neo.app → **Open** → Open (แอปนี้ไม่ได้เซ็นด้วย Apple Developer ID macOS จึงถามก่อน)
   - ถ้าขึ้นว่า "damaged" ให้รัน `xattr -dr com.apple.quarantine /Applications/Neo.app` แล้วเปิดใหม่
3. กด **Allow** เมื่อถามสิทธิ์ Speech Recognition (ถอดเสียงไทยบนเครื่อง ไม่ส่งเสียงออกนอก Mac)
4. ทำตามหน้า "ตั้งค่า Neo": ตรวจเครื่อง → ตั้งชื่อเรียก → หน้าตา → สมอง → จับคู่มือถือ

## มือถือ
1. เลือกวิธีต่อกับ Mac (อย่างใดอย่างหนึ่ง):
   - **Tailscale/VPN** (แนะนำ): ติดตั้ง Tailscale บนทั้งสองเครื่อง login บัญชีเดียวกัน
   - **Wi-Fi เดียวกัน**: เปิด "Wi-Fi เดียวกัน" ใน Neo → ตั้งค่า → มือถือ (ข้อมูลในวง Wi-Fi ไม่เข้ารหัส)
   - **USB**: `adb reverse tcp:8000 tcp:8000` (สำหรับนักพัฒนา)
   - **URL ของคุณเอง**: tunnel/reverse proxy ที่ชี้มา `http://127.0.0.1:8000`
2. ใน Neo บน Mac กด **จับคู่มือถือ** → เปิดลิงก์ `…/neo.apk` ที่ขึ้นในหน้านั้นด้วยเบราว์เซอร์มือถือเพื่อติดตั้งแอป
3. เปิดแอป Neo บนมือถือ → ใส่ที่อยู่ Mac + รหัส 6 หลัก → จับคู่
4. เรียกชื่อ แล้วพูดคำสั่ง (เงียบ 3 วิ = จบ)

## ข้อมูลอยู่ที่ไหน
- ค่าตั้ง/อุปกรณ์ที่จับคู่/API key: `~/Library/Application Support/Neo`
- log: `~/Library/Logs/Neo/server.log`
- ถอนการติดตั้ง: ลบ Neo.app และสองโฟลเดอร์ข้างบน

## สร้างจากโค้ด (ผู้พัฒนา)
`android/` → `JAVA_HOME=/opt/homebrew/opt/openjdk@17 ./gradlew assembleDebug` แล้วคัดลอก APK เป็น `mochi-debug.apk`; `app/mac/build.sh` → `app/mac/build/Neo.app` + `Neo.zip` (ต้องมี node, ImageMagick)
