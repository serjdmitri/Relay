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
