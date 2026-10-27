const test = require('node:test');
const assert = require('node:assert/strict');
const { scorePhoto, titleScore, rankPhotos, measurePixels } = require('../src/main/models/photoscore');

// made-up pictures, 48 x 48: draw(x, y) -> [r, g, b]
function pic(draw, w = 48, h = 48) {
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const c = draw(x, y); data.set([c[0], c[1], c[2], 255], (y * w + x) * 4); }
  return { data, w, h };
}
const white = [240, 240, 240], blue = [30, 80, 200];
const studio = pic((x, y) => (x > 9 && x < 38 && y > 7 && y < 40 ? blue : white)); // a whole object, centred, on a plain background
const cutOff = pic((x, y) => (x > 20 && y > 12 ? blue : white)); // runs off the edge of the picture
const tiny = pic((x, y) => (x > 22 && x < 26 && y > 22 && y < 26 ? blue : white)); // a speck in the middle
let seed = 7;
const noise = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const busy = pic(() => [Math.floor(noise() * 255), Math.floor(noise() * 255), Math.floor(noise() * 255)]); // a busy scene

test('a whole object on a plain background beats one cut off by the edge, a speck, and a busy scene', () => {
  const s = (p) => scorePhoto(p, [1200, 800], 'Robot').score;
  assert.ok(s(studio) > 0.78, `studio ${s(studio)}`);
  assert.ok(s(studio) > s(cutOff) + 0.1, 'cut off');
  assert.ok(s(studio) > s(tiny) + 0.1, 'tiny');
  assert.ok(s(studio) > s(busy) + 0.25, `busy ${s(busy)}`);
  const m = measurePixels(studio);
  assert.ok(m.uniform > 0.95 && m.touch < 0.05 && m.offCenter < 0.05);
});

test('a small low-resolution photo scores lower than a big one of the same picture', () => {
  assert.ok(scorePhoto(studio, [1600, 1000], 'x').score > scorePhoto(studio, [320, 200], 'x').score + 0.05);
});

test('titles: a part, an interior, a diagram or a crowd count against a photo; a side or front view for it', () => {
  assert.ok(titleScore('Fuel gauge (Toyota Corolla)') < 0.3);
  assert.ok(titleScore('Toyota Corolla dashboard interior') < 0.3);
  assert.ok(titleScore('Engine diagram') < 0.3);
  assert.ok(titleScore('Crowd at the robot competition') < 0.45);
  assert.ok(titleScore('Toyota Corolla front view') > 0.6);
  assert.equal(titleScore('Spot by Boston Dynamics'), 0.5);
});

test('ranking puts the best first, keeps the order for ties, and a photo that cannot be read is not thrown away', async () => {
  const cands = [{ url: 'a', title: 'Fuel gauge' }, { url: 'b', title: 'Car side view' }, { url: 'c', title: 'Car' }, { url: 'd', title: 'Car' }];
  const decode = async (c) => ({ a: { pixels: studio, size: [1000, 700] }, b: { pixels: studio, size: [1000, 700] }, c: null, d: { pixels: busy, size: [1000, 700] } }[c.url] ?? null);
  const r = await rankPhotos(cands, decode);
  assert.deepEqual(r.map((x) => x.url), ['b', 'c', 'a', 'd'], 'a good photo with a good title first; an unreadable one beats a clean picture of a gauge; a busy scene is last');
  assert.ok(r[0].score > r[1].score);
  const ties = await rankPhotos([{ url: 'x', title: 't' }, { url: 'y', title: 't' }], async () => null);
  assert.deepEqual(ties.map((x) => x.url), ['x', 'y']);
  const bad = await rankPhotos([{ url: 'z', title: 't' }], async () => { throw new Error('boom'); });
  assert.equal(bad.length, 1);
});
