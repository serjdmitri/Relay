Guides that move on by themselves, drawings that always show, and a smaller buddy.

## What changed
- **Guides follow you:** Relay outlines the element for the current step. Click it, or say "next", and it moves to the next step and outlines that one. While a guide is up, "next", "back" and "stop" are for the guide ("next song" still skips a song).
- **Always something on screen:** guides outline the element or ring a spot, and `draw_on_screen` can outline an element by app and name, exactly and without a screenshot (so it works with text-only models too).
- **Buddy cursor:** smaller, closer to your pointer, and the spinner is centered.
- Fixes a bug in 0.3.0 where saying "next" during a guide skipped a Spotify song instead of going to the next step.

## Requirements
**macOS 26 or later.** Apple Silicon (`arm64`) and Intel (`x64`) builds are attached below.

## Install
Download the `.dmg` for your Mac and drag Relay to Applications. It is not notarized, so the first time, right-click Relay and choose Open, or run `xattr -dr com.apple.quarantine /Applications/Relay.app`. You will approve Microphone, Accessibility, Screen Recording and Input Monitoring once.

## Testing status
160 unit tests pass. The guide (click to advance, "next", retries) and the buddy were run for real in an Electron window on one display with a stand-in for the accessibility lookup. Not yet tried: real apps' accessibility names with a live model, two displays, full-screen apps, the downloadable `.dmg`. If something fails, open an issue with what History > Actions shows.

Full list of changes: [CHANGELOG.md](https://github.com/serjdmitri/Relay/blob/main/CHANGELOG.md)
