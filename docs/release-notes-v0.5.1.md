Circling something now works by just moving the pointer.

## What changed
- **Mark the screen without clicking:** hold the mark key (Left ⌃ by default) and move the pointer round what you mean. A cyan trail follows it and fades; let go and ask. In 0.5.0 you had to drag with the mouse, which does not work with Control held because macOS turns Control-click into a right click. Now nothing is clicked and the mouse is never blocked.
- A pointer that only passes by (under about 28 points across) is ignored.

## Requirements
**macOS 26 or later.** Apple Silicon (`arm64`) and Intel (`x64`) builds are attached below.

## Install
Download the `.dmg` for your Mac and drag Relay to Applications. It is not notarized, so the first time, right-click Relay and choose Open, or run `xattr -dr com.apple.quarantine /Applications/Relay.app`. You will approve Microphone, Accessibility, Screen Recording and Input Monitoring once.

## Testing status
170 unit tests pass. In a real Electron window the real pointer was moved in a circle and the marked rectangle matched the circle; a pointer that only rested was ignored. Not yet tried: holding the physical key on your keyboard, a live model reading the marked picture, two displays. If something fails, open an issue with what History > Actions shows.

Full list of changes: [CHANGELOG.md](https://github.com/serjdmitri/Relay/blob/main/CHANGELOG.md)
