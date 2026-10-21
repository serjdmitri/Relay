First public version of Relay, a menu bar Mac assistant that acts on spoken requests.

## What it does
- Press Right Option, dictate with Talkify into the Ask box, tap again to send. Relay does it and shows a short result.
- Runs on Claude (API key) or a local model through Ollama.
- Tools for apps, files, Finder, Notes, Reminders, Calendar, Messages, key presses, menu clicks, accessibility-tree clicks, screenshots, web search and AppleScript.
- Asks for confirmation before sending messages, trashing files, running shell commands or running destructive-looking AppleScript.
- Routines, a Relay cursor overlay, and an optional Firefox extension for tabs and page reading.

## Install
No prebuilt app is attached to this release. Build it on your Mac:

```bash
git clone https://github.com/serjdmitri/Relay.git
cd Relay
npm run pack
```

The README has the install and first-run steps. You will approve Accessibility, Screen Recording and Input Monitoring once.

## Testing status
- 52 unit tests and a 19-step end-to-end run of the real Electron app (mock model, stub osascript) pass.
- The macOS-specific parts (AppleScript in real apps, global shortcuts, permission prompts) were not verified on a Mac when this was tagged. If something fails, open an issue with what History > Actions shows.

Full list of changes: [CHANGELOG.md](https://github.com/serjdmitri/Relay/blob/main/CHANGELOG.md)
