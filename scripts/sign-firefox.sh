#!/bin/bash
# Signs the Firefox extension with Mozilla (free, "unlisted" = not published on the add-ons site) so Firefox keeps it
# after a restart. Without a signature Firefox only keeps it until you quit.
#
# One-time: make a free account at addons.mozilla.org, then open
#   https://addons.mozilla.org/developers/addon/api/key/
# and create API credentials. Put them in your shell, not in a file in this folder:
#   export AMO_JWT_ISSUER="user:12345:67"
#   export AMO_JWT_SECRET="..."
# Needs Mozilla's web-ext (npm i -g web-ext). Then:  bash scripts/sign-firefox.sh
# The signed file lands in extension/signed/. Open it with Firefox (File > Open File) and accept the install.
set -euo pipefail
cd "$(dirname "$0")/.."
: "${AMO_JWT_ISSUER:?Set AMO_JWT_ISSUER (see the comments at the top of this script)}"
: "${AMO_JWT_SECRET:?Set AMO_JWT_SECRET}"
command -v web-ext >/dev/null || { echo "Install web-ext first: npm i -g web-ext"; exit 1; }
mkdir -p extension/signed
web-ext sign --channel=unlisted --source-dir extension/firefox --artifacts-dir extension/signed \
  --api-key "$AMO_JWT_ISSUER" --api-secret "$AMO_JWT_SECRET"
echo "Signed. Open the .xpi in extension/signed/ with Firefox."
