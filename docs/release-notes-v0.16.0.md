Relay Remote: use Relay from your phone.

## What changed
- **Settings > Remote.** Turn it on, Pair a phone, scan the QR code, tap Pair, then Add to Home Screen. The phone page has your Jarvis reactor: type, or hold it and talk. Your Mac does the work with Claude and sends the answer back as text and speech. No app and no developer account.
- **Your Mac does everything:** open apps, write notes, read Gmail and Calendar, run background agents. It cannot control the phone's own apps. Sends and deletes still ask for approval on the Mac.
- **Secure by design:** off until you turn it on, a one-time pairing code, a private token per phone, only your own network or Tailscale allowed in.
- **Tailscale** (optional, free) for away from home and for hold to talk (the phone's microphone needs a secure address). Relay can set up the secure link for you.

Tested: the server, pairing, the phone page driven end to end in a phone-sized browser (pair, type, status, answer, unpair), and the settings page. Not tested by me: a real iPhone, the phone's speech recognition and speech, the macOS firewall prompt, and the Tailscale button (Tailscale is not installed on my machine).

## Requirements
**macOS 26 or later.** Apple Silicon (`arm64`) and Intel (`x64`) builds are attached below. Phone: Safari on iOS 15 or later.

Full list of changes: [CHANGELOG.md](https://github.com/serjdmitri/Relay/blob/main/CHANGELOG.md)
