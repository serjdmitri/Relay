Everything since 0.37.2:

- **Touch ID stops the "not your computer" screen:** a fingerprint button sits in the bottom right of the access-denied and away screens (on Macs with Touch ID). Touch the sensor and, if it is you, the alarm stops and stays quiet for five minutes.
- **Owner recognition is less trigger-happy:** a "not sure" match no longer counts as a stranger, a stranger must be seen for five frames, small or distant faces are not judged, and the blink check is more forgiving.
- **It knows when you are looking down:** a face looking down at the keyboard or turned aside is not judged, and the away screen waits three times as long if your face disappears right after you looked down.
- "Owner recognition status" is understood even when misheard.

The full test suite passes (1203 tests). None of it has been tried with a real face or fingerprint yet. Say "turn off owner recognition" if it misbehaves.

## Requirements
**macOS 26 or later.** Apple Silicon (`arm64`) build attached below. There is no Intel (`x64`) build: the native helpers must be built on an Intel Mac. The app is ad-hoc signed, so the first time you open a downloaded copy, right-click it and choose Open.

Full list of changes: [CHANGELOG.md](https://github.com/serjdmitri/Relay/blob/main/CHANGELOG.md)
