# Relay

A menu bar assistant for macOS that does things when you ask. Dictate with [Talkify](https://github.com/tornikegomareli/Talkify) (or any tool that types or pastes text), and Relay opens apps, writes notes and reminders, reads your calendar, clicks through interfaces, drives Firefox and answers from the web. It runs on Claude or on a local model through Ollama.

**[Download from Releases](https://github.com/serjdmitri/Relay/releases)** | [Build from source](#install-from-source-on-your-mac) | [Using it](#using-it) | [What is verified](#what-is-verified-and-what-is-not)

> **Status: early (v0.1.0).** The agent, interface and tests run, but the macOS-specific parts (AppleScript against real apps, global shortcuts, permission prompts) had not been run on a Mac when this was first committed. Expect rough edges and please open an issue with what the **History > Actions** tab shows.

Relay is an independent project. It is not affiliated with Anthropic, [Talkify](https://github.com/tornikegomareli/Talkify) or Octaflow. Its window and first-run flow are inspired by Octaflow's layout, with original code, name and icon.

## Releases

Tagged versions and release notes live on the [Releases page](https://github.com/serjdmitri/Relay/releases). The `.dmg` files on each release are built by GitHub Actions from the tagged source. The notes say what changed and what was tested.

## Download

Get the `.dmg` for your Mac from the [Releases page](https://github.com/serjdmitri/Relay/releases): `arm64` for Apple Silicon (M1 and later), `x64` for Intel. Open it and drag Relay to Applications.

Relay is not notarized by Apple (that needs a paid developer account), so the first launch is blocked by Gatekeeper. Either right-click Relay in Applications and choose **Open**, then **Open** again, or run:

```bash
xattr -dr com.apple.quarantine /Applications/Relay.app
```

The `.dmg` files are built by GitHub Actions (`.github/workflows/release.yml`) when a release tag is created, so what you download is built from the tagged source.

## Install from source (on your Mac)

Needs Node 20+ (`brew install node`).

```bash
cd relay
npm run pack
rm -rf /Applications/Relay.app && cp -R dist/mac-arm64/Relay.app /Applications/   # dist/mac on Intel
open /Applications/Relay.app
```

`npm run pack` builds the app and ad-hoc signs it (needed on Apple Silicon). Always run the packaged app, not `npm start`: macOS ties permissions to the app's identity, and `npm start` runs as "Electron".

First launch walks you through: model key, Accessibility, Screen Recording, Input Monitoring, optional Firefox extension, a Talkify check, then a first request. macOS shows each permission prompt once. Rebuilding changes the signature, so macOS may ask again after a rebuild.

## Using it

1. Press **Right Option** (tap, or hold). A small pill opens under the menu bar with the cursor in its text box.
2. Dictate with your normal Talkify key. Talkify pastes into the box (and copies to the clipboard, which Relay also watches as a backup).
3. Tap Right Option again (or let go if you held it) to send. Relay does it and the pill shows a one or two sentence result.
4. Tap Right Option while it works, press Esc, or click Stop to cancel.

`Option+T` opens the same box for typing. Both shortcuts can be changed in Shortcuts. If Talkify does not paste into the box, leave "Bring Relay forward while asking" on in General.

Anything that sends a message, moves things to the Trash, runs a shell command or runs a destructive-looking AppleScript shows an Allow / Cancel card first.

### Routines
- Say "start a routine", do steps, then "save it as start my day".
- Or "when I say start my day, open Calendar and tell me the weather".
- Or after a request, "save that as start my day".
- Then just say the name. Manage them in the Routines tab.

### Tools the agent has
Apps (list, open, focus, quit), URLs and files, Finder (reveal, list, trash), Notes, Reminders, Calendar, Messages (iMessage), type text, key presses, menu bar clicks, accessibility-tree clicks (`ui_list`/`ui_click`), screenshots, pixel clicks and scrolling, a Relay cursor overlay that glides to the target before clicking, web search and page fetch, volume and dark mode, raw AppleScript, shell. Firefox tab tools appear when the extension is connected.

### Models
- **Claude** (default `claude-sonnet-5-5`): paste an API key in Model. It is stored with Keychain-backed encryption and is never sent to the UI.
- **Ollama**: local, free. Needs a model with tool support. A vision model (qwen2.5vl, llama3.2-vision) is needed for screenshots; without one Relay hides the screenshot tools.

### Firefox
Without the extension Relay can open URLs and use key presses and screenshots. With it, Relay can list and switch tabs, read page text, click and type inside pages. Turn it on in Permissions > Firefox and use **Show Me**: it opens `about:debugging` and the extension folder; choose "Load Temporary Add-on" and pick `manifest.json`. Firefox drops temporary add-ons on quit; Firefox Developer Edition can keep an unsigned one installed. The app only accepts connections from `moz-extension://` origins on 127.0.0.1.

### History > Actions
Every tool call with its arguments and result. If something does not work, look here first.

## What is verified and what is not

Verified in this repo (`npm test`, `npm run shots`, `xvfb-run -a node scripts/e2e.mjs`):
- 52 unit tests: command parsing, shortcut tap/hold logic, agent loop (confirm gate, abort, errors, step cap), both model providers' wire formats, AppleScript builders, settings store, Firefox bridge (origin check).
- 18 end-to-end steps in the real Electron app with a mock model and stub `osascript`/`open`: shortcut to pill to agent to tool to reply, confirm Allow/Cancel, Stop, routines, settings pages, shortcut capture, Firefox bridge, onboarding.
- The packaged `.app` bundle structure, Info.plist permission strings, bundled extension and native hotkey prebuilds.

Not verified, because they need a real Mac: the AppleScript and JXA actually doing their thing in Notes, Reminders, Calendar, Messages and Finder; global Right Option detection; permission prompts; screen capture; whether the pill receives Talkify's paste on your setup. Expect to fix small things there. The Actions tab and `Console.app` (filter "Relay") are where errors show up.

## Layout
```
src/main        Electron main process, agent, tools, Firefox bridge
src/renderer    Window, onboarding, pill and cursor overlay (plain HTML/CSS/JS)
extension/firefox   WebExtension (MV2)
test            unit tests         scripts   packaging, icons, screenshots, e2e
```

## Contributing

Issues and pull requests are welcome. Before opening a PR run:

```bash
npm test                          # unit tests
xvfb-run -a node scripts/e2e.mjs  # end-to-end run of the real app (Linux, mock model and stub osascript)
```

On a Mac the e2e script needs `xvfb-run` removed and the stubbed `osascript` and `open` binaries will shadow the real ones for that run only.

## License

[MIT](LICENSE)
