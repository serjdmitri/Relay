The reactor stays put while Relay works, several asks queue as a list, you can interrupt it, drop files on it, and dictation learns your words.

## What changed
- **Stays in the middle:** no more flying to the corner. Relay works in the background, shows the answer, and the reactor goes when the task is done.
- **Several asks:** tap the ask key while it works and say the next one. They run one at a time and are listed as bullets on the middle left of the screen. Esc stops the work and clears the waiting ones.
- **Interrupt mid-sentence:** Esc, ⌥T or talking again cuts a spoken reply off; Stop Speaking is in the menu bar menu.
- **Learns your words:** words you fix by hand after dictating, twice, become word fixes. Password fields are never read. Off switch in General.
- **Drop files:** drag files or a folder onto the menu bar icon (or the window); Relay can read text, PDFs, Word files and pictures you dropped, nothing else.

Not tested by me: dropping onto the menu bar icon with the real Finder, the learning with real dictation, and the queue with real tasks in the live app (the queue logic has unit tests).

## Requirements
**macOS 26 or later.** Apple Silicon (`arm64`) and Intel (`x64`) builds are attached below.

Full list of changes: [CHANGELOG.md](https://github.com/serjdmitri/Relay/blob/main/CHANGELOG.md)
