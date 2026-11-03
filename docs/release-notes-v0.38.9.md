Owner recognition: faster, and it can no longer be left without its camera.

- **The camera could end up off while owner recognition still read "on".** Then nothing was watched and no alarm or away screen could work. Launching now starts the camera whenever recognition is on and your face is enrolled, tells you when it had to turn Presence back on, and retries a camera that fails to start for a passing reason (15, 30 and 45 seconds later) instead of switching it off for good. Only a refused Camera permission, or running out of tries, leaves it off, and then it says so. To stop the camera, turn owner recognition off.
- **Faster recognition when it is waiting for you.** The camera looks about 2.5 times a second (instead of once) only while Relay is waiting to see you: the first 30 seconds after turning recognition on, the away screen, and the access-denied countdown. Coming back from the away screen takes 0.8 seconds instead of about 2. It never changes how many frames it takes to raise the alarm or lock, so it is not more trigger-happy. The face model now loads when recognition turns on, not when the first face appears.
- **The startup check reports how long the window took to appear** (0.7 s after launch on a clean profile).
- Includes Codex's 0.38.6 to 0.38.8 work (floating God's Eye globe, faster map and voice startup).

The full test suite passes (1326 tests).

## Requirements
**macOS 26 or later.** Apple Silicon (`arm64`) build attached below. There is no Intel (`x64`) build: the native helpers must be built on an Intel Mac. The app is ad-hoc signed, so the first time you open a downloaded copy, right-click it and choose Open.

Full list of changes: [CHANGELOG.md](https://github.com/serjdmitri/Relay/blob/main/CHANGELOG.md)
