# Handoff: Neo companion app → พอร์ต UI เป็น Android native (Kotlin)

อ่านไฟล์นี้ก่อน แล้วอ่าน `PLAN.md` (ภาพรวมและการตัดสินใจ) และ `app/README.md` ตอบสั้นเป็นภาษาไทยเมื่อรายงาน

## เป้าหมาย
น้องชื่อ **Neo** (เดิมโมจิ): สัตว์เลี้ยงบนจอมือถือ Samsung Galaxy A7 (2018, SM-A750GN, Android 10, RAM 3.7GB, จอ 1080x2220 ใช้แนวนอน) หน้าตาเป็น pixel art มีแค่ตากับปาก
**งานนี้:** เขียน UI ใหม่เป็น Kotlin native ล้วน (ไม่ใช้ WebView) ให้ได้ฟีเจอร์เท่าเวอร์ชันเว็บ แล้วเก็บ backend บน Mac ไว้เหมือนเดิม

## สถานะปัจจุบัน
- เว็บแอป (อ้างอิงพฤติกรรม): `app/index.html` — หน้า pixel 32x18, 8 mood, ตรวจจับลูบ, เสียงร้อง 14 ไฟล์ (`app/sounds/*.mp3`), ปากขยับตามความดังเสียง, ง่วงหลับ, ร้องเองตอนว่าง, ซับไตเติลสิ่งที่ได้ยิน, การ์ดอากาศ/คำตอบ 15 วินาที
- แอป Android ปัจจุบัน (WebView + อัดไมค์ดิบ): `android/` (package `com.mochi.companion`, build ผ่านแล้ว, `mochi-debug.apk`)
- Backend: `app/server.js` (Node, ฟังที่ 127.0.0.1:8000): `POST /api/stt` (รับ wav 16kHz mono → whisper-cli large-v3-turbo ภาษาไทย → `{text}`), `POST /api/ask` (`{text}` → การ์ด JSON: อากาศจาก Open-Meteo หรือ Claude Code haiku) ดู schema การ์ดจาก `server.js`
- ชื่อเรียก (wake word): ผู้ใช้พูด "Neo/นีโอ" นำหน้าคำสั่ง (regex `WAKE` ใน `index.html`)
- เสียงจากไมค์ A7 ผ่าน Chrome เพี้ยน → ต้องทดสอบว่าอัดจาก AudioRecord ตรง ๆ แล้วถอดแม่นขึ้นไหม

## งาน (ลำดับ)
1. สร้างโมดูล native ในโปรเจกต์ `android/` เดิม: `FaceView` (Canvas, grid 32x18, integer scaling, 10fps), state machine เดียวกับเว็บ, ตรวจจับลูบ (`MotionEvent` ลากช้า 20–500 px/s สะสมระยะ → ระดับเคลิ้ม 0..1 ลดเองเมื่อหยุด), แตะเร็ว = สะดุ้ง/ทัก
2. เสียงร้อง: คัดลอก mp3 ไป `res/raw` หรือ assets, เล่นด้วย `SoundPool`/`MediaPlayer`; ปากขยับตามความดังด้วย `Visualizer` หรือคำนวณ envelope ล่วงหน้า (อ้าง `voice-samples/mouth_envelope.py`); ครางวนตอนเคลิ้ม
3. ซับไตเติล + การ์ด (ไอคอน pixel อากาศ, อุณหภูมิตัวใหญ่, 3 บรรทัด, หายเอง 15 วินาที, แตะปิด, คำสั่งใหม่แทนที่)
4. ไมค์: ย้าย `MicStreamer` มาเป็นของจริง ส่งเสียงช่วงพูดไป `/api/stt` แล้วกรอง wake word แล้วเรียก `/api/ask`; ไม่อัดเสียงตัวเองตอนร้อง
5. ตั้ง base URL ของ Mac เป็น config (ตอนนี้ `http://localhost:8000` ผ่าน `adb reverse`) และ UI ต้องเปิดได้โดยไม่ต้องติดต่อ Mac
6. (ภายหลัง/ถ้าเวลาพอ) foreground service ให้ฟังต่อเนื่องแม้จอดับ; ตั้งให้เปิดเองตอนบูต

## ข้อห้าม/ข้อจำกัด (สำคัญ)
- **ห้ามติดตั้ง APK ลงมือถือ, ห้ามเปลี่ยนการตั้งค่ามือถือ, ห้ามรัน adb สั่งงานบนเครื่องผู้ใช้** โดยไม่ถามผู้ใช้ก่อน (สร้าง APK ได้ ขออนุมัติก่อนติดตั้ง)
- ห้ามส่งข้อความถึงคน/โพสต์/ซื้อ/ใช้จ่าย; ห้ามเปิดเซิร์ฟเวอร์ให้เครื่องอื่นเข้าถึง (ฟังที่ 127.0.0.1 เท่านั้น) เพราะ `/api/ask` ใช้ quota Claude Code
- ห้ามลบ/เขียนทับ `app/` (เว็บเวอร์ชัน) และ `voice-samples/`, `models/` (โมเดล 570MB+) — แก้เพิ่มได้เฉพาะที่จำเป็น
- ไม่เก็บ/ส่งเสียงออกนอกเครื่อง Mac
- minSdk 24, ไม่ใช้ไลบรารีหนัก (ตอนนี้ไม่ใช้ AndroidX)
- Build: `cd android && JAVA_HOME=/opt/homebrew/opt/openjdk@17 ./gradlew assembleDebug`
- Android SDK: `~/Library/Android/sdk`; adb: `~/Library/Android/sdk/platform-tools/adb`
- ถ้าติดสิ่งที่ต้องให้ผู้ใช้ตัดสินใจ/ทำเอง ให้หยุดและรายงาน อย่าเดา

## เสร็จเมื่อ
- `assembleDebug` ผ่าน ได้ `mochi-debug.apk` ใหม่ (ใช้ชื่อ Neo)
- รายงานตามจริงว่าอะไรผ่านการตรวจ (build/unit/ตรรกะที่ทดสอบบน Mac) และอะไรยังต้องทดสอบบน A7 จริง
- อัปเดต `PLAN.md` ส่วนสถานะ และ `app/README.md`
