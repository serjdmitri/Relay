Everything since 0.37.3. This is the first release that combines Claude's owner-recognition work with Codex's feature batch, and it moves Relay from Electron 33 to **Electron 45.2.1**.

**Owner recognition (Claude)**
- **Touch ID button fix:** the fingerprint button on the access-denied screen now asks macOS to confirm it is you (Touch ID first, then macOS's own prompt if the sheet cannot be shown), shows the real error, and accepts the first click.

**From Codex**
- **Fitbit:** local step goals and progress ring, with cloud-synced calorie totals and heart-rate ranges.
- **Trusted people:** named, encrypted local face profiles with macOS owner-authenticated enrollment and removal; webcam recognition only, never a macOS unlock. They count as "you" to the owner guard.
- **Security audit:** local IPC and navigation restrictions, a protected owner policy, request bounds for Relay Remote, and updated Electron and build tools (15 moderate build-tool advisories remain).
- **Overnight:** assigned tasks, then planned checks, then isolated improvement drafts using a local Ollama model; generated changes need a diff review before any tests run them.
- **Maps:** movable, isolated Argos and local God's Eye map windows (God's Eye needs its local server running).
- **iPhone route preview:** a separate native MapKit app with driving and walking routes, ETA, directions and on-device voice (needs your Apple signing to install).
- **Also in this line:** the Memory typing field fix, adjustable background blur and uploaded backgrounds, work modes that change apps, workflows and notifications, scheduled owner check-in calls, better wake-command and clap handling, and six stable hand cursors with external window drags.

The full test suite passes (1237 tests). Not yet tried by hand: Electron 45 with Touch ID, the blurred alarm screen, face recognition and hand control; real Fitbit, Ollama, God's Eye and iPhone setups; real face enrollment. If something breaks, tell Claude which feature and the previous 0.37.3 app can be restored.

## Requirements
**macOS 26 or later.** Apple Silicon (`arm64`) build attached below. There is no Intel (`x64`) build: the native helpers must be built on an Intel Mac. The app is ad-hoc signed, so the first time you open a downloaded copy, right-click it and choose Open.

Full list of changes: [CHANGELOG.md](https://github.com/serjdmitri/Relay/blob/main/CHANGELOG.md)
