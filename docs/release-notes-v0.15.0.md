Answer cards with pictures.

## What changed
- **Ask "who is…", "what does … look like", "tell me about…" or "show me … places".** A black glass card pops out on the right with a picture, a short summary, key facts and link buttons, while Relay answers in one short sentence. Lists (hotels, places, products) show a small picture per option.
- **Pictures from Wikipedia and Wikimedia Commons,** with the photographer and license shown. Relay downloads them itself; the card never contacts the web. Things without a Wikipedia page get a card without a picture.
- **Esc, ×, or 30 seconds** closes it (it stays while you hover). Off switch in General.
- **Fix:** the Recent menu on the left edge could fail to appear the first time (a message sent before the page had loaded). Found by running the windows in real Electron.

Tested: the real Wikipedia and Commons APIs, and both windows in real Electron (screenshots of what they actually drew). Not tested by me: the card appearing from a real spoken question in the app.

## Requirements
**macOS 26 or later.** Apple Silicon (`arm64`) and Intel (`x64`) builds are attached below.

Full list of changes: [CHANGELOG.md](https://github.com/serjdmitri/Relay/blob/main/CHANGELOG.md)
