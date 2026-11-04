const test = require('node:test');
const assert = require('node:assert/strict');
const load = () => import('../src/renderer/enrollpose.js');

// A face with the given head turn, built the way the landmarker reports it (x, y across the picture, z = depth, smaller is nearer). yaw: toward your own left is positive.
function face(yaw = 0, pitch = 0) {
  const lm = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
  const dx = 0.3, dy = 0.4, t = (d) => Math.tan((d * Math.PI) / 180);
  Object.assign(lm[234], { x: 0.35, y: 0.5, z: -(dx * t(yaw)) / 2 }); Object.assign(lm[454], { x: 0.65, y: 0.5, z: (dx * t(yaw)) / 2 });
  Object.assign(lm[10], { x: 0.5, y: 0.3, z: (dy * t(pitch)) / 2 }); Object.assign(lm[152], { x: 0.5, y: 0.7, z: -(dy * t(pitch)) / 2 });
  Object.assign(lm[33], { x: 0.4, y: 0.45, z: 0 }); Object.assign(lm[263], { x: 0.6, y: 0.45, z: 0 }); Object.assign(lm[1], { x: 0.5, y: 0.55, z: 0 });
  return lm;
}

test('head angles come out of the landmarks with the signs the guide uses: your left is positive yaw, up is positive pitch', async () => {
  const { headAngles } = await load();
  const a = headAngles(face(20, 0)); assert.ok(Math.abs(a.yaw - 20) < 0.01 && Math.abs(a.pitch) < 0.01);
  const b = headAngles(face(-15, 12)); assert.ok(Math.abs(b.yaw + 15) < 0.01 && Math.abs(b.pitch - 12) < 0.01);
  assert.ok(Math.abs(headAngles(face(0, 0)).roll) < 0.01);
  assert.equal(headAngles(null), null); assert.equal(headAngles([]), null);
  const broken = face(); broken[454].z = NaN; assert.equal(headAngles(broken), null);
  const flat = face(); flat[454].x = flat[234].x; assert.equal(headAngles(flat), null, 'no width means no angle');
});

// Drives the capture: one look every 100 ms at the angles the function gives for the current pose, taking a sample whenever it says so.
function run(pc, anglesFor, seconds, { t0 = 0, problem = '' } = {}) {
  let t = t0, taken = [];
  for (let i = 0; i < seconds * 10 && !pc.done; i++) {
    t += 100;
    const a = anglesFor(pc.pose, t);
    const r = pc.update({ angles: a, problem }, t);
    if (r.capture) { taken.push(pc.pose.id); pc.recorded(a, t); }
  }
  return { t, taken };
}
// Someone whose straight-ahead is (3, -2) degrees (the camera sits a little high) and who turns a good 20 degrees in each direction asked for.
const BASE = { yaw: 3, pitch: -2 };
const turned = (pose, amount = 20) => ({ yaw: BASE.yaw + pose.yaw * amount, pitch: BASE.pitch + pose.pitch * amount * 0.7 });

test('all nine poses are captured, two samples each, in the order shown, when the head really turns that way', async () => {
  const { PoseCapture, POSES } = await load();
  const pc = new PoseCapture();
  const { taken } = run(pc, (p) => turned(p), 120);
  assert.equal(pc.done, true);
  assert.deepEqual(taken, POSES.flatMap((p) => [p.id, p.id]));
  assert.equal(pc.capturedPoses.size, 8, 'the eight directions (centre is not a direction)');
  assert.equal(pc.count, 18);
  assert.deepEqual([pc.baseline.yaw, pc.baseline.pitch], [BASE.yaw, BASE.pitch], 'straight ahead is where YOUR head sat, not zero');
});

test('nothing is taken in the first moments, before the pose has been held, or until it has been seen a few times in a row', async () => {
  const { PoseCapture } = await load();
  const pc = new PoseCapture();
  let first = null, t = 0;
  for (let i = 0; i < 40 && first === null; i++) { t += 100; if (pc.update({ angles: { yaw: 0, pitch: 0 } }, t).capture) first = t; }
  assert.ok(first >= 1500 + 500, `the first sample comes after the start delay and the hold, not at ${first} ms`);
  const slow = new PoseCapture({ initialDelayMs: 0 }); let n = 0;
  for (const t2 of [100, 200, 300, 400, 500, 600, 700]) if (slow.update({ angles: { yaw: 0, pitch: 0 } }, t2).capture) n++;
  assert.equal(n, 0, 'held for 600 ms with 3 looks needed after the half-second hold: not yet');
});

test('the wrong way, not far enough, or too far gives no sample, and each says what to do', async () => {
  const { PoseCapture } = await load();
  const pc = new PoseCapture({ initialDelayMs: 0 });
  run(pc, () => ({ yaw: 0, pitch: 0 }), 10); // straight ahead done
  assert.equal(pc.pose.id, 'left');
  assert.equal(run(pc, () => ({ yaw: -25, pitch: 0 }), 6, { t0: 5000 }).taken.length, 0, 'turned RIGHT when asked for left');
  assert.equal(pc.hint, 'turn');
  assert.equal(run(pc, () => ({ yaw: 9, pitch: 0 }), 6, { t0: 6000 }).taken.length, 0, 'not far enough');
  assert.equal(pc.hint, 'almost', 'two thirds of the way: "almost"');
  assert.equal(run(pc, () => ({ yaw: 40, pitch: 0 }), 6, { t0: 7000 }).taken.length, 0, 'turned so far the face is not a good sample');
  assert.equal(pc.hint, 'toofar');
  assert.equal(run(pc, () => ({ yaw: 20, pitch: 0 }), 6, { t0: 8000 }).taken.length, 2, 'a proper left turn');
});

test('a diagonal needs both turns, and a pose that is hard for this camera is relaxed after a while so nobody is stuck', async () => {
  const { PoseCapture } = await load();
  const pc = new PoseCapture({ initialDelayMs: 0 });
  run(pc, () => ({ yaw: 0, pitch: 0 }), 10); run(pc, () => ({ yaw: 20, pitch: 0 }), 10, { t0: 5000 });
  assert.equal(pc.pose.id, 'topLeft');
  const S = pc.poseStartedAt;
  const feed = (from, to, a) => { let got = 0; for (let t = from; t < to; t += 100) { const r = pc.update({ angles: a }, t); if (r.capture) { got++; pc.recorded(a, t); } } return got; };
  assert.equal(feed(S + 100, S + 5000, { yaw: 20, pitch: 0 }), 0, 'only the sideways half of a top-left');
  // a camera that sees little vertical turn: 11 left and 8 up is under the bands at first
  assert.equal(feed(S + 5000, S + 11900, { yaw: 11, pitch: 8 }), 0, 'before 12 seconds on this pose: still refused');
  assert.ok(Math.abs(pc.widen(S + 11900) - 1) < 1e-9 && Math.abs(pc.widen(S + 12100) - 1.25) < 1e-9, 'then the bands are a quarter wider');
  assert.equal(feed(S + 12100, S + 15000, { yaw: 11.5, pitch: 8.5 }), 2, 'and a turn that was too small before is accepted');
  assert.equal(pc.widen(S + 99000), 2, 'never more than doubled');
});

test('a bad picture (no face, two faces, too far, too close) takes nothing and says why; progress resets', async () => {
  const { PoseCapture } = await load();
  for (const p of ['none', 'many', 'far', 'near']) {
    const pc = new PoseCapture({ initialDelayMs: 0 });
    assert.equal(run(pc, () => ({ yaw: 0, pitch: 0 }), 5, { problem: p }).taken.length, 0); assert.equal(pc.hint, p); assert.equal(pc.progress, 0);
  }
  const none = new PoseCapture(); none.update({ angles: null }, 100); assert.equal(none.hint, 'none');
  const wild = new PoseCapture({ initialDelayMs: 0 }); wild.update({ angles: { yaw: 40, pitch: 0 } }, 100); assert.equal(wild.hint, 'straighten', 'before straight ahead is set, a head turned away is asked to face the camera');
});

test('the ring progress follows the turn, from nothing to full, and a pose is not done until its samples are in', async () => {
  const { PoseCapture } = await load();
  const pc = new PoseCapture({ initialDelayMs: 0 });
  run(pc, () => ({ yaw: 0, pitch: 0 }), 10); assert.equal(pc.pose.id, 'left');
  pc.update({ angles: { yaw: 0, pitch: 0 } }, 9000); assert.equal(pc.progress, 0);
  pc.update({ angles: { yaw: 7, pitch: 0 } }, 9100); assert.ok(Math.abs(pc.progress - 0.5) < 1e-9);
  pc.update({ angles: { yaw: 20, pitch: 0 } }, 9200); assert.equal(pc.progress, 1);
  pc.recorded({ yaw: 20, pitch: 0 }, 9300); assert.equal(pc.pose.id, 'left', 'one of two samples');
  assert.equal(pc.count, 3);
  pc.recorded({ yaw: 20, pitch: 0 }, 9400); assert.equal(pc.pose.id, 'topLeft'); assert.ok(pc.capturedPoses.has('left'));
});

test('every hint has words for the person, and the pose list is the nine in Glance order with the compass directions', async () => {
  const { HINTS, POSES, POSE_IDS } = await load();
  assert.deepEqual(POSE_IDS, ['center', 'left', 'topLeft', 'top', 'topRight', 'right', 'bottomRight', 'bottom', 'bottomLeft']);
  assert.deepEqual(POSES.map((p) => p.compass), [null, 270, 315, 0, 45, 90, 135, 180, 225]);
  for (const k of ['ready', 'none', 'many', 'far', 'near', 'straighten', 'toofar', 'almost', 'hold', 'done']) assert.ok(HINTS[k].length > 3, k);
  for (const p of POSES) assert.ok(p.label.length > 10);
});

test('the ring only counts the turn being asked for: wobble on the other axis is not progress, and a full turn reads 100%', async () => {
  const { PoseCapture } = await load();
  const pc = new PoseCapture({ initialDelayMs: 0 });
  run(pc, () => ({ yaw: 0, pitch: 0 }), 10); assert.equal(pc.pose.id, 'left');
  pc.update({ angles: { yaw: 17, pitch: 4 } }, 9000);
  assert.equal(pc.progress, 1, 'turned 17 degrees left with a little nod: the left turn is complete');
  pc.update({ angles: { yaw: 7, pitch: -6 } }, 9100); assert.ok(Math.abs(pc.progress - 0.5) < 1e-9);
});

// ---- the scan report and redoing only the weak angles ----
function rng(seed = 7) { let s = seed; return () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296 - 0.5; }; }
function scan({ weak = [], noise = 0.5, seed = 7 } = {}) {
  const r = rng(seed), base = Array.from({ length: 128 }, () => r()), ids = ['center', 'left', 'topLeft', 'top', 'topRight', 'right', 'bottomRight', 'bottom', 'bottomLeft'];
  return ids.flatMap((pose) => [0, 1].map(() => ({ pose, embedding: weak.includes(pose) ? Array.from({ length: 128 }, () => r()) : base.map((b) => b + noise * r()) })));
}

test('a clean scan is rated reliable, with high accuracy and reliability and no weak angle', async () => {
  const { assessEnrollment, scanVerdict } = await load();
  const a = assessEnrollment(scan());
  assert.equal(a.status, 'good'); assert.equal(a.accuracy, 100); assert.ok(a.reliability >= 70, `reliability ${a.reliability}`); assert.deepEqual(a.weak, []); assert.equal(a.per.length, 9);
  assert.equal(scanVerdict(a).title, 'Reliable scan');
});

test('weak angles are found by name, the scan is rated "decent" with a few and "not reliable" with many, and the words say which to redo', async () => {
  const { assessEnrollment, scanVerdict } = await load();
  const some = assessEnrollment(scan({ weak: ['topLeft', 'bottom'] }));
  assert.deepEqual([...some.weak].sort(), ['bottom', 'topLeft']); assert.equal(some.status, 'ok'); assert.ok(some.accuracy < 100 && some.accuracy >= 75);
  assert.match(scanVerdict(some).line, /top left, bottom/); assert.equal(scanVerdict(some).title, 'Decent, but it can be better');
  const many = assessEnrollment(scan({ weak: ['left', 'topLeft', 'top', 'topRight', 'right'] }));
  assert.equal(many.status, 'poor'); assert.ok(many.accuracy < 75); assert.equal(scanVerdict(many).title, 'This scan is not reliable');
  const noisy = assessEnrollment(scan({ noise: 6 })); assert.notEqual(noisy.status, 'good', 'embeddings that barely agree are not called reliable');
  assert.equal(assessEnrollment([]).status, 'poor'); assert.equal(scanVerdict(assessEnrollment([])).title, 'No result');
});

test('a live check straight after saving can lower the verdict but never raise it', async () => {
  const { assessEnrollment } = await load();
  assert.equal(assessEnrollment(scan(), { live: { passed: 6, total: 6, mean: 0.8 } }).status, 'good');
  assert.equal(assessEnrollment(scan(), { live: { passed: 4, total: 6, mean: 0.8 } }).status, 'ok', 'recognised in only 4 of 6 fresh looks: not "good"');
  assert.equal(assessEnrollment(scan(), { live: { passed: 6, total: 6, mean: 0.40 } }).status, 'ok', 'recognised, but only just');
  assert.equal(assessEnrollment(scan(), { live: { passed: 1, total: 6, mean: 0.2 } }).status, 'poor');
  assert.equal(assessEnrollment(scan({ weak: ['top'] }), { live: { passed: 6, total: 6, mean: 0.9 } }).status, 'ok', 'a perfect live check does not rescue a weak angle');
  assert.deepEqual(assessEnrollment(scan(), { live: { passed: 5, total: 6, mean: 0.7 } }).live, { accuracy: 83, mean: 0.7, passed: 5, total: 6 });
});

test('redoing only some poses captures just those, keeps where your head sat straight ahead, and finishes when they are done', async () => {
  const { PoseCapture, POSES } = await load();
  const pc = new PoseCapture({ initialDelayMs: 0 });
  run(pc, (p) => turned(p), 120); assert.equal(pc.done, true); const base = { ...pc.baseline };
  assert.equal(pc.redo(['topLeft', 'bottom'], 200000), true);
  assert.equal(pc.done, false); assert.equal(pc.total, 4); assert.equal(pc.count, 0); assert.equal(pc.pose.id, 'topLeft'); assert.equal(pc.capturedPoses.has('topLeft'), false); assert.equal(pc.capturedPoses.has('left'), true);
  const { taken } = run(pc, (p) => turned(p), 60, { t0: 200000 });
  assert.deepEqual(taken, ['topLeft', 'topLeft', 'bottom', 'bottom']); assert.equal(pc.done, true); assert.deepEqual(pc.baseline, base, 'straight ahead was not redone, so it is kept');
  assert.equal(pc.capturedPoses.has('topLeft') && pc.capturedPoses.has('bottom'), true);
  assert.equal(pc.redo([]), false); assert.equal(pc.redo(['nonsense']), false);
  const again = new PoseCapture({ initialDelayMs: 0 }); run(again, (p) => turned(p), 120);
  again.redo(['center', 'right'], 300000); assert.equal(again.baseline, null, 'redoing straight ahead resets the baseline'); assert.equal(again.pose.id, 'center');
  assert.equal(POSES.length, 9, 'the nine poses themselves are untouched');
});

test('a scan that clears the threshold but only just is not called reliable, and a real scan of the owner is', async () => {
  const { assessEnrollment, scanVerdict, SCAN_BARS } = await load();
  const mid = assessEnrollment(scan({ noise: 0.7 }));
  assert.equal(mid.accuracy, 100, 'every angle is still recognised'); assert.deepEqual(mid.weak, [], 'and no single angle is the problem'); assert.ok(mid.reliability < SCAN_BARS.reliable, `reliability ${mid.reliability}`);
  assert.equal(mid.status, 'ok'); assert.match(scanVerdict(mid).line, /not by much|better light|weakest/);
  assert.equal(SCAN_BARS.reliable, 80);
});
