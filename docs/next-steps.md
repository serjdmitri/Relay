# Where things stand (for whoever picks this up next)

Released: 0.28.0 (tag v0.28.0). Its arm64 CI job failed once for lack of a runner and was re-run; check the Releases page.

## In progress: photo-made models that pull apart into real parts
- `src/renderer/holo-parts.js` has `splitSurface()`: cuts one solid skin along sharp creases and colour changes, merges small bits, returns <= maxParts pieces. One synthetic test passes (`test/holo-surface.test.mjs`).
- Wired in (steps 1 and 2 done): `splitMesh()` in `src/renderer/holo.js` now tries `splitSurface` when the old splitter gives `regions` or refuses a big model, and uses it when it returns >= 3 groups. `triangleColors()` samples the texture at each triangle's UV middle (falls back to vertex colours, then flat colour).
- STILL TO DO, needs the real models (they live on the user's Mac, not in the repo):
  1. Load `car-trellis2.glb` and `corolla-best-2048.glb`, pull them apart, look at the pieces, tune `convexDeg`, `concaveDeg`, `colorStep`, `minShare`. Check the texture V flip (`mat.map.flipY`) gives sensible colours.
  2. Update the hint text in `collectParts()` for `kind: 'surface'`.
  3. Release as 0.29.0.
- No free hosted part-aware generator (PartCrafter) is running; check again later.

## Ideas the user liked
Drop files on the reactor (done), Send to Relay share sheet (done), Measure (done). Next: direct Google Drive/Docs/Sheets connector, clipboard history, read any app's screen, undoable file actions (zip/convert/rename), teach-your-own hand gestures, hand practice mode, iPhone control through iPhone Mirroring.
