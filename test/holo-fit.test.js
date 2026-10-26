const test = require('node:test');
const assert = require('node:assert/strict');
const { fitPrompt, parsePlacement, heuristicPlacement } = require('../src/main/holo/fit');

test('the prompt names both models with their sizes, and the user hint', () => {
  const p = fitPrompt({ title: 'VEX robot', size: { w: 2, h: 1.2, d: 1.6 } }, { title: 'Claw', size: { w: 0.8, h: 0.5, d: 0.6 } }, 'put the claw on the front');
  assert.match(p, /"VEX robot", 2 wide, 1.2 tall, 1.6 deep/);
  assert.match(p, /"Claw", 0.8 wide/);
  assert.match(p, /put the claw on the front/);
  assert.match(p, /ONLY a JSON object/);
});

test('the answer is checked: a good one is cleaned, nonsense is refused', () => {
  assert.deepEqual(parsePlacement('Sure! {"anchor":"Top","scale":0.6,"rotate":[0,92,0],"note":"on the shoulder"} done'), { anchor: 'top', scale: 0.6, rotate: [0, 90, 0], note: 'on the shoulder' });
  assert.equal(parsePlacement('{"anchor":"sideways"}'), null);
  assert.equal(parsePlacement('no json here'), null);
  assert.equal(parsePlacement('{"anchor": "left", "scale": 99}').scale, 2, 'too big is held to 2');
  assert.equal(parsePlacement('{"anchor": "left", "scale": 0}').scale, 1, 'no scale means normal size');
  assert.deepEqual(parsePlacement('{"anchor":"inside","scale":0.5}').rotate, [0, 0, 0]);
});

test('with no model to ask: small goes on top, similar goes beside', () => {
  const base = { size: { w: 2, h: 2, d: 2 } };
  assert.equal(heuristicPlacement(base, { size: { w: 0.5, h: 0.6, d: 0.5 } }).anchor, 'top');
  const side = heuristicPlacement(base, { size: { w: 1.8, h: 2, d: 1 } });
  assert.equal(side.anchor, 'right');
  assert.ok(side.scale >= 0.5 && side.scale <= 1.5);
});
