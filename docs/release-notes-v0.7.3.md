The volume always comes back after Relay listens.

## What changed
- **Fix:** the volume Relay lowers while it listens is now always put back: it is saved to disk before it is lowered, restored whenever listening stops by any route, restored again at launch and at quit if it was left low, and left alone if you changed it yourself meanwhile.
- The switch is now General > Lower the volume while I talk, with a description. Off: your volume is never touched.

## Requirements
**macOS 26 or later.** Apple Silicon (`arm64`) and Intel (`x64`) builds are attached below.

Full list of changes: [CHANGELOG.md](https://github.com/serjdmitri/Relay/blob/main/CHANGELOG.md)
