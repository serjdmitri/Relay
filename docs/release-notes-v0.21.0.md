No edges: holograms anywhere on the screen, turned every way, pulled apart by double-click. Dictation starts instantly.

## What changed
- **No border, no background, no limit.** The glowing base is gone and holograms are drawn on a see-through layer as big as the display, so they and their pieces can go anywhere, even to another display.
- **Turn it all ways** (up, down, diagonal) to see underneath; a button turns it back to the front.
- **Double-click to pull it apart; drag any piece around; take one out; double-click to close the rest back up** without it. Drop a piece on another hologram and Claude places it.
- **Hover a control to see what it does.**
- **Dictation opens the microphone first,** the way Talkify does, so the first words are not lost. (Relay's engine was already Apple's on-device SpeechAnalyzer, warmed ahead of time; a file transcribes in about 0.25 s.)
- **Photo matching is strict,** so "Spot robot" can no longer bring back a zebra.

Tested in real Electron windows (injected mouse events, real screen captures, click-through checked). Not tested by me: a hand on a real mouse, and the real-use gain in dictation.

## Requirements
**macOS 26 or later.** Apple Silicon (`arm64`) and Intel (`x64`) builds are attached below.

Full list of changes: [CHANGELOG.md](https://github.com/serjdmitri/Relay/blob/main/CHANGELOG.md)
