Everything since 0.37.0:

- **The access-denied reactor is alive:** drawn like the regular Jarvis reactor and breathing in and out while it turns, faster as the lock gets closer, throbbing with each siren beat.
- **Away screen:** with owner recognition on, after 45 seconds with nobody in front of the camera the screens blur into a calm blue reactor and Jarvis says "The owner will be back soon" until you are seen again. A stranger turns it into the red alarm. Commands: "turn off the away screen", "test the away screen".
- **Liveness check:** a photo of you no longer passes as you; a face that matches yours but has not blinked for 15 seconds is treated as a picture. A video of you blinking can still fool it. Commands: "turn off the liveness check".

The full test suite passes (1194 tests). None of the three has been tried on a real camera yet. If something looks off, "turn off the away screen" and "turn off the liveness check" switch them off.

## Requirements
**macOS 26 or later.** Apple Silicon (`arm64`) build attached below. There is no Intel (`x64`) build: the native helpers must be built on an Intel Mac. The app is ad-hoc signed, so the first time you open a downloaded copy, right-click it and choose Open.

Full list of changes: [CHANGELOG.md](https://github.com/serjdmitri/Relay/blob/main/CHANGELOG.md)
