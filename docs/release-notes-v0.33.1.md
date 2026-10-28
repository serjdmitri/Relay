Phone hold-to-talk fixes.

## What changed
- Speech errors on the phone now say what went wrong (network, microphone, language) instead of only "Did not catch that".
- A quick release no longer cuts the microphone off: it always listens at least 0.7 seconds.
- After Jarvis has spoken, recognition waits 0.3 seconds (iOS Safari can leave the audio in playback mode, so the mic hears nothing).

The phone page comes from the Mac app, so update the Mac to get the fix on the phone. The real cause of the problem is not confirmed; checked with a fake speech engine only.

## Requirements
**macOS 26 or later.** Apple Silicon (`arm64`) and Intel (`x64`) builds are attached below.

Full list of changes: [CHANGELOG.md](https://github.com/serjdmitri/Relay/blob/main/CHANGELOG.md)
