const test = require('node:test');
const assert = require('node:assert/strict');
const load = () => import('../src/renderer/liveness.js');

const face = (x, y, l, r) => ({ x, y, blinkL: l, blinkR: r });
const OPEN = (x = 0.5, y = 0.5) => face(x, y, 0.05, 0.05), SHUT = (x = 0.5, y = 0.5) => face(x, y, 0.9, 0.9);

test('a face that blinks is alive for a while afterwards, and a face that never blinks stops being alive after the grace period', async () => {
  const { LivenessTracker, GRACE_MS, LIVE_FOR_MS } = await load();
  const t = new LivenessTracker();
  t.update([OPEN()], 0);
  assert.equal(t.isLive(0.5, 0.5, 100), true, 'just appeared: given a moment, so sitting down is not flagged');
  t.update([OPEN()], GRACE_MS - 500); assert.equal(t.isLive(0.5, 0.5, GRACE_MS - 400), true);
  t.update([OPEN()], GRACE_MS + 500); assert.equal(t.isLive(0.5, 0.5, GRACE_MS + 600), false, 'six seconds and no blink: a picture');
  t.update([SHUT()], GRACE_MS + 700);
  assert.equal(t.isLive(0.5, 0.5, GRACE_MS + 800), true, 'a blink makes it alive');
  assert.equal(t.isLive(0.5, 0.5, GRACE_MS + 700 + LIVE_FOR_MS + 1), false, 'and it has to keep blinking, as people do');
});

test('only an open eye closing counts: shut eyes held, one eye shut (a wink or a squint) and noise do not', async () => {
  const { LivenessTracker, GRACE_MS } = await load();
  const t = new LivenessTracker(), late = GRACE_MS * 3;
  t.update([SHUT()], 0); // first seen with eyes shut (a photo of a blink): no open-then-shut yet
  t.update([SHUT()], 1000);
  t.update([SHUT()], late - 1000);
  t.update([face(0.5, 0.5, 0.9, 0.05)], late); // one eye
  t.update([face(0.5, 0.5, 0.4, 0.4)], late + 100); // half-way: neither
  assert.equal(t.isLive(0.5, 0.5, late + 200), false);
  t.update([OPEN()], late + 300); t.update([SHUT()], late + 400);
  assert.equal(t.isLive(0.5, 0.5, late + 500), true);
  t.update([{ x: 0.5, y: 0.5, blinkL: NaN, blinkR: undefined }], late + 600); // missing scores change nothing
  assert.equal(t.isLive(0.5, 0.5, late + 700), true);
});

test('two faces are told apart by where they are, and a picture beside a living face stays a picture', async () => {
  const { LivenessTracker, GRACE_MS } = await load();
  const t = new LivenessTracker(), start = 1000;
  t.update([OPEN(0.3, 0.5), OPEN(0.75, 0.5)], start);
  for (let s = 1; s <= 12; s++) {
    t.update([s % 4 === 0 ? SHUT(0.3, 0.5) : OPEN(0.3, 0.5), OPEN(0.75, 0.5)], start + s * 1000); // the one on the left blinks; the one on the right never does
    t.update([OPEN(0.3, 0.5), OPEN(0.75, 0.5)], start + s * 1000 + 200);
  }
  const now = start + 12.3 * 1000;
  assert.equal(t.isLive(0.3, 0.5, now), true); assert.equal(t.isLive(0.75, 0.5, now), false);
  assert.equal(t.isLive(0.05, 0.05, now), null, 'no face there');
  assert.ok(now - start > GRACE_MS);
});

test('a face that moves a little keeps its history, and one that leaves is forgotten', async () => {
  const { LivenessTracker } = await load();
  const t = new LivenessTracker();
  t.update([OPEN(0.5, 0.5)], 0); t.update([SHUT(0.52, 0.51)], 100);
  assert.equal(t.isLive(0.53, 0.52, 200), true);
  t.update([], 10000);
  assert.equal(t.isLive(0.53, 0.52, 10100), null);
});
