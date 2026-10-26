# Neo

Neo เป็นสัตว์เลี้ยงที่อยู่บนจอมือถือ Android เรียกชื่อแล้วพูดคำถามได้เลย ตัวที่ทำงานจริงเป็น AI บน Mac (Claude Code, agent ที่คุยผ่าน ACP เช่น opencode หรือ endpoint ที่ตั้งเอง) มันจะหาคำตอบแล้วส่งกลับมาเป็นการ์ดบนจอ Neo ตั้งปลุกได้ จำเรื่องที่เล่าให้ฟังได้ หลับได้ และพอเราไม่อยู่มันก็ "ฝัน" คือเอาความจำมาจัดระเบียบใหม่

เสียงถอดเป็นข้อความบน Mac ไม่ได้ส่งไฟล์เสียงออกนอกเครื่อง

## ส่วนประกอบ

| โฟลเดอร์ | ชื่อ | หน้าที่ | ภาษา |
|---|---|---|---|
| `cli/` | **NeoCli** | Neo daemon (รันเองผ่าน launchd) กับคำสั่ง `neo` ทุกอย่างที่ Neo ทำได้ สั่งจาก Terminal ได้หมด | Bun + TypeScript |
| `cli/stt/` | `neo-stt` | ตัวช่วยถอดเสียงไทยบนเครื่อง (Speech framework) | Swift |
| `console/` | **Neo Console** | แอป Mac ไว้ตั้งค่าและดูสถานะ ทุกปุ่มเรียก `neo … --json` อยู่เบื้องหลัง ปิดแอปไป Neo ก็ยังทำงาน | Swift / SwiftUI |
| `android/` | **NeoApp** | หน้าตา ไมค์ การ์ด เสียง และหน้าตั้งค่าบนมือถือ | Kotlin |
| `contract/` | contract suite | ชุดทดสอบที่ยิงใส่ backend เหมือนมือถือจริง ใช้เทียบของเก่ากับ NeoCli | Bun |
| `app/` | ของเก่า | backend Node และ Neo.app รุ่นแรก รอลบหลัง cutover | Node / Swift |

มือถือคุยกับ daemon ผ่าน port 8000 และทุก route ต้องใช้ device token ที่ได้ตอนจับคู่ ส่วนคำสั่ง `neo` คุยผ่าน unix socket `neo.sock` (สิทธิ์ 0600) ใน NEO_HOME โปรโตคอลทั้งหมดนิยามไว้ที่เดียวคือ `cli/src/protocol.ts` ฝั่ง Kotlin (`Protocol.kt`) generate จากไฟล์นี้

## ต้องมี

- Mac ชิป Apple Silicon, macOS 13 ขึ้นไป
- [Bun](https://bun.sh) 1.4 ขึ้นไป, Xcode command line tools และใบรับรอง **Apple Development** ใน keychain (ใช้ sign ไฟล์ ถ้า sign แบบ ad hoc สิทธิ์ Full Disk Access จะหายทุกครั้งที่ build ใหม่)
- JDK 17 สำหรับ build NeoApp (`brew install openjdk@17`)
- AI อย่างน้อยหนึ่งตัว: [Claude Code](https://docs.anthropic.com/claude-code), agent ที่รองรับ ACP (เช่น opencode) หรือ endpoint แบบ OpenAI-compatible
- มือถือ Android 7 ขึ้นไป

## Build และติดตั้ง

```bash
# 1. NeoApp
cd android && JAVA_HOME=/opt/homebrew/opt/openjdk@17 ./gradlew assembleDebug && cd ..

# 2. NeoCli และตัวถอดเสียง
cd cli && bun install && bun run build && (cd stt && ./build.sh) && cd ..

# 3. Neo Console (รวม neo, neo-stt และ neo.apk ไว้ในแอป)
NEO_FLAVOR=release console/build.sh
cp -R "console/build/Neo Console.app" ~/Applications/
open ~/Applications/"Neo Console.app"
```

เปิดครั้งแรกจะมีหน้าตั้งค่าพาทำ 6 ขั้น ได้แก่ ตรวจเครื่อง (ติดตั้ง daemon ใน launchd และลิงก์ `neo` ไว้ที่ `~/.local/bin`), ชื่อเรียก, หน้าตา, สมอง และจับคู่มือถือ ระหว่างนั้นให้กด Allow ตอนถามสิทธิ์ Speech Recognition และเพิ่ม Neo Console.app ใน System Settings → Privacy & Security → Full Disk Access

ถ้าไม่ได้ build ในโหมด `NEO_FLAVOR=release` จะได้ **Neo Console Dev.app** ซึ่งใช้ label, โฟลเดอร์ข้อมูล และ port 8100 แยกของตัวเอง เลยไม่ไปยุ่งกับ Neo ตัวจริง

## จับคู่มือถือ

1. เลือกวิธีให้มือถือต่อถึง Mac (เลือกแบบไหนก็ได้)
   - **Tailscale** (แนะนำ): ลงไว้ทั้งสองเครื่อง ใช้บัญชีเดียวกัน
   - **Wi-Fi เดียวกัน**: `neo settings set lan true` (ข้อมูลในวง Wi-Fi ไม่ได้เข้ารหัส)
   - **USB**: `adb reverse tcp:8000 tcp:8000`
   - **URL ของคุณเอง**: tunnel หรือ reverse proxy ที่ชี้มาที่ `http://127.0.0.1:8000`
2. สั่ง `neo devices pair` หรือกด "จับคู่มือถือ" ใน Neo Console จะได้รหัส 6 หลักกับที่อยู่ที่ต่อได้
3. เปิด `<ที่อยู่>/neo.apk` ในเบราว์เซอร์มือถือเพื่อลงแอป แล้วใส่ที่อยู่กับรหัส
4. เรียกชื่อ แล้วพูดคำสั่ง ถ้าเงียบไป 3 วินาทีจะถือว่าพูดจบ

กดหน้าจอมือถือค้างไว้ 3 วินาทีจะเข้าหน้าตั้งค่าบนมือถือ (สมอง, model, การฟัง, หน้าตา, งานตั้งเวลา, ความจำ, ความฝัน)

## คำสั่ง `neo`

```bash
neo status                         # สถานะตอนนี้
neo say "พรุ่งนี้ฝนตกไหม"             # พิมพ์คุยกับ Neo ใช้ทางเดียวกับเสียงพูด
neo provider list | use <ชื่อ>       # ดูและสลับสมอง
neo jobs add "ปลุกพรุ่งนี้ตีห้าครึ่ง"     # ตั้งปลุกด้วยประโยคธรรมดา
neo memory show                    # ความจำ (memory.md)
neo dream now                      # ให้ฝันเดี๋ยวนี้
neo pet sleep                      # หลับลึก (ปิดไมค์ แตะจอเพื่อปลุก)
neo doctor                         # ตรวจเครื่อง
neo daemon status | restart        # daemon ใน launchd
```

`neo --help` มีคำสั่งครบทุกตัว และเกือบทุกคำสั่งรับ `--json` ได้

## ข้อมูลอยู่ที่ไหน

- ข้อมูลทั้งหมด: `~/Library/Application Support/Neo` เป็นไฟล์ Markdown ที่เปิดแก้เองได้ เช่น `memory.md`, `jobs.md`, `journal/<วัน>.md`, `dreams/`, `animations/` ส่วน API key เก็บไว้เป็นไฟล์สิทธิ์ 0600
- log: `~/Library/Logs/Neo/daemon.log`
- ถอนการติดตั้ง: `neo daemon uninstall` แล้วลบ Neo Console.app กับสองโฟลเดอร์ข้างบน

## พัฒนาต่อ

```bash
cd cli && bun test && bunx tsc --noEmit       # unit/integration (claude ตัวปลอม ไม่เปลือง quota)
cd cli && bun run gen:kotlin                  # สร้าง Protocol.kt ใหม่หลังแก้ protocol.ts
cd contract && CONTRACT_BACKEND=neocli bun test
cd console && swift test
cd android && ./gradlew testDebugUnitTest
```

เทสทุกตัวใช้ NEO_HOME ชั่วคราว และใช้ `claude` ตัวปลอมจาก `contract/bin` / `cli/test/fake-bin` ไม่ไปแตะข้อมูลจริงหรือ AI ตัวจริง

ศัพท์ที่ใช้ในโปรเจกต์อยู่ใน [GLOSSARY.md](GLOSSARY.md) สเปกและตั๋วงานอยู่ใน `.scratch/neo-split/` และ `.scratch/neo-build/`
