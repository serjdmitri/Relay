Lock my Mac without a permission prompt, and a tidier phone page.

## What changed
- **Lock my Mac** uses macOS's own lock call, so it no longer needs Accessibility or Automation permission (it falls back to the old keyboard shortcut on a macOS that lacks the call).
- **Phone page, upright:** a music button at the bottom left hides and shows the row of shortcut buttons (remembered); a bigger reactor; a smaller padlock that is fully on screen.
- **Phone page, sideways:** the reactor is back in the exact middle, the question and answer are on the left, and the shortcut buttons wrap so none is cut off.

Tested with unit tests and size checks at three phone widths. Not tested on a real Mac or iPhone.

## Requirements
**macOS 26 or later.** Apple Silicon (`arm64`) and Intel (`x64`) builds are attached below.

Full list of changes: [CHANGELOG.md](https://github.com/serjdmitri/Relay/blob/main/CHANGELOG.md)
