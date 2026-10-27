const test = require('node:test');
const assert = require('node:assert/strict');
const { HandPointer } = require('../src/main/hands/logic');

function rig() {
  const events = [];
  const hp = new HandPointer({ onEvent: (e) => events.push(e) });
  let t = 1000;
  const hand = (o = {}) => ({ x: 0.5, y: 0.5, gesture: 'Open_Palm', pinch: 0.9, size: 0.2, score: 1, ...o });
  // n frames 33 ms apart with these hands (a function of the frame number, or fixed)
  const run = (n, hands) => { for (let i = 0; i < n; i++) { hp.update({ t, hands: (typeof hands === 'function' ? hands(i) : hands) }); t += 33; } };
  const types = () => events.map((e) => e.type);
  return { hp, events, run, hand, types, clear: () => { events.length = 0; }, now: () => t };
}

test('an open hand moves the pointer, mirrored, using the middle of the picture so the edges are reachable', () => {
  const r = rig();
  r.run(30, [r.hand({ x: 0.2, y: 0.5 })]);
  const last = r.events.at(-1);
  assert.equal(last.type, 'move');
  assert.ok(last.x > 0.85, `your right is the screen's right: ${last.x}`);
  r.clear();
  r.run(40, [r.hand({ x: 0.0, y: 1.0 })]);
  const edge = r.events.at(-1);
  assert.ok(edge.x > 0.97 && edge.y > 0.97, `the picture edge is the screen edge: ${edge.x}, ${edge.y}`);
});

test('a fist grabs, moving while it is held drags, opening the hand lets go', () => {
  const r = rig();
  r.run(5, [r.hand()]);
  r.clear();
  r.run(4, [r.hand({ gesture: 'Closed_Fist', pinch: 0.1 })]);
  assert.deepEqual(r.types().filter((t) => t !== 'move'), ['grab']);
  r.run(10, (i) => [r.hand({ gesture: 'Closed_Fist', x: 0.5 - i * 0.01, pinch: 0.1 })]);
  assert.ok(r.events.filter((e) => e.type === 'move' && e.held).length >= 8, 'moves while held are marked as held');
  r.clear();
  r.run(4, [r.hand({ gesture: 'Open_Palm' })]);
  assert.deepEqual(r.types().filter((t) => t !== 'move'), ['release']);
  r.run(20, [r.hand()]);
  assert.ok(!r.types().includes('grab'), 'it does not grab again by itself');
});

test('a quick pinch is a click where the hand was; no stray pointer jumps', () => {
  const r = rig();
  r.run(10, [r.hand()]);
  r.clear();
  r.run(4, [r.hand({ pinch: 0.15 })]);
  r.run(5, [r.hand({ pinch: 0.8 })]);
  const clicks = r.events.filter((e) => e.type === 'click');
  assert.equal(clicks.length, 1);
  assert.ok(!r.types().includes('pinchdown'));
  assert.ok(Math.abs(clicks[0].x - 0.5) < 0.2);
});

test('a pinch held and moved is a press and drag, ended when the fingers open', () => {
  const r = rig();
  r.run(8, [r.hand()]);
  r.clear();
  r.run(20, (i) => [r.hand({ pinch: 0.12, x: 0.5 - i * 0.01 })]);
  assert.ok(r.types().includes('pinchdown'));
  assert.ok(!r.types().includes('click'));
  r.run(4, [r.hand({ pinch: 0.8 })]);
  assert.ok(r.types().includes('pinchup'));
  assert.ok(!r.types().includes('click'), 'a drag is not also a click');
});

test('two hands pinching or in fists and moving apart or together resize', () => {
  const r = rig();
  const two = (gap) => [r.hand({ x: 0.5 - gap / 2, pinch: 0.1, size: 0.25 }), r.hand({ x: 0.5 + gap / 2, pinch: 0.1, size: 0.2 })];
  r.run(5, two(0.2));
  r.clear();
  r.run(25, (i) => two(0.2 + i * 0.01));
  const scales = r.events.filter((e) => e.type === 'scale');
  assert.ok(scales.length >= 3);
  assert.ok(scales.every((s) => s.factor > 1), 'apart is bigger');
  const total = scales.reduce((p, s) => p * s.factor, 1);
  assert.ok(total > 1.3 && total < 2.6, `about as much as the hands moved: ${total}`);
  r.clear();
  r.run(25, (i) => two(0.44 - i * 0.01));
  assert.ok(r.events.filter((e) => e.type === 'scale').every((s) => s.factor < 1), 'together is smaller');
  assert.ok(!r.types().includes('grab'), 'two fists are not a grab');
});

test('a peace sign held a moment opens the mic once, and again only after it was put down', () => {
  const r = rig();
  r.run(10, [r.hand({ gesture: 'Victory' })]);
  assert.equal(r.types().filter((t) => t === 'mic').length, 0, 'a quick flash is not enough');
  r.run(15, [r.hand({ gesture: 'Victory' })]);
  assert.equal(r.types().filter((t) => t === 'mic').length, 1);
  r.run(30, [r.hand({ gesture: 'Victory' })]);
  assert.equal(r.types().filter((t) => t === 'mic').length, 1, 'held on: still once');
  r.run(40, [r.hand({ gesture: 'Open_Palm' })]);
  r.run(25, [r.hand({ gesture: 'Victory' })]);
  assert.equal(r.types().filter((t) => t === 'mic').length, 2);
});

test('a hand that leaves the picture lets go of what it held, and the pointer hides', () => {
  const r = rig();
  r.run(6, [r.hand({ gesture: 'Closed_Fist', pinch: 0.1 })]);
  r.clear();
  r.run(10, []);
  assert.deepEqual(r.types(), ['release', 'lost']);
  r.clear();
  r.run(3, []);
  assert.deepEqual(r.types(), [], 'nothing more once lost');
});

test('two fists pulled apart take the model apart, pushed together put it back; two pinches resize and do not', () => {
  const r = rig();
  const two = (gap, g) => [r.hand({ x: 0.5 - gap / 2, gesture: g, pinch: g === 'Closed_Fist' ? 0.8 : 0.1, size: 0.25 }), r.hand({ x: 0.5 + gap / 2, gesture: g, pinch: g === 'Closed_Fist' ? 0.8 : 0.1, size: 0.2 })];
  r.run(5, two(0.2, 'Closed_Fist'));
  assert.ok(r.types().includes('twohands') && !r.types().includes('grab'), 'two fists together are not a grab');
  r.clear();
  r.run(30, (i) => two(0.2 + i * 0.01, 'Closed_Fist'));
  const pulls = r.events.filter((e) => e.type === 'pull');
  assert.ok(pulls.length >= 1 && pulls.every((p) => p.open === true), 'apart: open it');
  assert.ok(!r.types().includes('scale'), 'fists do not resize');
  r.clear();
  r.run(40, (i) => two(0.5 - i * 0.01, 'Closed_Fist'));
  assert.ok(r.events.some((e) => e.type === 'pull' && e.open === false), 'together: close it');
  const p = rig();
  p.run(5, [p.hand({ x: 0.4, pinch: 0.1, size: 0.25 }), p.hand({ x: 0.6, pinch: 0.1, size: 0.2 })]);
  p.clear();
  p.run(25, (i) => [p.hand({ x: 0.4 - i * 0.005, pinch: 0.1, size: 0.25 }), p.hand({ x: 0.6 + i * 0.005, pinch: 0.1, size: 0.2 })]);
  assert.ok(p.types().includes('scale') && !p.types().includes('pull'), 'pinches resize, they do not pull apart');
});

test('turning two pinching hands like a wheel rolls the model, the right way round', () => {
  const r = rig();
  const wheel = (a) => [r.hand({ x: 0.5 - 0.15 * Math.cos(a), y: 0.5 - 0.15 * Math.sin(a), pinch: 0.1, size: 0.25 }), r.hand({ x: 0.5 + 0.15 * Math.cos(a), y: 0.5 + 0.15 * Math.sin(a), pinch: 0.1, size: 0.2 })];
  r.run(5, wheel(0));
  r.clear();
  r.run(20, (i) => wheel(i * 0.04));
  const twists = r.events.filter((e) => e.type === 'twist');
  assert.ok(twists.length >= 4);
  const total = twists.reduce((s, t) => s + t.angle, 0);
  assert.ok(total < -0.5 && total > -1.0, `about as far as the hands turned (0.76 rad), the other way because the picture is mirrored: ${total}`);
  assert.ok(!r.types().includes('scale'), 'turning in place does not resize');
});

test('a quick flick sideways is a swipe (once, in the right direction); slow pointing never is', () => {
  const r = rig();
  r.run(6, [r.hand({ x: 0.5 })]);
  r.clear();
  r.run(5, (i) => [r.hand({ x: 0.5 - i * 0.07 })]); // the picture is mirrored: the hand going left in the picture is the pointer going right
  r.run(15, [r.hand({ x: 0.1 })]);
  const swipes = r.events.filter((e) => e.type === 'swipe');
  assert.equal(swipes.length, 1);
  assert.equal(swipes[0].dir, 'right');
  const slow = rig();
  slow.run(6, [slow.hand({ x: 0.2 })]);
  slow.clear();
  slow.run(60, (i) => [slow.hand({ x: 0.2 + i * 0.01 })]);
  assert.ok(!slow.types().includes('swipe'), 'a slow move across the whole picture is just pointing');
});

test('a thumb up held keeps, a thumb down held closes, each once', () => {
  const r = rig();
  r.run(8, [r.hand({ gesture: 'Thumb_Up' })]);
  assert.equal(r.types().filter((t) => t === 'thumbup').length, 0);
  r.run(15, [r.hand({ gesture: 'Thumb_Up' })]);
  r.run(20, [r.hand({ gesture: 'Thumb_Up' })]);
  assert.equal(r.types().filter((t) => t === 'thumbup').length, 1);
  r.run(40, [r.hand({ gesture: 'Open_Palm' })]);
  r.run(25, [r.hand({ gesture: 'Thumb_Down' })]);
  assert.equal(r.types().filter((t) => t === 'thumbdown').length, 1);
});

test('a pointing finger held a moment picks what it points at, once', () => {
  const r = rig();
  r.run(8, [r.hand({ gesture: 'Pointing_Up' })]);
  assert.equal(r.types().filter((t) => t === 'point').length, 0, 'a flash is not enough');
  r.run(20, [r.hand({ gesture: 'Pointing_Up' })]);
  assert.equal(r.types().filter((t) => t === 'point').length, 1);
});
