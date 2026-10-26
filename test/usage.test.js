const test = require('node:test');
const assert = require('node:assert/strict');
const { add, tokens, modelName, usageLine } = require('../src/main/usage');

test('token counts read short', () => {
  assert.deepEqual([tokens(90), tokens(1240), tokens(15300), tokens(2400000)], ['90', '1.2k', '15k', '2.4M']);
  assert.equal(tokens(2000), '2k');
});

test('model names are friendly', () => {
  assert.equal(modelName('claude-haiku-5-5'), 'Haiku');
  assert.equal(modelName('claude-sonnet-5-5'), 'Sonnet');
  assert.equal(modelName('gpt-4o-mini'), 'gpt-4o-mini');
});

test('the usage line shows what is known and leaves out the rest', () => {
  assert.equal(usageLine({ model: 'claude-haiku-5-5', ms: 2100, in: 1400, out: 90 }), 'Haiku · 2.1s · 1.4k in · 90 out');
  assert.equal(usageLine({ model: 'claude-sonnet-5-5', ms: 14000, in: 21000, out: 400, cost: 0.0042, limit: { type: 'five_hour', util: 0.96 } }), 'Sonnet · 14s · 21k in · 400 out · ≈ $0.0042 at API prices · 5-hour limit 96% used');
  assert.equal(usageLine({ ms: 80 }), '0.1s');
  assert.equal(usageLine(null), '');
});

test('usage adds up across steps and keeps the latest model', () => {
  assert.deepEqual(add(add(null, { in: 10, out: 2, model: 'a' }), { in: 5, out: 1, model: 'b' }), { in: 15, out: 3, model: 'b' });
});
