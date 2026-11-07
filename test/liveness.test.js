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
  t.update([face(0.5, 0.5, 0.3, 0.3)], late + 100); // half-way: neither
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

// a 4x4 pose matrix (column-major) for a head turned by pitch (about x) and yaw (about y), in degrees
const pose = (pitchDeg, yawDeg, flipZ = false) => {
  const p = (pitchDeg * Math.PI) / 180, y = (yawDeg * Math.PI) / 180;
  const Rx = [[1, 0, 0], [0, Math.cos(p), -Math.sin(p)], [0, Math.sin(p), Math.cos(p)]], Ry = [[Math.cos(y), 0, Math.sin(y)], [0, 1, 0], [-Math.sin(y), 0, Math.cos(y)]];
  const R = Ry.map((row) => [0, 1, 2].map((c) => row[0] * Rx[0][c] + row[1] * Rx[1][c] + row[2] * Rx[2][c]));
  if (flipZ) for (let i = 0; i < 3; i++) R[i][2] = -R[i][2]; // some pose matrices have the camera axis pointing the other way
  const m = new Array(16).fill(0); m[15] = 1;
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) m[c * 4 + r] = R[r][c];
  return m;
};

test('looking away: down at the keyboard or turned aside, in either direction, and not when facing the camera', async () => {
  const { lookingAway } = await load();
  assert.equal(lookingAway({ matrix: pose(0, 0) }), false);
  assert.equal(lookingAway({ matrix: pose(10, 15) }), false, 'a small tilt is still facing the camera');
  assert.equal(lookingAway({ matrix: pose(35, 0) }), true); assert.equal(lookingAway({ matrix: pose(-35, 0) }), true, 'up or down');
  assert.equal(lookingAway({ matrix: pose(0, 50) }), true); assert.equal(lookingAway({ matrix: pose(0, -50) }), true);
  assert.equal(lookingAway({ matrix: pose(0, 33) }), true, 'turned to look at something else');
  assert.equal(lookingAway({ matrix: pose(22, 0) }), true, 'looking down at a phone or the keyboard');
  assert.equal(lookingAway({ matrix: pose(15, 25) }), false, 'a normal angle at a screen is still judged');
  assert.equal(lookingAway({ matrix: pose(0, 0, true) }), false, 'the same answer when the matrix axes are flipped');
  assert.equal(lookingAway({ matrix: pose(35, 0, true) }), true);
  assert.equal(lookingAway({ gazeDownL: 0.7, gazeDownR: 0.6 }), true, 'eyes cast down while the head faces the camera');
  assert.equal(lookingAway({ gazeDownL: 0.1, gazeDownR: 0.2, matrix: pose(0, 0) }), false);
  assert.equal(lookingAway({}), false); assert.equal(lookingAway({ matrix: [1, 2, 3] }), false); assert.equal(lookingAway({ matrix: new Array(16).fill(NaN) }), false);
});
