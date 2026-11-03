#!/bin/bash
# Builds an ad-hoc signed Relay.app and wraps it in a .dmg. Run on macOS.
#   bash scripts/make-dmg.sh [arm64|x64]     (defaults to this Mac's architecture)
# The Swift helpers (dictation, glass) are compiled for this Mac's architecture and need the macOS 26 SDK,
# so the architecture you ask for has to match the Mac you run this on.
set -euo pipefail
cd "$(dirname "$0")/.."
[ "$(uname)" = "Darwin" ] || { echo "Run this on a Mac (needs hdiutil and codesign)."; exit 1; }

case "${1:-$(uname -m)}" in
  arm64|aarch64) EB=--arm64; DIR=dist/mac-arm64; NAME=arm64 ;;
  x64|x86_64)    EB=--x64;   DIR=dist/mac;       NAME=x64 ;;
  *) echo "Unknown architecture: ${1}"; exit 1 ;;
esac
VERSION=$(node -p "require('./package.json').version")
[ "$NAME" = "$([ "$(uname -m)" = arm64 ] && echo arm64 || echo x64)" ] || { echo "Build $NAME on a $NAME Mac: the Swift helpers are native."; exit 1; }

bash scripts/build-speech.sh
npx electron-builder --mac --dir "$EB"

APP="$DIR/Relay.app"
xattr -cr "$APP"
codesign --force --sign - "$APP/Contents/Resources/native/relay-speech"
codesign --force --sign - "$APP/Contents/Resources/native/relay-glass"
codesign --force --sign - "$APP/Contents/Resources/native/relay-ax"
# Ad-hoc signature. Required to launch on Apple Silicon. It is not a Developer ID signature,
# so downloaded copies need right-click > Open the first time (see README).
codesign --force --deep --sign - "$APP"
codesign --verify --deep --strict "$APP"

# Prove the built app really STARTS before a .dmg is made from it (it launches a copy with a throwaway profile; see scripts/startup-check.js).
# 0.38.0 and 0.38.1 were published with a window that stayed blank, and nothing caught it.
if [ "${SKIP_STARTUP_CHECK:-0}" != 1 ]; then
  echo "Checking that the built app starts..."
  node scripts/startup-check.js "$APP" || { echo "The startup check failed, so no .dmg was made. (SKIP_STARTUP_CHECK=1 skips it.)"; exit 1; }
fi

STAGE=$(mktemp -d)
cp -R "$APP" "$STAGE/"
ln -s /Applications "$STAGE/Applications"
OUT="dist/Relay-$VERSION-$NAME.dmg"
hdiutil create -volname "Relay" -srcfolder "$STAGE" -ov -format UDZO "$OUT"
hdiutil verify "$OUT"
rm -rf "$STAGE"
echo "Built $OUT"
