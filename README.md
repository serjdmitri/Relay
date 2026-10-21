# Relay

A menu bar assistant for macOS that does things when you talk to it. Relay opens apps, makes notes and reminders, reads your calendar, clicks through interfaces, drives Firefox and answers from the web. It also types what you say into any app. Dictation is built in (Apple's on-device speech recognition), so a separate dictation app is no longer needed. It started as a companion for [Talkify](https://github.com/tornikegomareli/Talkify); you can still use Talkify or any tool that types or pastes text, because the Ask box (`⌥T`) is an ordinary text field.

**[Releases](https://github.com/serjdmitri/Relay/releases)** | [Download](#download) | [Build from source](#install-from-source-on-your-mac) | [Using it](#using-it) | [What is verified](#what-is-verified-and-what-is-not)

> **Status: early (v0.1.0).** The agent, dictation, interface and tests run on a Mac, but many flows have only been tried by hand. Expect rough edges and please open an issue with what the **History > Actions** tab shows.

> **Claude account sign-in is for your own Mac only.** Relay can run your own signed-in Claude Code (`claude`) so you need no API key. Anthropic does not allow third-party apps to offer claude.ai login to other people, so do not hand Relay builds to others expecting that path to be okay. If you share or distribute a build, point it at an **Anthropic API key** or a local **Ollama** model instead (Account page, "Use an API key or a local model instead").

Relay is an independent project. It is not affiliated with Anthropic, [Talkify](https://github.com/tornikegomareli/Talkify) or Octaflow. The window, pages and pill follow Octaflow's layout, with original code, name and icon.

## Download

Tagged versions and release notes are on the [Releases page](https://github.com/serjdmitri/Relay/releases). The `.dmg` files on each release are built by GitHub Actions (`.github/workflows/release.yml`) from the tagged source: `arm64` for Apple Silicon, `x64` for Intel. Both need **macOS 26 or later**. Open the `.dmg` and drag Relay to Applications.

Relay is not notarized by Apple (that needs a paid developer account), so the first launch is blocked by Gatekeeper. Right-click Relay in Applications and choose **Open**, then **Open** again, or run:

```bash
xattr -dr com.apple.quarantine /Applications/Relay.app
```

You will approve Microphone, Accessibility, Screen Recording and Input Monitoring once. Ad-hoc signed downloads change identity with every release, so macOS asks again after you update.

## Install from source (on your Mac)

Needs Node 20+ (`brew install node`), Xcode or the command line tools (`xcode-select --install`, for the dictation helper), macOS 26 or later, and [Claude Code](https://claude.ai/code) signed in to your Claude account (Relay can do the sign-in for you).

```bash
git clone https://github.com/serjdmitri/Relay.git
cd Relay
npm install
npm run pack
rm -rf /Applications/Relay.app && cp -R dist/mac-arm64/Relay.app /Applications/   # dist/mac on Intel
open /Applications/Relay.app
```

`npm run pack` builds the dictation helper, builds the app and signs it. Always run the packaged app, not `npm start`: macOS ties permissions to the app's identity.

Run `npm run signing` once. It creates a local certificate, "Relay Local Signing", in your login keychain, and every build is then signed with it. That gives Relay a stable identity, so macOS keeps Accessibility, Input Monitoring, Microphone and Screen Recording across rebuilds. Without it the build is signed ad-hoc and macOS asks for all of them again after every rebuild.

First launch walks you through: sign in with Claude, Microphone, Accessibility, Screen Recording, Input Monitoring, optional Firefox extension, a dictation check, then a first request.

## Using it

| Shortcut | What it does |
|---|---|
| **Right ⌥** (tap, or hold) | Ask. Talk, then tap again (or let go). Relay does it and the pill shows a short reply. |
| **Right ⌘** (tap, or hold) | Dictate. Talk, and the words are typed where your cursor is. |
| **⌥T** | Type a request instead of talking. |
| **Esc** | Cancel. Tapping Right ⌥ while Relay works also stops it. |

All three can be changed in Shortcuts. Anything that sends a message, moves things to the Trash, runs a shell command or runs a destructive-looking AppleScript shows an Allow / Cancel card first.

### Instant commands
These run at once, with no model call (about a third of a second):
- **Apps and files:** "open Notes", "switch to Safari", "quit Spotify", "open my Downloads folder"
- **Web:** "open github.com", "open YouTube" (the app if you have it, else the site), "google best pizza", "search YouTube for cats"
- **Music and video:** "pause", "play", "next song", "previous song" (Spotify, Music, or the media keys for a browser tab)
- **Timers:** "set a timer for 5 minutes", "how much time is left", "cancel my timer", "set an alarm for 7am" (Relay has to be running; one that comes due while it is closed fires on the next launch)
- **Reminders and notes:** "remind me to call mom at 5pm", "remind me tomorrow at 9 to send the invoice", "new note buy milk", "make a note called Ideas saying build a rocket"
- **System:** "volume down", "mute", "brightness up", "set brightness to 40 percent" (built-in display), "dark mode", "lock my screen", "turn off the display"
- **Facts:** "what time is it", "what's the date", "how much battery do I have"

Everything else goes to Claude.

### Follow-ups and undo
- **"Undo that"** reverses the last instant command (closes what it opened, restores the volume, brightness or dark mode, cancels the timer, deletes the note or reminder it made), takes back the last thing you dictated, or asks Claude to reverse what it just did.
- **"Do it again"** repeats your last request.
- Claude remembers the conversation for five minutes, so "make that bigger" or "now double it" works. Other providers get the last two exchanges as context.

### Screen and clipboard
"Summarize what I copied", "what did I highlight", "what's on my screen": Claude can read the clipboard (text or an image), the text selected in the front app, and a screenshot.

### Routines
- Say "start a routine", do steps, then "save it as start my day".
- Or "when I say start my day, open Calendar and tell me the weather".
- Or after a request, "save that as start my day".
- Then just say the name. Manage them in the Routines tab.

### Dictation
While dictating, say **"new line"** or **"new paragraph"** for line breaks, and **"scratch that"** to drop what you just said (on its own, it undoes the last paste). **Vocabulary > Word fixes** replaces words the recognizer gets wrong ("superbase" becomes "Supabase"), and **History > Dictation > Fix a Word…** makes one from a line you dictated. **Speech > Dictation style by app** types in lowercase with no final period for apps you choose (Messages, say), and can press Return after.

Speech is turned into words on this Mac by Apple's SpeechAnalyzer, through a small Swift helper (`native/relay-speech.swift`). Your voice is not sent anywhere; only the words go to Claude, and only when you ask Relay to do something. Language and microphone are in the Speech tab. With the default "Automatic" microphone, Relay uses the Mac's built-in mic whenever a Bluetooth headset (AirPods) is the system input, because opening a headset mic drops it into low-quality call mode with a delay. Terms you add under Vocabulary are passed to the recognizer as hints.

### The pill and menu bar
The pill is real see-through macOS glass (a small native helper, `native/relay-glass.swift`) that drops out of the notch and retracts into it; on a Mac older than macOS 26, or with **General > Liquid glass pill** off, it is a plain dark pill. The menu bar icon turns into a pulsing red badge while Relay listens and a blue one while it works.

### Spoken replies
Turn on **General > Speak replies**, then pick a voice and speed under **Speech > Spoken replies**. Relay uses the best voice it can find, and uses a natural (Siri, Premium or Enhanced) voice automatically once you have downloaded one: System Settings > Accessibility > Spoken Content > System Voice > Manage Voices. Apps cannot see those voices through Apple's speech API, so Relay speaks through the system `say` command.

### Claude account
Relay runs your own Claude Code (`claude`), already signed in to your Claude account, and gives it Relay's Mac tools over a local-only tool server (127.0.0.1, random port, bearer token). Sign in, sign out and pick the model on the Account page. The default, **Auto**, starts Claude while you are still talking, answers simple requests with Haiku (fastest), starts writing and planning requests on Sonnet, and moves a struggling Haiku request up to Sonnet in the same conversation, so nothing already done is repeated. Pick Haiku, Sonnet or Opus by hand to turn that off. An API key or a local Ollama model is still available under "Use an API key or a local model instead".

This is for your own use on your own Mac. Do not hand Relay builds to other people with this sign-in path: Anthropic does not allow third-party apps to offer claude.ai login to others.

### Tools the agent has
Apps (list, open, focus, quit), URLs and files, Finder (reveal, list, trash), Notes, Reminders, Calendar, Messages (iMessage), type text, key presses, menu bar clicks, accessibility-tree clicks (`ui_list`/`ui_click`), screenshots, pixel clicks and scrolling, a Relay cursor overlay that glides to the target before clicking, web search and page fetch, volume and dark mode, raw AppleScript, shell. Firefox tab tools appear when the extension is connected.

### Firefox
Without the extension Relay can open URLs and use key presses and screenshots. With it, Relay can list and switch tabs, read page text, click and type inside pages. Turn it on in Permissions > Firefox and use **Show Me**: it opens `about:debugging` and the extension folder; choose "Load Temporary Add-on" and pick `manifest.json`. Firefox drops temporary add-ons on quit; Firefox Developer Edition can keep an unsigned one installed. The app only accepts connections from `moz-extension://` origins on 127.0.0.1.

### History > Actions
Every tool call with its arguments and result. If something does not work, look here first.

## What is verified and what is not

Verified on a Mac (`npm test`, 129 tests): shortcut tap/hold logic including Right ⌘ and Esc, the agent loop and confirm gate, both API providers' wire formats, the local tool server and the Claude runner (with a fake `claude`), the dictation helper's protocol, instant commands, AppleScript builders, settings migration, the Firefox bridge. Also run for real: the dictation helper transcribing generated speech, and the Claude runner driving real tool calls (including an image result and a declined confirmation) through a signed-in `claude`.

Not verified by script: live microphone dictation end to end, music control, spoken-command dictation and word fixes with a real voice, the clipboard and selection tools, permission prompts, global shortcut detection, the AppleScript against Notes, Reminders, Calendar, Messages and Finder beyond what you have tried by hand. `scripts/e2e.mjs` and `scripts/screenshots.mjs` predate dictation and the Claude sign-in and have not been updated or re-run. The Actions tab and `Console.app` (filter "Relay") are where errors show up.

## Layout
```
src/main        Electron main process, agent, tools, speech and Claude runners, Firefox bridge
src/renderer    Window, onboarding, pill and cursor overlay (plain HTML/CSS/JS)
native          relay-speech.swift (on-device dictation and brightness), relay-glass.swift (the glass behind the pill)
extension/firefox   WebExtension (MV2)
test            unit tests         scripts   packaging, icons, screenshots, e2e
```

## Contributing

Issues and pull requests are welcome. Before opening a PR run `npm test` on a Mac. `scripts/e2e.mjs` (end-to-end run of the real app with a mock model) predates dictation and the Claude sign-in and needs updating before it is useful again.

## License

[MIT](LICENSE)
