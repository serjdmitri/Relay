A Jarvis-style look, and guides that find things quickly and check what you do.

## What changed
- **Jarvis look (new default):** a cyan HUD. The buddy is a rotating ring reticle that pulses while it listens, spins faster while it thinks and closes into a check when done. The pill pops up with HUD brackets, a status readout and a scanning bar, guides are a HUD panel with a progress bar, and drawings and labels are cyan. General > Look > Classic brings back the indigo orb.
- **Guides find things in under a second.** Before, looking up an element took about 30 seconds or timed out in Notes, the Claude app and Xcode. A new native helper reads the accessibility tree directly, and when an app has no accessibility names Relay reads the text on screen and points at that.
- **Guides check what you do.** The highlight stays up until the step is done and follows the element if the window moves. Click the highlighted spot, or say "next", to go on. If you go another way, the highlighted element disappears, or the next one cannot be found, Relay looks at the screen and rewrites the remaining steps.

## Requirements
**macOS 26 or later.** Apple Silicon (`arm64`) and Intel (`x64`) builds are attached below.

## Install
Download the `.dmg` for your Mac and drag Relay to Applications. It is not notarized, so the first time, right-click Relay and choose Open, or run `xattr -dr com.apple.quarantine /Applications/Relay.app`. You will approve Microphone, Accessibility, Screen Recording and Input Monitoring once.

## Testing status
167 unit tests pass. The new helper was run against real Notes, Claude and Xcode windows (0.2 to 0.6 seconds to find an element, about half a second to read text off a screenshot). The guide, the buddy and the look were run in an Electron window and in rendered screenshots. Not yet tried: a full guide end to end in a real app with a live model, the progress check with a live model, two displays, and the downloadable `.dmg` (the helper needs the same Accessibility permission as Relay). If something fails, open an issue with what History > Actions shows.

Full list of changes: [CHANGELOG.md](https://github.com/serjdmitri/Relay/blob/main/CHANGELOG.md)
