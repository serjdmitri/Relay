const test = require('node:test');
const assert = require('node:assert/strict');
const { SwipeGate, desktopFor } = require('../src/main/swipeGate');

const rig = (over = {}) => {
  const s = { cfg: { enabled: true }, enrolled: true, owner: { seen: 'owner', lastOwnerAt: 100000 }, faces: { count: 1, at: 100000 }, blocked: '', t: 100500 };
  Object.assign(s, over);
  s.gate = new SwipeGate({ getConfig: () => s.cfg, ownerEnrolled: () => s.enrolled, owner: () => s.owner, faces: () => s.faces, blocked: () => s.blocked, now: () => s.t });
  return s;
};

test('turning to your left shows the desktop on the right, and the other way round; flip reverses it', () => {
  assert.deepEqual(desktopFor('left'), { name: 'right', keyCode: 124 });
  assert.deepEqual(desktopFor('right'), { name: 'left', keyCode: 123 });
  assert.equal(desktopFor('left', true).name, 'left');
  assert.equal(desktopFor('right', true).name, 'right');
});

test('it lets a swipe through only when you were recognised a moment ago', () => {
  const s = rig();
  assert.equal(s.gate.check({ dir: 'left' }).ok, true);
  const old = rig({ owner: { seen: 'owner', lastOwnerAt: 80000 } });
  assert.deepEqual(old.gate.check({ dir: 'left' }), { ok: false, why: 'you were not recognised just now' });
  const other = rig({ owner: { seen: 'stranger', lastOwnerAt: 100400 } });
  assert.equal(other.gate.check({ dir: 'left' }).why, 'someone else is in view');
});

test('without owner recognition it needs exactly one face in view, recently', () => {
  assert.equal(rig({ enrolled: false }).gate.check({ dir: 'right' }).ok, true);
  assert.equal(rig({ enrolled: false, faces: { count: 2, at: 100400 } }).gate.check({ dir: 'right' }).why, 'more than one face in view');
  assert.equal(rig({ enrolled: false, faces: { count: 0, at: 100400 } }).gate.check({ dir: 'right' }).why, 'no face in view');
  assert.equal(rig({ enrolled: false, faces: { count: 1, at: 90000 } }).gate.check({ dir: 'right' }).why, 'no face in view');
});

test('it stays quiet when off, when blocked, for a bad direction, and straight after a swipe', () => {
  assert.equal(rig({ cfg: { enabled: false } }).gate.check({ dir: 'left' }).why, 'off');
  assert.equal(rig({ blocked: 'the screen is locked' }).gate.check({ dir: 'left' }).why, 'the screen is locked');
  assert.equal(rig().gate.check({ dir: 'up' }).ok, false);
  const s = rig();
  assert.equal(s.gate.check({ dir: 'left' }).ok, true);
  s.t += 300; assert.equal(s.gate.check({ dir: 'left' }).why, 'too soon after the last swipe');
  s.t += 800; s.owner = { seen: 'owner', lastOwnerAt: s.t - 100 }; assert.equal(s.gate.check({ dir: 'left' }).ok, true);
});

test('peek says whether a swipe would be let through, without counting as one', () => {
  const s = rig();
  assert.equal(s.gate.peek().ok, true); assert.equal(s.gate.peek().ok, true);
  assert.equal(s.gate.check({ dir: 'left' }).ok, true, 'peeking did not use up the swipe');
  assert.equal(s.gate.peek().ok, true, 'peek ignores the short rest after a swipe');
  assert.equal(rig({ owner: { seen: 'stranger', lastOwnerAt: 100400 } }).gate.peek().ok, false);
});
