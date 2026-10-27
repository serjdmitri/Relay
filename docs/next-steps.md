# Where things stand (for whoever picks this up next)

Released: 0.28.0 (tag v0.28.0, both DMGs attached; marked pre-release on GitHub). Everything below is on branch `claude/zealous-allen-5y9opn` (PR 1), not yet released. See CHANGELOG.md "Unreleased" for each item.

## Built, tested with fakes and in a headless browser, NOT yet tried on a real Mac / phone
Voice: keep listening after an answer, interrupt by talking (best with headphones), Jarvis voice (Daniel / Kokoro George), soft confirmations, wake phrase only in chosen apps.
Mac: nightly Downloads tidy (propose only), window layouts, focus mode (needs the "Relay Focus On/Off" Shortcuts for Do Not Disturb), copy text from screen (Apple Vision via osascript), quick maths and unit conversions, zip/convert with undo, Print check, activity log Undo.
Holograms: library with thumbnails, scenes, notes pinned to a model, real size (credit-card calibration in Settings), stickies, draw shapes in the air (one hand a fist, the other pinching), presence (pause music when you leave; camera, opt-in).
Phone: quick action chips, `/?say=`, messages when a long job finishes (ntfy or iMessage), lock screen push to talk via the Shortcut (docs/phone.md).

Things most likely to need a fix once run for real: the `windowList()` AppleScript and `ocrFile()` JXA in `src/main/agent/mac.js`; barge-in false triggers without headphones (`src/main/conversation.js`, `interruption()`); whether a real fist reports a pinch ratio below 0.28 (the pen test in `src/main/hands/logic.js` uses the gesture name, not the ratio); sticky windows taking the keyboard (`src/main/stickyPanel.js`); the on-screen size after calibration (`realSize()` in `src/renderer/holo.js`).

## Still to do
1. Photo-made models that pull apart into real parts: splitter is connected (`splitMesh()` in `src/renderer/holo.js`) but not tuned on the real car models (`car-trellis2.glb`, `corolla-best-2048.glb`, on the user's Mac). Tune `convexDeg`, `concaveDeg`, `colorStep`, `minShare`; check the texture V flip. Then release 0.29.0.
2. Saved for later (user said so): animation of assemblies / record an exploded view as video, compare two models side by side with cuts, "ask before anything outside my home folder" switch, guided first run that tests each permission.
3. Not built: meeting helper (the user has their own notch app for it), direct Google Drive/Docs/Sheets connector, clipboard history, read any app's screen, teach-your-own hand gestures and a practice mode, iPhone control through iPhone Mirroring, morning briefing.
4. The user mentioned a GitHub repo for a Jarvis-like voice ("openhiggfirld", not found by that name). Relay uses Kokoro's British voice for now (`bm_george`, `src/main/voiceProfile.js`); another engine would plug in beside `src/main/tts/`.
