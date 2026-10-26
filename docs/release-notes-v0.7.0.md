A big Jarvis reactor for voice, a cursor buddy that is just an arrow, and window snapping.

## What changed
- **A big reactor in the middle of the screen** when you ask by voice: no window behind it, bars that follow your voice, your words under it. When you stop it shrinks to the top left corner and keeps working there until the task is done, then shows the answer beside it, and swells while Relay speaks. Typing (⌥T) and Allow / Cancel questions still use the pill. General > Look > Classic brings the old pill back.
- **Cursor buddy is just an arrow** like HeyClicky's cursor. Put it away in General or from the menu bar icon.
- **Move and resize windows by voice:** "snap this window to the left", "put Chrome on the right half", "top right corner", "maximize", "center", thirds, "other screen". Instant, and "undo that" puts the window back.
- Flatter Settings and website: no glows, gradient tiles or emoji.
- **Typing and Allow / Cancel use the reactor too** (a type-in line and two buttons), and a 30% dark blue veil sits behind it so it is easy to see on any window.
- **Works with AirPods:** the built-in microphone is used through a capture session, so AirPods stay in high-quality mode instead of dropping to call quality (or failing).
- **Fix:** asking by voice failed with "avfaudio error -10868" when AirPods or another Bluetooth headset were connected. Relay now falls back to the default microphone instead of failing.

## Requirements
**macOS 26 or later.** Apple Silicon (`arm64`) and Intel (`x64`) builds are attached below.

## Install
Download the `.dmg` for your Mac and drag Relay to Applications. It is not notarized, so the first time, right-click Relay and choose Open, or run `xattr -dr com.apple.quarantine /Applications/Relay.app`. You will approve Microphone, Accessibility, Screen Recording and Input Monitoring once.

## Testing status
196 unit tests pass. Window moves were tested on a real Finder window; the reactor was rendered and checked in screenshots and driven in the installed app. Not yet tried: "Hey Jarvis" by voice, the on-device voice, online voices with a real key, and multiple displays. If something fails, open an issue with what History > Actions shows.

Full list of changes: [CHANGELOG.md](https://github.com/serjdmitri/Relay/blob/main/CHANGELOG.md)
