Holograms in parts: explode, pick a piece, pull it out, combine with AI.

## What changed
- **Explode a hologram** with the four-diamond button, hover and click a piece, drag it out into its own hologram. The rest stays as a hologram too.
- **Combine smoothly.** Drop a hologram or a pulled-out piece on another: Relay asks Claude (small fast model, 12 second limit, built-in fallback) where it goes (on top, beside, in front, inside, scale, orientation), and the piece flies in and settles. "Put X inside Y" by voice uses the same placement.
- **Honest limits:** assemblies split into real bodies, a single solid model is cut into regions by position (chunks, not anatomy); models over 250,000 triangles are not split; pulled-out pieces are saved as plain models.

Tested in real Electron with a stand-in for the mouse pointer on a built model, a skull and a photo-made robot, plus unit tests. Not tested by me: a hand drag with a real mouse, and asking by voice.

## Requirements
**macOS 26 or later.** Apple Silicon (`arm64`) and Intel (`x64`) builds are attached below.

Full list of changes: [CHANGELOG.md](https://github.com/serjdmitri/Relay/blob/main/CHANGELOG.md)
