Relay now remembers things about you.

## What changed
- **Say "remember that…"** and Relay keeps the fact and uses it in every later request. "Forget that…", "what do you remember about me?" and "forget everything" (it asks first) work too.
- **Settings > Memory** lists everything, lets you add, delete, forget all, or turn memory off.
- Passwords, card numbers and ID numbers are refused. Memories stay on your Mac and travel only inside requests to the model you chose.
- Fix: dropped files and memories now reach every model provider, not only the Claude app runner.

Not tested by me: memory with a real model and real voice requests (the commands and storage have unit tests).

## Requirements
**macOS 26 or later.** Apple Silicon (`arm64`) and Intel (`x64`) builds are attached below.

Full list of changes: [CHANGELOG.md](https://github.com/serjdmitri/Relay/blob/main/CHANGELOG.md)
