#!/bin/sh
# สร้าง Neo.app แบบครบในตัว: SwiftUI + node + server + ตัวถอดเสียงของ Apple + APK — ลากลง /Applications แล้วใช้ได้เลย
# ผลลัพธ์: app/mac/build/Neo.app และ app/mac/build/Neo.zip (ไว้แจก) — Apple Silicon เท่านั้น (node arm64)
set -e
cd "$(dirname "$0")"
REPO="$(cd ../.. && pwd)"
OUT=build; APP="$OUT/Neo.app"; C="$APP/Contents"
rm -rf "$APP"; mkdir -p "$C/MacOS" "$C/Resources/server"
swiftc -parse-as-library -O -target arm64-apple-macos13.0 Sources/*.swift -o "$C/MacOS/Neo"

# node (ใช้ตัวที่ติดตั้งในเครื่อง build — เซ็นโดย Node.js อยู่แล้ว)
NODE="$(python3 -c 'import os,shutil;print(os.path.realpath(shutil.which("node")))')"
cp "$NODE" "$C/Resources/node"
# server (เฉพาะไฟล์ที่ใช้) + ค่าเริ่มต้นของ providers.json + APK
for f in server.js voice.js places.js providers.js discover.js pairing.js neo-agents-mcp.js schedule.js dream.js cards.js; do cp "$REPO/app/$f" "$C/Resources/server/"; done
cat > "$C/Resources/server/providers.default.json" <<'J'
{ "default": "claude", "providers": { "opencode": { "_note": "ใช้เมื่อปิด ข้ามการขออนุญาต", "config": { "mode": "plan" } } } }
J
[ -f "$REPO/mochi-debug.apk" ] && cp "$REPO/mochi-debug.apk" "$C/Resources/neo.apk"

# ไอคอน: หน้า Neo pixel
T=$(mktemp -d)
magick -size 32x32 xc:'#0b0d0c' -fill '#7fffd4' -draw 'rectangle 6,10 11,17' -draw 'rectangle 20,10 25,17' -draw 'rectangle 13,20 18,20' -draw 'point 12,19' -draw 'point 19,19' \
  -fill '#0b0d0c' -draw 'point 7,11' -draw 'point 21,11' -filter point -resize 800x800 \
  \( -size 1024x1024 xc:none -fill white -draw 'roundrectangle 0,0 1023,1023 220,220' \) -gravity center -background none -extent 1024x1024 -compose DstIn -composite "$T/icon.png"
mkdir "$T/Neo.iconset"
for s in 16 32 64 128 256 512; do magick "$T/icon.png" -resize ${s}x${s} "$T/Neo.iconset/icon_${s}x${s}.png"; magick "$T/icon.png" -resize $((s*2))x$((s*2)) "$T/Neo.iconset/icon_${s}x${s}@2x.png"; done
iconutil -c icns "$T/Neo.iconset" -o "$C/Resources/Neo.icns"; rm -rf "$T"

VERSION="0.3"
cat > "$C/Info.plist" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>com.mochi.neo</string>
<key>CFBundleName</key><string>Neo</string><key>CFBundleDisplayName</key><string>Neo</string>
<key>CFBundleExecutable</key><string>Neo</string><key>CFBundleIconFile</key><string>Neo</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleShortVersionString</key><string>$VERSION</string><key>CFBundleVersion</key><string>$VERSION</string>
<key>LSMinimumSystemVersion</key><string>13.0</string><key>LSApplicationCategoryType</key><string>public.app-category.utilities</string>
<key>NSHighResolutionCapable</key><true/>
<key>NSDocumentsFolderUsageDescription</key><string>ให้ AI ของ Neo อ่าน/แก้ไฟล์ตามที่คุณสั่งด้วยเสียง</string>
<key>NSDesktopFolderUsageDescription</key><string>ให้ AI ของ Neo อ่าน/แก้ไฟล์ตามที่คุณสั่งด้วยเสียง</string>
<key>NSDownloadsFolderUsageDescription</key><string>ให้ AI ของ Neo อ่าน/แก้ไฟล์ตามที่คุณสั่งด้วยเสียง</string>
<key>NSRemovableVolumesUsageDescription</key><string>ให้ AI ของ Neo อ่าน/แก้ไฟล์ตามที่คุณสั่งด้วยเสียง</string>
<key>NSNetworkVolumesUsageDescription</key><string>ให้ AI ของ Neo อ่าน/แก้ไฟล์ตามที่คุณสั่งด้วยเสียง</string>
<key>NSSpeechRecognitionUsageDescription</key><string>Neo ถอดเสียงพูดที่มือถือส่งมาเป็นข้อความบน Mac เครื่องนี้ (ไม่ส่งเสียงออกนอกเครื่อง)</string>
<key>NSAppTransportSecurity</key><dict><key>NSAllowsLocalNetworking</key><true/></dict>
<key>NeoRepo</key><string>$REPO</string>
</dict></plist>
PL
codesign --force -s - "$C/MacOS/Neo"; codesign --force -s - "$APP"
(cd "$OUT" && rm -f Neo.zip && ditto -c -k --keepParent Neo.app Neo.zip)
echo "built: $APP ($(du -sh "$APP" | cut -f1)), zip: $(du -sh "$OUT/Neo.zip" | cut -f1)"
