# Changelog

## 0.1.0

Distributed as ad-hoc signed `.dmg` files (arm64 and x64) built by GitHub Actions.

First public version.

- Ask pill: press Right Option, dictate with Talkify, tap again to send. Tap or hold, Stop, and a clipboard fallback.
- Agent with Claude or Ollama, and tools for apps, files, Finder, Notes, Reminders, Calendar, Messages, key presses, menu clicks, accessibility-tree clicks, screenshots, pixel clicks, web search and fetch, volume, dark mode, AppleScript and shell.
- Confirmation card before sending messages, trashing files, running shell commands or destructive-looking AppleScript.
- Relay cursor overlay that glides to the target before a click.
- Routines: record, say in one go, or save the last request.
- Optional Firefox extension for tabs, page reading, clicking and typing (localhost only, extension origin only).
- Window with Home, History (requests and actions), Routines, Vocabulary, General, Model, Shortcuts and Permissions, plus a 7-step first-run flow.
- 52 unit tests and an end-to-end suite that drives the real app.

Known gaps: macOS-specific behavior was not verified on a Mac at commit time.
