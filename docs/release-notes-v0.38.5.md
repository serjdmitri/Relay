Everything since 0.38.2 (0.38.3 and 0.38.4 were never published on their own):

- **Relay's window can no longer stay blank:** if the main window's page crashes, fails to load, stops responding or comes up empty, Relay loads it again by itself.
- **Honest failures:** when a model fails, Relay says which brain and why in plain words (not installed, sign-in expired, usage limit and when it resets, no internet, Ollama not running, too slow, empty reply), and a failing voice is announced, with the answer still given in text or the system voice.
- **Relay health in Doctor:** shows how long startup took (or that it never finished), the Keychain, the last failed request, the voice, owner recognition (enrolled, camera, armed, match score), Ollama and the `gh` tool. Say "relay health".
- **Every build is now checked before release:** the release script launches the built app and refuses to make the installer unless it really starts. `npm run install-local` installs a build signed the same way every time, so macOS keeps Keychain access and your permissions.
- **God's Eye integrated (from Codex, 0.38.4):** God's Eye runs locally through a registered Node runtime, starts its loopback-only server when you open the workspace, fills the work area from a whole-globe view in Jarvis blue, and keeps the Jarvis reactor in the bottom right corner. A failed startup shows a recovery screen instead of a white rectangle. No paid feeds are configured.

The full test suite passes (1308 tests). The startup check passes on this build.

## Requirements
**macOS 26 or later.** Apple Silicon (`arm64`) build attached below. There is no Intel (`x64`) build: the native helpers must be built on an Intel Mac. The app is ad-hoc signed, so the first time you open a downloaded copy, right-click it and choose Open.

Full list of changes: [CHANGELOG.md](https://github.com/serjdmitri/Relay/blob/main/CHANGELOG.md)
