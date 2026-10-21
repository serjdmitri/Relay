#!/bin/bash
# One-time: creates a local self-signed code-signing certificate, "Relay Local Signing", in your login keychain.
# Signing every build with the same certificate gives Relay a stable identity, so macOS keeps its
# Accessibility, Input Monitoring, Microphone and Screen Recording permissions across rebuilds.
# The certificate never leaves your Mac and is not trusted for anything else.
set -euo pipefail
NAME="Relay Local Signing"
[ "$(uname)" = "Darwin" ] || { echo "Run this on your Mac."; exit 1; }
if security find-identity -p codesigning | grep -q "\"$NAME\""; then
  echo "\"$NAME\" is already in your keychain."
  exit 0
fi
D="$(mktemp -d)"
trap 'rm -rf "$D"' EXIT
cd "$D"
umask 077
cat > cert.cnf <<'CNF'
[req]
distinguished_name = dn
x509_extensions = ext
prompt = no
[dn]
CN = Relay Local Signing
[ext]
basicConstraints = critical,CA:false
keyUsage = critical,digitalSignature
extendedKeyUsage = critical,codeSigning
subjectKeyIdentifier = hash
CNF
PW="$(openssl rand -hex 16)"
openssl req -x509 -newkey rsa:2048 -nodes -keyout key.pem -out cert.pem -days 3650 -config cert.cnf 2>/dev/null
openssl pkcs12 -export -inkey key.pem -in cert.pem -out relay.p12 -name "$NAME" -passout "pass:$PW"
security import relay.p12 -k "$HOME/Library/Keychains/login.keychain-db" -P "$PW" -T /usr/bin/codesign
echo "Created \"$NAME\". macOS may list it as untrusted; that is fine for signing your own app."
