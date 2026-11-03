Fixes for 0.38.0 and 0.38.1:

- **Fixed: Relay opened a blank window.** A line added in 0.38.0 used `fs` without importing it, so startup stopped partway. A new test now catches this kind of mistake in every main-process file.
- **Fixed: the Jarvis reactor and the "Welcome back" card stayed on screen.** The card now closes by itself after 30 seconds (pin it to keep it), and the reactor can no longer stay longer than 60 seconds.

If Relay shows a blank window after updating, quit it and open it again; this release is the fix.

## Requirements
**macOS 26 or later.** Apple Silicon (`arm64`) build attached below. There is no Intel (`x64`) build: the native helpers must be built on an Intel Mac. The app is ad-hoc signed, so the first time you open a downloaded copy, right-click it and choose Open.

Full list of changes: [CHANGELOG.md](https://github.com/serjdmitri/Relay/blob/main/CHANGELOG.md)
