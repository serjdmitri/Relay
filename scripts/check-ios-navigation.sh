#!/bin/bash
set -euo pipefail
RELAY_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RELAY_NAV_CHECK=$(mktemp -d /tmp/relay-nav-check.XXXXXX)
trap 'rm -rf "$RELAY_NAV_CHECK"' EXIT
swiftc -parse-as-library "$RELAY_ROOT/ios/Navigation/NavigationIntent.swift" "$RELAY_ROOT/ios/Navigation/NavigationModel.swift" "$RELAY_ROOT/ios/Tests/NavigationChecks.swift" -o "$RELAY_NAV_CHECK/check"
"$RELAY_NAV_CHECK/check" "$@"
