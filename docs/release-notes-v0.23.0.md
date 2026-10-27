Better photo-to-3D: the clearest photo is chosen, sharper textures, and the stronger TRELLIS generators with a free Hugging Face token.

## What changed
- **Picks the best photo** of up to eight (clear whole object, plain background, good size; not a gauge, interior or diagram). A real example: "Toyota Corolla" used to build a fuel gauge, now builds the car.
- **Sharper textures** (2048).
- **TRELLIS.2 / TRELLIS** with an optional free Hugging Face token (Settings > General); falls back to Stable Fast 3D.
- **Compare:** the arrows step through generators and photos, and each is labeled.

Tested with real photos and the real Stable Fast 3D service, and against a pretend Space for TRELLIS. Not tested by me: a real TRELLIS model (the free anonymous GPU quota was used up).

## Requirements
**macOS 26 or later.** Apple Silicon (`arm64`) and Intel (`x64`) builds are attached below.

Full list of changes: [CHANGELOG.md](https://github.com/serjdmitri/Relay/blob/main/CHANGELOG.md)
