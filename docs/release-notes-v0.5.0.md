Circle something on screen and ask about it, a calmer cyan look, and a fix for drawings sitting too low.

## What changed
- **Mark the screen:** hold the mark key (Left ⌃ by default), circle or scribble over anything with the mouse, let go, then ask. Relay looks at that area specifically. Models without image support get the text in the area instead. The mark lasts three minutes; Esc cancels. Change the key under Shortcuts.
- **A calmer look:** one cyan accent on dark navy in Settings, the logo and icon, the pill, the buddy and guides. No purple or green, no glow. The pill keeps its shape and its cyan accent follows the pill's outline.
- **Buddy with a cursor triangle:** a small ring with a triangle; when Relay draws, the triangle traces each stroke.
- **Fix:** drawings, rings and guides were shifted down by the height of the menu bar, because macOS kept the overlay window below it. They now land on the element.

## Requirements
**macOS 26 or later.** Apple Silicon (`arm64`) and Intel (`x64`) builds are attached below.

## Install
Download the `.dmg` for your Mac and drag Relay to Applications. It is not notarized, so the first time, right-click Relay and choose Open, or run `xattr -dr com.apple.quarantine /Applications/Relay.app`. You will approve Microphone, Accessibility, Screen Recording and Input Monitoring once.

## Testing status
170 unit tests pass. In a real Electron window: simulated mouse strokes were recorded as a mark and turned into a screen rectangle, and a drawn box was measured on a real screenshot to land within 1 point of where it was asked to go. Not yet tried by hand: holding the real key and circling in a real app, a live model reading the marked picture, two displays. If something fails, open an issue with what History > Actions shows.

Full list of changes: [CHANGELOG.md](https://github.com/serjdmitri/Relay/blob/main/CHANGELOG.md)
