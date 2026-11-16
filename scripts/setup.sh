#!/bin/bash
# One command to get Relay running from source on your Mac:  bash scripts/setup.sh
# It checks what is needed, installs the packages, creates the local signing certificate (so macOS keeps Relay's permissions and its Keychain "Always Allow" between builds),
# builds the app, installs it into /Applications and opens it. Safe to run again: each step skips what is already done.
set -euo pipefail
cd "$(dirname "$0")/.."

say() { printf '\n==> %s\n' "$1"; }
die() { printf '\nStopped: %s\n' "$1" >&2; exit 1; }

[ "$(uname)" = "Darwin" ] || die "Relay runs on macOS."
major=$(sw_vers -productVersion | cut -d. -f1)
[ "$major" -ge 26 ] || die "Relay needs macOS 26 or later (this Mac has $(sw_vers -productVersion))."
command -v node >/dev/null || die "Node 20 or newer is needed. Install it with: brew install node"
[ "$(node -p 'process.versions.node.split(".")[0]')" -ge 20 ] || die "Node 20 or newer is needed (this is $(node -v))."
xcode-select -p >/dev/null 2>&1 || die "The command line tools are needed for the dictation helper. Run: xcode-select --install"

say "Checking the AI tools"
if command -v claude >/dev/null; then echo "Claude Code found."; else echo "Claude Code is not installed. Relay can use your Claude account through it: https://claude.ai/code (you can add it later)."; fi
if command -v codex >/dev/null; then echo "Codex found."; else echo "Codex is not installed (optional: it takes over when Claude runs out of usage)."; fi

say "Installing packages"
npm install

say "Creating the local signing certificate (once)"
bash scripts/setup-signing.sh

say "Building the app (this takes a few minutes)"
npm run pack

say "Installing into /Applications"
case "$(uname -m)" in arm64) ARCH=arm64 ;; *) ARCH=x64 ;; esac
bash scripts/install-local.sh "$ARCH"

cat <<'DONE'

Relay is installed and opening. The first time, macOS may ask for access to "Relay Safe Storage":
enter your Mac password and click Always Allow. It will not ask again after this.

Then follow the first-launch steps in the window: sign in, microphone, accessibility, screen recording.
Settings > Keys & accounts shows what Relay can use and what each key is for.
DONE
