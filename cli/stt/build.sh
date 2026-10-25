#!/bin/bash
# Builds the signed neo-stt helper: cli/dist/neo-stt  (the .app build copies it to Neo Console.app/Contents/MacOS/neo-stt)
#   NEO_SIGN_IDENTITY  signing identity (default: the Apple Development one). Never ad hoc ("-").
#   NEO_STT_OUT        output path (default ../dist/neo-stt)
# Info.plist is embedded in the Mach-O: a bare command-line tool needs NSSpeechRecognitionUsageDescription
# or macOS kills it when it asks for Speech permission.
set -euo pipefail
cd "$(dirname "$0")"

IDENTITY="${NEO_SIGN_IDENTITY:-<Apple Development identity>}"
OUT="${NEO_STT_OUT:-../dist/neo-stt}"

if [ "$IDENTITY" = "-" ]; then echo "ad hoc signing is not allowed" >&2; exit 1; fi

mkdir -p "$(dirname "$OUT")"
swiftc -O -o "$OUT" neo-stt.swift \
  -Xlinker -sectcreate -Xlinker __TEXT -Xlinker __info_plist -Xlinker Info.plist
codesign --force --sign "$IDENTITY" --options runtime -i com.mochi.neo.stt "$OUT"
codesign --verify --strict --verbose=2 "$OUT"
echo "built $OUT"
