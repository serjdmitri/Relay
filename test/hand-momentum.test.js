const test = require('node:test');
const assert = require('node:assert/strict');
const { velocity, step } = require('../src/main/hands/momentum');
test('only recent deliberate motion gets momentum', () => {
  assert.equal(velocity([{x: 0, y: 0, t: 0}, {x: 5, y: 0, t: 100}], 100), null);
  assert.equal(velocity([{x: 0, y: 0, t: 0}, {x: 200, y: 0, t: 100}], 250), null);
  assert.deepEqual(velocity([{x: 0, y: 0, t: 0}, {x: 200, y: 0, t: 100}], 100), {vx: 2, vy: 0});
});
test('glide decelerates and only right-edge travel dismisses', () => {
  const bounds = {x: 0, y: 0, width: 1000, height: 800};
  const a = step({x: 100, y: 200}, {vx: 1, vy: 0}, bounds);
  assert.equal(a.point.x, 116); assert.equal(a.close, false); assert.ok(a.velocity.vx < 1);
  assert.equal(step({x: 990, y: 200}, {vx: 1, vy: 0}, bounds).close, true);
  assert.equal(step({x: 5, y: 200}, {vx: -1, vy: 0}, bounds).close, false);
});
