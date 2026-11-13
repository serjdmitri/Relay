import test from 'node:test';
import assert from 'node:assert/strict';
import { TwoFingerSwipe, twoFingerVector, degrees } from '../src/renderer/swipe.js';
import { poseOf } from '../src/renderer/hand-pose.js';

const A = 4 / 3;
// A peace-sign hand pointing up (same drawing as the hand-pose tests): fingers are a base, a middle joint, a joint and a tip along a line.
function peace() {
  const l = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.8 }));
  const at = (ang, r) => ({ x: 0.5 + Math.sin(ang) * r, y: 0.8 - Math.cos(ang) * r });
  const finger = (base, angle, out) => { l[base] = at(angle, 0.16); l[base + 1] = at(angle, out ? 0.22 : 0.2); l[base + 2] = at(angle, out ? 0.26 : 0.17); l[base + 3] = at(angle, out ? 0.31 : 0.14); };
  finger(5, -0.25, true); finger(9, 0, true); finger(13, 0.22, false); finger(17, 0.45, false);
  l[0] = { x: 0.5, y: 0.8 };
  for (let i = 1; i <= 4; i++) l[i] = at(-0.9, 0.05 + i * 0.01);
  return l;
}
const REF = twoFingerVector(peace(), A).len;
// The same hand with the two fingertips moved so the two-finger arrow is `vec` (in picture-height units).
function arrow(vec) {
  const l = peace(), kx = (l[5].x + l[9].x) / 2, ky = (l[5].y + l[9].y) / 2;
  l[8] = { x: kx + vec.x / A - 0.01, y: ky + vec.y }; l[12] = { x: kx + vec.x / A + 0.01, y: ky + vec.y };
  return l;
}
const toward = () => arrow({ x: 0.01, y: -REF * 0.18 });          // pointing at the camera: the arrow is short
const side = (deg, toYourLeft) => arrow({ x: (toYourLeft ? 1 : -1) * REF * Math.sin((deg * Math.PI) / 180), y: -REF * 0.05 }); // turned out to the side
const FRAME = 33;

// Plays frames in time and returns every event.
function play(det, frames, t0 = 1000) {
  const events = []; let t = t0;
  for (const f of frames) { const e = det.push(f, t); if (e) events.push(e); t += FRAME; }
  return { events, t };
}
const rep = (f, n) => Array.from({ length: n }, () => f);
const gesture = (deg, toYourLeft) => [...rep(peace(), 6), ...rep(toward(), 3), ...rep(side(deg, toYourLeft), 5)];

test('the peace sign that the swipe starts from is read as one, and the arrow lengths behave', () => {
  assert.equal(poseOf(peace()), 'Victory');
  assert.ok(REF > 0.1);
  assert.ok(twoFingerVector(toward(), A).len < REF * 0.3, 'pointing at the camera looks short');
  assert.ok(Math.abs(degrees(twoFingerVector(side(40, true), A).len / REF) - 40) < 3, 'the turn is read back in degrees');
});

test('up, at the camera, then turned to your left gives one swipe to the left; to your right, one to the right', () => {
  assert.deepEqual(play(new TwoFingerSwipe(), gesture(70, true)).events.map((e) => e.dir), ['left']);
  assert.deepEqual(play(new TwoFingerSwipe(), gesture(60, false)).events.map((e) => e.dir), ['right']);
});

test('a turn short of 90 degrees is enough, and the right side needs less than the left, as the wrist turns less that way', () => {
  assert.deepEqual(play(new TwoFingerSwipe(), gesture(45, false)).events.map((e) => e.dir), ['right'], '45 degrees to the right is enough');
  const left45 = play(new TwoFingerSwipe(), gesture(45, true));
  assert.equal(left45.events.length, 0, '45 degrees to the left is not (it needs 55)');
  assert.equal(play(new TwoFingerSwipe(), gesture(58, true)).events.length, 1);
  assert.equal(play(new TwoFingerSwipe({ leftDeg: 40 }), gesture(45, true)).events.length, 1, 'the amounts can be changed');
});

test('a turn that never gets far enough is only logged, with how far it got', () => {
  const det = new TwoFingerSwipe();
  const { events } = play(det, [...rep(peace(), 6), ...rep(toward(), 3), ...rep(side(40, true), 60)]);
  assert.equal(events.filter((e) => e.type === 'swipe').length, 0);
  const miss = events.find((e) => e.type === 'miss');
  assert.ok(miss && /turned 4\d degrees to the left, needs 55/.test(miss.why), miss && miss.why);
});

test('the steps must come in order: turning the hand to the side without pointing at the camera is never a swipe', () => {
  // two fingers up, then rolled over to the side in the picture: the arrow stays long the whole way
  const rolled = Array.from({ length: 12 }, (_, i) => arrow({ x: REF * Math.sin((i / 11) * 1.5), y: -REF * Math.cos((i / 11) * 1.5) }));
  assert.equal(play(new TwoFingerSwipe(), [...rep(peace(), 6), ...rolled, ...rep(side(80, true), 8)]).events.filter((e) => e.type === 'swipe').length, 0);
  // an open hand waved about, and a peace sign shown for less than a moment
  const open = peace(); open[16] = { x: 0.62, y: 0.55 }; open[20] = { x: 0.7, y: 0.6 };
  assert.equal(play(new TwoFingerSwipe(), [...rep(open, 10), ...rep(toward(), 3), ...rep(side(80, true), 5)]).events.length, 0);
  assert.equal(play(new TwoFingerSwipe(), [...rep(peace(), 2), ...rep(toward(), 3), ...rep(side(80, true), 5)]).events.length, 0, 'not held long enough');
});

test('one swipe moves one desktop: holding the turn does nothing more, and the next swipe needs the hand to come back', () => {
  const det = new TwoFingerSwipe();
  const first = play(det, [...gesture(70, true), ...rep(side(70, true), 40)]);
  assert.equal(first.events.filter((e) => e.type === 'swipe').length, 1, 'held for over a second: still one');
  // the hand goes away, then the whole gesture again to the other side
  const gone = play(det, rep(null, 20), first.t);
  const again = play(det, gesture(60, false), gone.t + 400);
  assert.deepEqual(again.events.filter((e) => e.type === 'swipe').map((e) => e.dir), ['right']);
});

test('the steps have to follow each other quickly, or the swipe starts over', () => {
  const det = new TwoFingerSwipe();
  const slow = play(det, [...rep(peace(), 6), ...rep(null, 80), ...rep(toward(), 3), ...rep(side(80, true), 5)]);
  assert.equal(slow.events.filter((e) => e.type === 'swipe').length, 0);
});

test('a picture that is already mirrored reads the turn the other way', () => {
  assert.deepEqual(play(new TwoFingerSwipe({ mirrored: true }), gesture(70, true)).events.map((e) => e.dir), ['right']);
});

test('when the hand finder loses the hand while the fingers point at the camera, the swipe still works once it is back', () => {
  const lost = [...rep(peace(), 6), ...rep(null, 8), ...rep(side(70, true), 5)];
  assert.deepEqual(play(new TwoFingerSwipe(), lost).events.map((e) => e.dir), ['left']);
  // a hand that just leaves the picture and does not come back turned is nothing
  assert.equal(play(new TwoFingerSwipe(), [...rep(peace(), 6), ...rep(null, 8), ...rep(peace(), 5)]).events.length, 0);
});

test('each step the detector enters is reported, once, for the badge at the pointer', () => {
  const seen = [];
  const det = new TwoFingerSwipe({ onStage: (s) => seen.push(s) });
  play(det, gesture(70, true));
  assert.deepEqual(seen, ['up', 'toward', 'locked']);
  const lost = []; const d2 = new TwoFingerSwipe({ onStage: (s) => lost.push(s) });
  play(d2, [...rep(peace(), 6), ...rep(null, 80)]);
  assert.deepEqual(lost, ['up', 'toward', 'idle'], 'back to idle when the steps do not follow in time');
  assert.doesNotThrow(() => play(new TwoFingerSwipe({ onStage: () => { throw new Error('badge broke'); } }), gesture(70, true)));
});

// ---- the fist that turns hand control on ----
import { FistHold, PalmsHold } from '../src/renderer/swipe.js';
function fistHand(scale = 1) {
  const l = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.8 }));
  const at = (ang, r) => ({ x: 0.5 + Math.sin(ang) * r * scale, y: 0.8 - Math.cos(ang) * r * scale });
  const finger = (base, angle) => { l[base] = at(angle, 0.16); l[base + 1] = at(angle, 0.2); l[base + 2] = at(angle, 0.17); l[base + 3] = at(angle, 0.14); };
  finger(5, -0.25); finger(9, 0); finger(13, 0.22); finger(17, 0.45);
  for (let i = 1; i <= 4; i++) l[i] = at(-0.9, 0.05 + i * 0.01);
  return l;
}
const holdFor = (det, hand, ms, t0 = 1000) => { const out = []; for (let t = t0; t <= t0 + ms; t += FRAME) { const e = det.push(hand, t); if (e) out.push(e); } return out; };

test('a fist held toward the camera for the hold time gives one "fist", with the badge told when it starts and ends', () => {
  assert.equal(poseOf(fistHand()), 'Closed_Fist');
  const stages = []; const det = new FistHold({ onStage: (s) => stages.push(s) });
  assert.equal(holdFor(det, fistHand(), 1200).length, 1, 'held on for over a second: still one');
  assert.deepEqual(stages, ['holding', 'idle']);
});

test('a fist shown too briefly, a far away one, or another sign never turns it on', () => {
  const brief = new FistHold(); assert.equal(holdFor(brief, fistHand(), 400).length, 0);
  assert.equal(holdFor(new FistHold(), fistHand(0.3), 1500).length, 0, 'a small, far away hand is not meant for the camera');
  assert.equal(holdFor(new FistHold(), peace(), 1500).length, 0);
});

test('the fist has to open before it can fire again, and a tiny break in it does not restart the count', () => {
  const det = new FistHold();
  assert.equal(holdFor(det, fistHand(), 900).length, 1);
  assert.equal(holdFor(det, fistHand(), 900, 3000).length, 0, 'still closed: nothing more');
  holdFor(det, peace(), 800, 5000); // the hand opens for a while
  assert.equal(holdFor(det, fistHand(), 900, 7000).length, 1);
  // one picture where the hand was not found does not break a hold, but a long gap does
  const a = new FistHold(); const ev = [];
  for (let t = 1000; t <= 1800; t += FRAME) { const e = a.push(t >= 1300 && t < 1400 ? null : fistHand(), t); if (e) ev.push(e); }
  assert.equal(ev.length, 1);
  const b = new FistHold(); const ev2 = [];
  for (let t = 1000; t <= 2000; t += FRAME) { const e = b.push(t >= 1300 && t < 1700 ? null : fistHand(), t); if (e) ev2.push(e); }
  assert.equal(ev2.length, 0);
});

test('two open palms held up for a moment turn hand control on once, and again only after they were lowered', () => {
  const palm = () => { const l = peace(); l[16] = { x: 0.62, y: 0.55 }; l[20] = { x: 0.7, y: 0.6 }; return l; };
  assert.equal(poseOf(palm()), 'Open_Palm');
  const det = new PalmsHold();
  const two = [palm(), palm()];
  const fire = (ls, from, ms) => { const out = []; for (let t = from; t < from + ms; t += FRAME) { const e = det.push(ls, t); if (e) out.push(e); } return out; };
  assert.equal(fire(two, 0, 600).length, 0, 'a short flash is not enough');
  assert.equal(fire(two, 600, 1500).length, 1, 'held on: once');
  assert.equal(fire(two, 2100, 1500).length, 0, 'still held: not again');
  fire([], 3600, 1000);
  assert.equal(fire(two, 4600, 1500).length, 1, 'after lowering them, it can fire again');
  const one = new PalmsHold(); const out = [];
  for (let t = 0; t < 3000; t += FRAME) { const e = one.push([palm()], t); if (e) out.push(e); }
  assert.equal(out.length, 0, 'one palm never does');
  const fists = new PalmsHold(); for (let t = 0; t < 3000; t += FRAME) assert.equal(fists.push([fistHand(), fistHand()], t), null);
});
