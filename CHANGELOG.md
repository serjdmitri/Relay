# Changelog

## 0.1.0

Distributed as ad-hoc signed `.dmg` files (arm64 and x64) built by GitHub Actions. Needs macOS 26 or later.

First public version.

- Ask pill: Right Option (tap or hold) to talk to Relay, `⌥T` to type a request, Esc to cancel. A pill that drops out of the notch, with real glass on macOS 26.
- Built-in on-device dictation (Apple SpeechAnalyzer through a small Swift helper): Right Command types what you say where your cursor is. Spoken "new line", "new paragraph" and "scratch that", word fixes, per-app dictation style, dictation history. Talkify is no longer required.
- Instant commands with no model call: open and quit apps, URLs and web search, music and media keys, timers and alarms, reminders and notes, volume, brightness, dark mode, lock screen, time and battery. "Undo that" and "do it again".
- Claude through your own signed-in Claude Code (local tool server on 127.0.0.1) with automatic Haiku/Sonnet routing, or an Anthropic API key, or a local Ollama model.
- Agent tools for apps, files, Finder, Notes, Reminders, Calendar, Messages, key presses, menu clicks, accessibility-tree clicks, screenshots, clipboard and selection, web search and fetch, AppleScript and shell.
- Confirmation card before sending messages, trashing files, running shell commands or destructive-looking AppleScript.
- Relay cursor overlay that glides to the target before a click. Routines. Optional spoken replies.
- Optional Firefox extension for tabs, page reading, clicking and typing (localhost only, extension origin only).
- Window with Home, History (requests, actions, dictation), Routines, Vocabulary, General, Account, Speech, Shortcuts and Permissions, plus a first-run flow.
- 129 unit tests.

Known gaps: live microphone dictation end to end, music control, permission prompts and some AppleScript flows have only been tried by hand. The end-to-end script and screenshot script predate dictation and the Claude sign-in. Claude account sign-in is for personal use only (see the README).
