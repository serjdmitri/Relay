#!/bin/bash
# Builds native/build/relay-speech, the on-device dictation helper (Apple SpeechAnalyzer, macOS 26+).
set -euo pipefail
cd "$(dirname "$0")/../native"
[ "$(uname)" = "Darwin" ] || { echo "Run this on your Mac."; exit 1; }
command -v swiftc >/dev/null || { echo "swiftc not found. Install Xcode or the command line tools: xcode-select --install"; exit 1; }
mkdir -p build
swiftc -O -swift-version 5 -parse-as-library relay-speech.swift -o build/relay-speech \
  -Xlinker -sectcreate -Xlinker __TEXT -Xlinker __info_plist -Xlinker speech-Info.plist
echo "Built native/build/relay-speech"
# The glass behind the pill (needs macOS 26 to draw real glass; falls back to blur on older systems).
swiftc -O -swift-version 5 relay-glass.swift -o build/relay-glass
echo "Built native/build/relay-glass"
# Fast accessibility lookups and on-screen text finding, for pointing and guides.
swiftc -O -swift-version 5 relay-ax.swift -o build/relay-ax
echo "Built native/build/relay-ax"
# On-device text embeddings and PDF text, for "ask my notes".
# If it does not build here, a stand-in that says "no embeddings" is put in its place, so packing still works and "ask my notes" searches by words only.
if swiftc -O -swift-version 5 relay-embed.swift -o build/relay-embed; then echo "Built native/build/relay-embed"; else
  printf '#!/bin/sh\nexit 2\n' > build/relay-embed && chmod +x build/relay-embed
  echo "relay-embed did not build: ask my notes will search by words only"
fi
