#!/bin/bash
# Builds Relay.app for this Mac and ad-hoc signs it. Run on macOS: npm run pack
set -euo pipefail
cd "$(dirname "$0")/.."
[ "$(uname)" = "Darwin" ] || { echo "Run this on your Mac."; exit 1; }

npm install
node scripts/make-icons.mjs 2>/dev/null || echo "(icons already in assets/, skipping regeneration)"

if [ "$(uname -m)" = "arm64" ]; then ARCH=--arm64; DIR=dist/mac-arm64; else ARCH=--x64; DIR=dist/mac; fi
npx electron-builder --mac --dir "$ARCH"

APP="$DIR/Relay.app"
xattr -cr "$APP"
# Ad-hoc signature: required to run on Apple Silicon. The same identity is kept between rebuilds only
# if you re-sign the same way, otherwise macOS may ask for the permissions again.
codesign --force --deep --sign - "$APP"

echo
echo "Built $APP"
echo "Install:  rm -rf /Applications/Relay.app && cp -R \"$APP\" /Applications/ && open /Applications/Relay.app"
