# Changelog

## Unreleased

- Docs and site: the main pitch is now "No API key: it runs on the Claude plan you already have" (through your own Claude Code). API keys and Ollama are options. No app changes.

## 0.2.0

- More model services: OpenAI (ChatGPT API), Google Gemini, Groq, Mistral, xAI, DeepSeek and a custom OpenAI-compatible address, each with its own key and model. Pick one under Account > Model service.
- Calmer look: a neutral gray interface with one indigo accent. Each page tints only the soft glows at the top and bottom of the window and the selected sidebar item; the rest of the sidebar stays gray.
- The sidebar can be collapsed to the left (button in the top bar, or ⌘\) to give the page the whole window. Relay remembers the choice.
- README, website, diagram, charts and screenshots updated to match. 136 unit tests.
- No change to how Sign in with Claude works. It stays an unsupported, personal-use path (see the README).

## 0.1.1

- New colourful app icon and in-app logo, and the interface accent colour is now the logo's indigo instead of blue.
- Website at https://serjdmitri.github.io/Relay/ (served from `docs/`), with live download links.
- README: screenshots, architecture diagram, charts, and a note on how the model options work.
- `npm run shots` works with the current interface and finds Chrome on macOS; new `npm run charts` and `npm run readme-images`.
- No change to how the app signs in or picks a model.

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
