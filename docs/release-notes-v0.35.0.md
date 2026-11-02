The features that were not built in 0.34.0.

## What changed
- **Speak up:** watch folders (new file in a folder you add) and events sent by plugins.
- **Phone:** Allow and Cancel buttons when the Mac asks a question; the first answer wins.
- **Hologram menu:** Record a video of the model pulling apart and going back together (MP4 in Downloads/Relay 3D).
- **Compare** two things in 3D side by side by voice.
- **First run** ends with a Doctor check. More Spanish labels.
- **Photo-made models:** cutting them into real parts by creases or colours does not work on real models, so that code was removed. They still pull apart into 5 chunks, and very detailed (TRELLIS.2) models can now be pulled apart at all.

Unit-tested and checked in headless browsers; the folder watcher, plugin events and phone buttons have not run on a real Mac or phone.

## Requirements
**macOS 26 or later.** Apple Silicon (`arm64`) and Intel (`x64`) builds are attached below.

Full list of changes: [CHANGELOG.md](https://github.com/serjdmitri/Relay/blob/main/CHANGELOG.md)
