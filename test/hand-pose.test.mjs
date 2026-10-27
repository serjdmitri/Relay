import test from 'node:test';
import assert from 'node:assert/strict';
import { fingers, poseOf, pinchOf } from '../src/renderer/hand-pose.js';

// A hand pointing up, drawn from the wrist: each finger is a base, a middle joint, a joint and a tip along a line; a curled finger folds
// back toward the palm so its tip is no farther from the wrist than its middle joint.
function hand({ thumb = false, index = false, middle = false, ring = false, pinky = false, rot = 0, pinch = false } = {}) {
  const l = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.8 }));
  const at = (ang, r) => ({ x: 0.5 + Math.sin(ang) * r, y: 0.8 - Math.cos(ang) * r });
  const finger = (base, angle, out) => {
    const a = angle + rot;
    l[base] = at(a, 0.16);
    l[base + 1] = at(a, out ? 0.22 : 0.2);
    l[base + 2] = at(a, out ? 0.26 : 0.17);
    l[base + 3] = at(a, out ? 0.31 : 0.14);
  };
  finger(5, -0.25, index); finger(9, 0, middle); finger(13, 0.22, ring); finger(17, 0.45, pinky);
  l[0] = { x: 0.5, y: 0.8 };
  const ta = -0.9 + rot;
  l[1] = at(ta, 0.06); l[2] = at(ta, 0.1); l[3] = at(ta, thumb ? 0.15 : 0.1); l[4] = at(ta, thumb ? 0.2 : 0.09);
  if (pinch) l[4] = { x: l[8].x + 0.01, y: l[8].y + 0.01 };
  return l;
}

test('a fist, an open hand, a peace sign and a pointing finger are told apart, whichever way the hand is turned', () => {
  for (const rot of [0, 0.8, -1.2, 2.5, 3.1]) {
    assert.equal(poseOf(hand({ rot })), 'Closed_Fist', `fist at ${rot}`);
    assert.equal(poseOf(hand({ rot, thumb: true, index: true, middle: true, ring: true, pinky: true })), 'Open_Palm', `palm at ${rot}`);
    assert.equal(poseOf(hand({ rot, index: true, middle: true })), 'Victory', `victory at ${rot}`);
    assert.equal(poseOf(hand({ rot, index: true })), 'Pointing_Up', `point at ${rot}`);
  }
  assert.equal(poseOf(null), 'None');
  assert.deepEqual(Object.entries(fingers(hand({ index: true, pinky: true }))).filter(([, v]) => v).map(([k]) => k), ['index', 'pinky']);
});

test('thumb and index tip together read as a pinch, apart as open', () => {
  assert.ok(pinchOf(hand({ index: true, middle: true, ring: true, pinky: true, pinch: true })) < 0.2);
  assert.ok(pinchOf(hand({ thumb: true, index: true, middle: true, ring: true, pinky: true })) > 0.45);
});

test('a thumb held straight up or straight down on a closed hand is told from a fist', () => {
  const up = hand({});
  up[4] = { x: up[0].x, y: up[0].y - 0.3 }; up[3] = { x: up[0].x, y: up[0].y - 0.2 }; up[2] = { x: up[0].x, y: up[0].y - 0.1 };
  assert.equal(poseOf(up), 'Thumb_Up');
  const down = hand({});
  down[4] = { x: down[0].x, y: down[0].y + 0.3 }; down[3] = { x: down[0].x, y: down[0].y + 0.2 }; down[2] = { x: down[0].x, y: down[0].y + 0.1 };
  assert.equal(poseOf(down), 'Thumb_Down');
  assert.equal(poseOf(hand({})), 'Closed_Fist', 'a plain fist is still a fist');
});
