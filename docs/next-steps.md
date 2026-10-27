# Where things stand (for whoever picks this up next)

Released: 0.28.0 (tag v0.28.0). Its arm64 CI job failed once for lack of a runner and was re-run; check the Releases page.

## In progress: photo-made models that pull apart into real parts
- `src/renderer/holo-parts.js` has `splitSurface()`: cuts one solid skin along sharp creases and colour changes, merges small bits, returns <= maxParts pieces. One synthetic test passes (`test/holo-surface.test.mjs`).
- NOT wired in yet. To finish:
  1. In `src/renderer/holo.js` `splitMesh()` (about line 225): if `splitTriangles` gives `kind: 'regions'` or `null`, try `splitSurface` on the (indexed) geometry; use it when it returns >= 3 groups. The old splitter refuses > 250,000 triangles, so TRELLIS.2 models (about 293,000) cannot be pulled apart today; `splitSurface` allows 900,000.
  2. Per-triangle colours: sample the texture at each triangle's UV centre into a Float32Array (r, g, b per triangle) and pass it as `colors`.
  3. Test on real photo models (`car-trellis2.glb`, `corolla-best-2048.glb` made earlier), look at the pieces, tune `convexDeg`, `concaveDeg`, `colorStep`, `minShare`.
  4. Release as 0.29.0.
- No free hosted part-aware generator (PartCrafter) is running; check again later.

## Ideas the user liked
Drop files on the reactor (done), Send to Relay share sheet (done), Measure (done). Next: direct Google Drive/Docs/Sheets connector, clipboard history, read any app's screen, undoable file actions (zip/convert/rename), teach-your-own hand gestures, hand practice mode, iPhone control through iPhone Mirroring.
