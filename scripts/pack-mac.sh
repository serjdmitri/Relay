#!/bin/bash
# Builds Relay.app for this Mac and ad-hoc signs it. Run on macOS: npm run pack
set -euo pipefail
cd "$(dirname "$0")/.."
[ "$(uname)" = "Darwin" ] || { echo "Run this on your Mac."; exit 1; }

npm install
bash scripts/build-speech.sh
node scripts/make-icons.mjs 2>/dev/null || echo "(icons already in assets/, skipping regeneration)"

if [ "$(uname -m)" = "arm64" ]; then ARCH=--arm64; DIR=dist/mac-arm64; else ARCH=--x64; DIR=dist/mac; fi
npx electron-builder --mac --dir "$ARCH"

APP="$DIR/Relay.app"
xattr -cr "$APP"

# Sign with the stable local certificate if it exists (run scripts/setup-signing.sh once), otherwise ad-hoc.
# Ad-hoc signatures change on every build, so macOS asks for Accessibility, Input Monitoring, Microphone
# and Screen Recording again after each rebuild. The certificate keeps one identity across builds.
IDENTITY="Relay Local Signing"
if security find-identity -p codesigning | grep -q "\"$IDENTITY\""; then
  SIGN="$IDENTITY"
  echo "Signing with \"$IDENTITY\" (stable identity: permissions are kept across rebuilds)."
else
  SIGN="-"
  echo "Signing ad-hoc. Run: bash scripts/setup-signing.sh once to stop macOS re-asking for permissions after each rebuild."
fi
# The dictation helper first, so the app's signature covers it.
codesign --force --sign "$SIGN" "$APP/Contents/Resources/native/relay-speech"
codesign --force --sign "$SIGN" "$APP/Contents/Resources/native/relay-glass"
codesign --force --sign "$SIGN" "$APP/Contents/Resources/native/relay-ax"
codesign --force --deep --sign "$SIGN" "$APP"

echo
echo "Built $APP"
echo "Install:  rm -rf /Applications/Relay.app && cp -R \"$APP\" /Applications/ && open /Applications/Relay.app"
