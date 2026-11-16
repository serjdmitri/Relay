const test = require('node:test');
const assert = require('node:assert/strict');
const { inpaint, maskBounds, grow } = require('../src/renderer/inpaint');

function image(w, h, f) { const d = new Uint8ClampedArray(w * h * 4); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const [r, g, b] = f(x, y); d.set([r, g, b, 255], (y * w + x) * 4); } return d; }
const square = (w, h, x0, y0, s) => { const m = new Uint8Array(w * h); for (let y = y0; y < y0 + s; y++) for (let x = x0; x < x0 + s; x++) m[y * w + x] = 1; return m; };

test('a red square on a smooth gradient is painted out: the hole ends near what is around it and nothing else changes', () => {
  const W = 80, H = 60, grad = (x, y) => [40 + x, 90 + y, 150];
  const clean = image(W, H, grad), withObject = image(W, H, (x, y) => (x >= 30 && x < 44 && y >= 20 && y < 34 ? [220, 20, 20] : grad(x, y)));
  const mask = grow(square(W, H, 30, 20, 14), W, H, 2);
  const r = inpaint({ data: withObject, width: W, height: H, mask });
  let err = 0, n = 0, red = 0;
  for (let i = 0; i < W * H; i++) {
    if (!mask[i]) { assert.equal(r.data[i * 4], withObject[i * 4]); assert.equal(r.data[i * 4 + 1], withObject[i * 4 + 1]); assert.equal(r.data[i * 4 + 2], withObject[i * 4 + 2]); continue; }
    for (let c = 0; c < 3; c++) { err += Math.abs(r.data[i * 4 + c] - clean[i * 4 + c]); n++; }
    if (r.data[i * 4] > 200 && r.data[i * 4 + 1] < 60) red++;
  }
  assert.equal(red, 0, 'no red is left'); assert.ok(err / n < 6, `average error ${err / n} (of 255) against the real background`);
  assert.equal(r.changed, mask.reduce((a, b) => a + b, 0)); assert.equal(withObject[(25 * W + 35) * 4], 220, 'the input is not modified');
});

test('an object over stripes leaves stripes-coloured, not object-coloured, pixels; nothing painted means nothing changes', () => {
  const W = 64, H = 64, stripes = (x) => (x % 16 < 8 ? [200, 200, 200] : [60, 60, 60]);
  const data = image(W, H, (x, y) => (x >= 28 && x < 36 && y >= 28 && y < 36 ? [255, 0, 255] : stripes(x)));
  const r = inpaint({ data, width: W, height: H, mask: grow(square(W, H, 28, 28, 8), W, H, 1) });
  for (let y = 28; y < 36; y++) for (let x = 28; x < 36; x++) { const i = (y * W + x) * 4; assert.ok(Math.abs(r.data[i] - r.data[i + 2]) < 10 && r.data[i + 1] > 40, 'grey, not magenta'); }
  const none = inpaint({ data, width: W, height: H, mask: new Uint8Array(W * H) });
  assert.equal(none.changed, 0); assert.equal(none.box, null); assert.deepEqual([...none.data], [...data]);
});

test('a hole at the edge, a hole that is the whole picture, and the box that is worked on', () => {
  const W = 40, H = 30, data = image(W, H, () => [10, 120, 200]);
  const edge = inpaint({ data, width: W, height: H, mask: square(W, H, 0, 0, 10) });
  assert.deepEqual([...edge.data.slice(0, 4)], [10, 120, 200, 255]);
  const all = inpaint({ data, width: W, height: H, mask: new Uint8Array(W * H).fill(1) });
  assert.equal(all.changed, W * H, 'it finishes (nothing to learn from, so it stays as it was)');
  assert.deepEqual(maskBounds(square(W, H, 5, 6, 3), W, H), { x: 5, y: 6, w: 3, h: 3 });
  const big = 1200, d = image(big, big, (x, y) => [x % 256, y % 256, 90]), t0 = Date.now();
  inpaint({ data: d, width: big, height: big, mask: grow(square(big, big, 500, 500, 60), big, big, 2) });
  assert.ok(Date.now() - t0 < 5000, 'a small hole in a big picture is quick');
});
