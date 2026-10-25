# Changelog

## 0.5.0

- **Mark the screen.** Hold the mark key (Left ⌃ by default, change it under Shortcuts), circle or scribble over anything on screen with the mouse, let go, then ask about it. Relay looks at that area specifically ("what is this?", "fix this"). A model without image support gets the text in the area instead. The mark stays for three minutes, so you can ask a few things about it. Esc cancels it.
- **A calmer look.** One cyan accent on dark navy everywhere: Settings, the logo and app icon, the pill, the buddy and guides. No purple, no green, no glow. The pill keeps its shape; its cyan accent is two short arcs that follow the pill's own outline.
- **The buddy is a small ring with a cursor triangle.** When Relay draws, the triangle moves along each stroke as it appears, then the label pops in.
- **Fix: drawings and guides sat about 40 points too low.** macOS kept Relay's full-screen overlay window below the menu bar, so marks were shifted down by the menu bar's height. The overlay now sits at the true top of the screen and positions are worked out from where the window really is.
- Settings: General > Look still switches between Jarvis (cyan) and Classic.

## 0.4.0

- **Jarvis look (new default):** a cyan HUD. The buddy is a rotating ring reticle (it pulses while listening, spins faster while thinking and closes into a check when done); the pill pops up with HUD corner brackets, a status readout (LISTENING, WORKING, COMPLETE) and a scanning bar; guides show as a HUD panel with a progress bar; drawings, rings and labels are cyan. Switch back under General > Look > Classic.
- **Guides are far more reliable.** Looking up an element used to go through System Events, which took 30 seconds or timed out in Notes, the Claude app and Xcode. A new native helper (`relay-ax`) walks the accessibility tree directly (0.2 to 0.6 seconds) and wakes up Electron apps' accessibility. If an element has no accessibility name, Relay now reads the text off the screen (Apple's on-device text recognition) and points at that.
- **Guides check what you do.** The highlight stays on until the step is done and follows the element if you move the window. Clicking the highlighted spot (or saying "next") moves on; if the next thing is not there, the highlighted element disappears, or you click somewhere else, Relay looks at the screen and rewrites the remaining steps.
- `ui_list` is much faster too (the same helper).

## 0.3.1

- Guides now move on by themselves. Relay outlines the element for the current step, and when you click it (or say "next") it goes to the next step and outlines that one. Before, "next" was heard as a new request (it skipped a Spotify song) and the model had to be asked again for every step. While a guide is up, "next", "back" and "stop" are for the guide; "next song" still goes to the music commands.
- Guides and drawings always show something on screen: an outline around the element, or a ring around a spot. `draw_on_screen` can now outline an element by app and name, exactly, with no screenshot, so it works with text-only models too.
- Buddy cursor: smaller, closer to the pointer, and the spinner is now centered on the orb.

## 0.3.0

- Buddy cursor: a small helper follows your pointer while Relay listens and works (a mic meter, a spinner, then a check), and flies to what it points at. New setting: General > Buddy cursor.
- Show me: Relay can point at an exact on-screen element (`point_at_element`, from the accessibility tree, so it works even with models that cannot see images), draw boxes, circles, arrows and labels (`draw_on_screen`), and walk you through a task with a step card (`guide_step`; say "next" to go on). Marks stay about 30 seconds or until you press Esc or start a new request.
- On-screen marks and the buddy work on every display, and screenshots now capture the display you are on. The buddy and marks are hidden while a screenshot is taken so the model does not see them.
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
