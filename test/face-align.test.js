const test = require('node:test');
const assert = require('node:assert/strict');
const { sealTemplates, openTemplates } = require('../src/main/ownerGuard');

const load = () => import('../src/renderer/facealign.js');
const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);
const apply = (t, [x, y]) => [t.a * x - t.b * y + t.tx, t.b * x + t.a * y + t.ty];

test('alignment finds the exact shift, turn and size that carry a face onto the standard one', async () => {
  const { similarity, TEMPLATE } = await load();
  // build a "photo" of the standard face: scaled 1.6x, turned 12 degrees, moved
  const ang = (12 * Math.PI) / 180, s = 1.6, c = Math.cos(ang) * s, d = Math.sin(ang) * s;
  const photo = TEMPLATE.map(([x, y]) => [c * x - d * y + 200, d * x + c * y + 90]);
  const t = similarity(photo, TEMPLATE);
  photo.forEach((p, i) => { const q = apply(t, p); near(q[0], TEMPLATE[i][0], 1e-6); near(q[1], TEMPLATE[i][1], 1e-6); });
  near(Math.hypot(t.a, t.b), 1 / 1.6);
  assert.equal(similarity([[1, 1], [1, 1]], TEMPLATE.slice(0, 2)), null, 'all points in one place cannot be fitted');
});

test('keypoints from the face finder become a transform, unless the face is too small or the points are unusable', async () => {
  const { alignFromKeypoints, TEMPLATE } = await load();
  const W = 320, H = 240, k = (x, y) => ({ x: x / W, y: y / H });
  const face = [k(130, 100), k(190, 100), k(160, 135), k(160, 168), k(110, 120), k(210, 120)];
  const t = alignFromKeypoints(face, W, H);
  assert.ok(t); near(apply(t, [130, 100])[0], TEMPLATE[0][0], 2); near(apply(t, [160, 168])[1], TEMPLATE[3][1], 4);
  const tiny = [k(150, 100), k(158, 100), k(154, 106), k(154, 112)];
  assert.equal(alignFromKeypoints(tiny, W, H), null, 'eyes 8 pixels apart: too small to tell anyone apart');
  assert.equal(alignFromKeypoints([k(1, 1)], W, H), null); assert.equal(alignFromKeypoints(null, W, H), null);
  assert.equal(alignFromKeypoints([{ x: NaN, y: 0 }, k(1, 1), k(2, 2), k(3, 3)], W, H), null);
});

test('pixels become planar red, green, blue values in the order the model reads', async () => {
  const { toPlanar } = await load();
  const rgba = new Uint8ClampedArray([10, 20, 30, 255, 40, 50, 60, 255, 70, 80, 90, 255, 100, 110, 120, 255]);
  assert.deepEqual(Array.from(toPlanar(rgba, 2)), [10, 40, 70, 100, 20, 50, 80, 110, 30, 60, 90, 120]);
});

test('the page compares faces the same way the main process does', async () => {
  const { cosine, bestScore } = await load();
  near(cosine([1, 0], [3, 0]), 1); near(cosine([1, 0], [0, 2]), 0); assert.equal(cosine([1], [1, 2]), null);
  near(bestScore([1, 0], [[0, 1], [1, 1]]), Math.SQRT1_2); assert.equal(bestScore([1, 0], []), null);
});

test('your face data is only ever stored through the encryption it is handed, and anything damaged reads as "not enrolled"', () => {
  const e = (i) => Array.from({ length: 128 }, (_, k) => (k === i ? 1 : 0));
  const enc = (t) => `sealed:${Buffer.from(t).toString('base64')}`, dec = (s) => Buffer.from(s.replace(/^sealed:/, ''), 'base64').toString();
  const rec = sealTemplates([e(0), e(1)], enc, 1793660000000);
  assert.deepEqual([rec.v, rec.count, rec.at], [1, 2, 1793660000000]);
  assert.equal(JSON.stringify(rec).includes('"templates"'), false, 'the saved record holds only the sealed text');
  assert.deepEqual(openTemplates(rec, dec), [e(0), e(1)]);
  assert.deepEqual(openTemplates({ ...rec, enc: 'sealed:garbage' }, dec), []);
  assert.deepEqual(openTemplates({ ...rec, v: 2 }, dec), []); assert.deepEqual(openTemplates(null, dec), []);
  assert.deepEqual(openTemplates(rec, () => { throw Error('keychain locked'); }), []);
  assert.deepEqual(openTemplates(sealTemplates([e(0), [1, 2, 3], Array(128).fill(NaN)], enc), dec), [e(0)], 'wrong-sized or non-numeric templates are dropped');
});
