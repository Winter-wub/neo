#!/bin/bash
# Builds the signed neo binary: cli/dist/neo
#   NEO_SIGN_IDENTITY  signing identity (default: the Apple Development one). Never ad hoc ("-"):
#                      it loses Full Disk Access on every rebuild.
#   NEO_OUT            output path (default dist/neo)
#   NEO_BUILD          build id baked into `neo daemon status` (default: short git sha or "dev")
#   NEO_IDENTIFIER     code signing identifier (default com.mochi.neo.cli)
set -euo pipefail
cd "$(dirname "$0")/.."

# the first Apple Development certificate in the keychain unless NEO_SIGN_IDENTITY says otherwise
IDENTITY="${NEO_SIGN_IDENTITY:-$(security find-identity -v -p codesigning | sed -n 's/.*"\(Apple Development: [^"]*\)".*/\1/p' | head -1)}"
[ -n "$IDENTITY" ] || { echo "no Apple Development certificate in the keychain: set NEO_SIGN_IDENTITY" >&2; exit 1; }
OUT="${NEO_OUT:-dist/neo}"
IDENTIFIER="${NEO_IDENTIFIER:-com.mochi.neo.cli}"
BUILD="${NEO_BUILD:-$(git rev-parse --short HEAD 2>/dev/null || echo dev)}"

if [ "$IDENTITY" = "-" ]; then echo "ad hoc signing is not allowed" >&2; exit 1; fi

mkdir -p "$(dirname "$OUT")"
bun build src/main.ts --compile \
  --no-compile-autoload-dotenv --no-compile-autoload-bunfig \
  --define "process.env.NEO_BUILD='$BUILD'" \
  --outfile "$OUT"

# hardened runtime + allow-jit (without it JIT is off and code runs ~8x slower)
codesign --force --sign "$IDENTITY" --options runtime \
  --entitlements tools/entitlements.plist -i "$IDENTIFIER" "$OUT"
codesign --verify --strict --verbose=2 "$OUT"
echo "built $OUT (build $BUILD)"
