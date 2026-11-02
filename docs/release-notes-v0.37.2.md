Everything since 0.37.1:

- **Owner recognition rebuilt the way Glance does it, and it can no longer lock you out.** Faces are aligned on five landmarks (pupils, nose tip, mouth corners) onto the standard ArcFace template, as Glance's own aligner does, and the camera runs at 640x480. It only arms once it has recognised you (alive) for three frames in a row, so it can never sound the alarm or lock before it knows you. "Owner recognition status" says whether it is armed and shows your match score. **Say "enroll my face" again after updating**: faces saved by 0.37.0/0.37.1 are ignored.
- **The access-denied and away screens now cover the menu bar and the notch area.**

The full test suite passes (1197 tests). Recognition has not been tried with a real face since the rebuild. Say "turn off owner recognition" if it misbehaves.

## Requirements
**macOS 26 or later.** Apple Silicon (`arm64`) build attached below. There is no Intel (`x64`) build: the native helpers must be built on an Intel Mac. The app is ad-hoc signed, so the first time you open a downloaded copy, right-click it and choose Open.

Full list of changes: [CHANGELOG.md](https://github.com/serjdmitri/Relay/blob/main/CHANGELOG.md)
