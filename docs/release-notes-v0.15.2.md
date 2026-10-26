The left menu opens faster, and a tab sticks out of the edge so you can see it is there.

## What changed
- **Faster:** the menu opens after about 0.14 seconds on the edge, and the animations are roughly twice as quick.
- **A small black tab** sticks out of the left edge of each screen. Rest the pointer on it (or anywhere on the edge) to open the menu. It never blocks a click, and slips away while the menu is open.

Checked in real Electron: the tab appears, goes away when the menu opens, and the menu shows. Not tested by me: how it feels with your real pointer, and on a second display.

## Requirements
**macOS 26 or later.** Apple Silicon (`arm64`) and Intel (`x64`) builds are attached below.

Full list of changes: [CHANGELOG.md](https://github.com/serjdmitri/Relay/blob/main/CHANGELOG.md)
