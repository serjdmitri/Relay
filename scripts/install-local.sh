#!/bin/bash
# Installs the app you just built into /Applications, signed with YOUR local "Relay Local Signing" certificate, and opens it.
#   bash scripts/install-local.sh [arm64|x64]
# Why the signing matters: macOS ties Relay's saved keys (Keychain), Accessibility, Camera and other permissions to how the app is signed. Signed the same way every time,
# an update keeps all of them. Signed differently (ad-hoc is a new identity per build), macOS asks again for the Keychain after every install, and until you answer,
# Relay's main thread waits and its window stays blank. The old app is kept in ~/Downloads as a backup.
set -euo pipefail
cd "$(dirname "$0")/.."
[ "$(uname)" = "Darwin" ] || { echo "Run this on your Mac."; exit 1; }
case "${1:-$(uname -m)}" in arm64|aarch64) DIR=dist/mac-arm64 ;; x64|x86_64) DIR=dist/mac ;; *) echo "Unknown architecture: ${1}"; exit 1 ;; esac
APP="$DIR/Relay.app"; DEST=/Applications/Relay.app; IDENT="Relay Local Signing"
[ -d "$APP" ] || { echo "No build at $APP. Run: bash scripts/make-dmg.sh"; exit 1; }
security find-identity -p codesigning | grep -q "\"$IDENT\"" || { echo "The \"$IDENT\" certificate is missing. Run once: bash scripts/setup-signing.sh"; exit 1; }
NEW=$(/usr/libexec/PlistBuddy -c "Print CFBundleShortVersionString" "$APP/Contents/Info.plist")
dr() { codesign -dr - "$1" 2>&1 | sed -n 's/^designated => //p'; }

# 1. quit the running Relay, politely
if pgrep -x Relay >/dev/null; then
  osascript -e 'tell application "Relay" to quit' >/dev/null 2>&1 || true
  for _ in $(seq 1 25); do pgrep -x Relay >/dev/null || break; sleep 1; done
  pgrep -x Relay >/dev/null && { echo "Relay did not quit. Quit it from the menu bar and run this again."; exit 1; }
fi

# 2. sign the new app with the local certificate: the helpers first, then everything
for h in "$APP"/Contents/Resources/native/relay-*; do [ -f "$h" ] && [ -x "$h" ] && codesign --force --sign "$IDENT" "$h" >/dev/null 2>&1 || true; done
codesign --force --deep --sign "$IDENT" "$APP"
codesign --verify --deep --strict "$APP"
NEW_DR=$(dr "$APP")

# 3. keep the old app as a backup, then copy the new one in
OLD_DR=""
if [ -d "$DEST" ]; then
  OLD=$(/usr/libexec/PlistBuddy -c "Print CFBundleShortVersionString" "$DEST/Contents/Info.plist" 2>/dev/null || echo old)
  OLD_DR=$(dr "$DEST")
  BACKUP="$HOME/Downloads/Relay-$OLD-backup.app"; [ -e "$BACKUP" ] && BACKUP="$HOME/Downloads/Relay-$OLD-backup-$(date +%H%M%S).app"
  mv "$DEST" "$BACKUP"; echo "Kept the old Relay $OLD at $BACKUP"
fi
ditto "$APP" "$DEST"
echo "Installed Relay $NEW."

# 4. will macOS ask about the Keychain?
if [ -n "$OLD_DR" ] && [ "$OLD_DR" != "$NEW_DR" ]; then
  echo "NOTE: this build is signed differently from the one it replaced. macOS will ask once for Keychain access: click Always Allow (look for the prompt; Relay waits for it)."
else
  echo "Signed with your local certificate. macOS may still ask ONCE for Keychain access (\"Relay wants to access key Relay Safe Storage\"): enter your Mac login password and click Always Allow. Until you answer, Relay's window stays blank, and Deny would stop it reading its saved keys and face data."
fi
open -a "$DEST"
