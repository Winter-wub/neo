#!/bin/bash
# Builds the DEV Neo Console: console/build/Neo Console Dev.app
#   - its own bundle id, LaunchAgent label, NEO_HOME, bin dir, log dir and phone port, so it can sit next to the
#     real Neo (com.mochi.neo, ~/Library/Application Support/Neo, port 8000) without touching it;
#   - bundles cli/dist/neo as Contents/MacOS/neo (builds it with `cd cli && bun run build` only when missing);
#   - signed with the Apple Development identity (never ad hoc: it loses Full Disk Access on every rebuild).
#   NEO_SIGN_IDENTITY  signing identity (a Developer ID can be swapped in here later)
set -euo pipefail
cd "$(dirname "$0")"
CONSOLE="$PWD"; REPO="$(cd .. && pwd)"

IDENTITY="${NEO_SIGN_IDENTITY:-<Apple Development identity>}"
[ "$IDENTITY" = "-" ] && { echo "ad hoc signing is not allowed" >&2; exit 1; }

NAME="Neo Console Dev"
BUNDLE_ID="com.mochi.neo.console.dev"
LABEL="com.mochi.neo.dev"
PORT=8100
SUPPORT="$HOME/Library/Application Support/NeoDev"
APP="build/$NAME.app"; C="$APP/Contents"

# the neo binary to bundle
NEO_SRC="$REPO/cli/dist/neo"
if [ ! -x "$NEO_SRC" ]; then (cd "$REPO/cli" && bun run build); fi

swift build -c release --arch arm64
BIN="$(swift build -c release --arch arm64 --show-bin-path)/NeoConsole"

rm -rf "$APP"; mkdir -p "$C/MacOS" "$C/Resources"
cp "$BIN" "$C/MacOS/NeoConsole"
cp "$NEO_SRC" "$C/MacOS/neo"
# the speech helper the daemon starts (cli/stt/build.sh builds and signs it); without it `neo doctor` reports stt as missing
STT_SRC="$REPO/cli/dist/neo-stt"
if [ -x "$STT_SRC" ]; then cp "$STT_SRC" "$C/MacOS/neo-stt"; else echo "warning: $STT_SRC missing (cd cli/stt && ./build.sh): speech will not work" >&2; fi

# what is the bundled neo? Ask it: run a throwaway daemon (temp home, random port) and read `neo daemon status`.
PROBE="$(mktemp -d /tmp/neo-probe.XXXXXX)"
PROBE_PORT=$((20000 + RANDOM % 20000))
NEO_LOGIN_SHELL=/usr/bin/true NEO_DISCOVER=0 NEO_LOG_DIR="$PROBE/logs" "$C/MacOS/neo" daemon run --home "$PROBE" --port "$PROBE_PORT" >/dev/null 2>&1 &
PROBE_PID=$!
for _ in $(seq 1 100); do [ -S "$PROBE/neo.sock" ] && break; sleep 0.1; done
INFO="$(NEO_LAUNCH_LABEL=com.mochi.neo.probe "$C/MacOS/neo" daemon status --json --home "$PROBE")"
kill "$PROBE_PID" 2>/dev/null || true
for _ in $(seq 1 30); do kill -0 "$PROBE_PID" 2>/dev/null || break; sleep 0.1; done
kill -9 "$PROBE_PID" 2>/dev/null || true; wait "$PROBE_PID" 2>/dev/null || true; rm -rf "$PROBE"
DAEMON_VERSION="$(echo "$INFO" | python3 -c 'import json,sys;print(json.load(sys.stdin)["version"])')"
DAEMON_BUILD="$(echo "$INFO" | python3 -c 'import json,sys;print(json.load(sys.stdin)["build"])')"

# icon: Neo's pixel face
if command -v magick >/dev/null && command -v iconutil >/dev/null; then
  T="$(mktemp -d)"
  magick -size 32x32 xc:'#0b0d0c' -fill '#7fffd4' -draw 'rectangle 6,10 11,17' -draw 'rectangle 20,10 25,17' -draw 'rectangle 13,20 18,20' -draw 'point 12,19' -draw 'point 19,19' \
    -fill '#0b0d0c' -draw 'point 7,11' -draw 'point 21,11' -filter point -resize 800x800 \
    \( -size 1024x1024 xc:none -fill white -draw 'roundrectangle 0,0 1023,1023 220,220' \) -gravity center -background none -extent 1024x1024 -compose DstIn -composite "$T/icon.png"
  mkdir "$T/Neo.iconset"
  for s in 16 32 64 128 256 512; do magick "$T/icon.png" -resize ${s}x${s} "$T/Neo.iconset/icon_${s}x${s}.png"; magick "$T/icon.png" -resize $((s*2))x$((s*2)) "$T/Neo.iconset/icon_${s}x${s}@2x.png"; done
  iconutil -c icns "$T/Neo.iconset" -o "$C/Resources/Neo.icns"; rm -rf "$T"
fi

cat > "$C/Info.plist" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>$BUNDLE_ID</string>
<key>CFBundleName</key><string>$NAME</string><key>CFBundleDisplayName</key><string>$NAME</string>
<key>CFBundleExecutable</key><string>NeoConsole</string><key>CFBundleIconFile</key><string>Neo</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleShortVersionString</key><string>0.1-dev</string><key>CFBundleVersion</key><string>0.1-dev</string>
<key>LSMinimumSystemVersion</key><string>13.0</string><key>LSApplicationCategoryType</key><string>public.app-category.utilities</string>
<key>NSHighResolutionCapable</key><true/>
<key>NSSpeechRecognitionUsageDescription</key><string>Neo ถอดเสียงที่คุณพูดใส่มือถือเป็นข้อความในเครื่องนี้ (ไม่ส่งออกอินเทอร์เน็ต)</string>
<key>NSDocumentsFolderUsageDescription</key><string>ให้ AI ของ Neo อ่านและแก้ไฟล์ตามที่คุณสั่ง</string>
<key>NSDesktopFolderUsageDescription</key><string>ให้ AI ของ Neo อ่านและแก้ไฟล์ตามที่คุณสั่ง</string>
<key>NSDownloadsFolderUsageDescription</key><string>ให้ AI ของ Neo อ่านและแก้ไฟล์ตามที่คุณสั่ง</string>
<key>NeoHome</key><string>$SUPPORT</string>
<key>NeoLabel</key><string>$LABEL</string>
<key>NeoPort</key><string>$PORT</string>
<key>NeoBinDir</key><string>$SUPPORT/bin</string>
<key>NeoLogDir</key><string>$HOME/Library/Logs/NeoDev</string>
<key>NeoDaemonVersion</key><string>$DAEMON_VERSION</string>
<key>NeoDaemonBuild</key><string>$DAEMON_BUILD</string>
</dict></plist>
PL

# hardened runtime; neo keeps allow-jit (without it Bun runs ~8x slower) and its own fixed identifier
codesign --force --sign "$IDENTITY" --options runtime --entitlements "$REPO/cli/tools/entitlements.plist" -i com.mochi.neo.cli "$C/MacOS/neo"
[ -f "$C/MacOS/neo-stt" ] && codesign --force --sign "$IDENTITY" --options runtime -i com.mochi.neo.stt "$C/MacOS/neo-stt"
codesign --force --sign "$IDENTITY" --options runtime -i "$BUNDLE_ID" "$APP"
codesign --verify --strict --deep --verbose=2 "$APP"
echo "built $APP (neo $DAEMON_VERSION build $DAEMON_BUILD, label $LABEL, port $PORT, home $SUPPORT)"
