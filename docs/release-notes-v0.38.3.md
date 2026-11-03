Everything since 0.38.2:

- **Relay's window can no longer stay blank:** if the main window's page crashes, fails to load, stops responding or comes up empty (for example after a Chromium helper process died, or after the Mac woke up), Relay loads it again by itself.
- **Honest failures:** when a model fails, Relay says which brain and why in plain words (not installed, sign-in expired, usage limit and when it resets, no internet, Ollama not running, too slow, empty reply), and a failing voice is announced, with the answer still given in text or the system voice.

The full test suite passes (1299 tests).

## Requirements
**macOS 26 or later.** Apple Silicon (`arm64`) build attached below. There is no Intel (`x64`) build: the native helpers must be built on an Intel Mac. The app is ad-hoc signed, so the first time you open a downloaded copy, right-click it and choose Open.

Full list of changes: [CHANGELOG.md](https://github.com/serjdmitri/Relay/blob/main/CHANGELOG.md)
