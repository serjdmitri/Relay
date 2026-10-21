First public version of Relay, a menu bar Mac assistant that acts on spoken requests.

## What it does
- Hold or tap **Right Option** and talk: Relay opens apps, writes notes and reminders, reads your calendar, clicks through interfaces, drives Firefox and answers from the web.
- **Right Command** is dictation: your words are typed where the cursor is. Speech recognition is on-device (Apple SpeechAnalyzer), so no separate dictation app is needed. [Talkify](https://github.com/tornikegomareli/Talkify) still works too, since the Ask box (`Option+T`) is a normal text field.
- Instant commands (timers, music, volume, notes, reminders, open apps) run in about a third of a second without a model call.
- Runs on Claude (your own signed-in Claude Code, an API key, or automatic Haiku/Sonnet routing) or a local Ollama model.
- Asks for confirmation before sending messages, trashing files, running shell commands or running destructive-looking AppleScript.

## Requirements
**macOS 26 or later.** Dictation and the glass pill use new macOS 26 APIs.

## Install
Download the `.dmg` below (`arm64` for Apple Silicon, `x64` for Intel) and drag Relay to Applications. It is not notarized, so the first time, right-click Relay and choose Open, or run `xattr -dr com.apple.quarantine /Applications/Relay.app`. You will approve Microphone, Accessibility, Screen Recording and Input Monitoring once.

Or build from source: see the [README](https://github.com/serjdmitri/Relay#install-from-source-on-your-mac).

## Claude account sign-in
Signing in with a Claude account is meant for your own use on your own Mac. Anthropic does not allow third-party apps to offer claude.ai login to others, so if you share a build, use an API key or Ollama.

## Testing status
- 129 unit tests pass. The dictation helper was run on real generated speech, and the Claude runner on real tool calls through a signed-in `claude`.
- Live microphone dictation end to end, music control, permission prompts and AppleScript against every app have only been tried by hand. If something fails, open an issue with what History > Actions shows.

Full list of changes: [CHANGELOG.md](https://github.com/serjdmitri/Relay/blob/main/CHANGELOG.md)
