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

test('Claude plan utilization is not attributed to Codex or other models', () => {
  const { limitForModel } = require('../src/main/usage');
  const rate = { type: 'five_hour', util: 0.96 };
  assert.equal(limitForModel('claude-sonnet-5-5', rate), rate);
  assert.equal(limitForModel('sonnet', rate), rate);
  for (const model of ['codex', 'gpt-4o', 'ollama', '']) assert.equal(limitForModel(model, rate), null);
});

test('separate usage summaries never invent Codex limits or use stale Claude reports', () => {
  const { providerSummaries } = require('../src/main/usage');
  const now = 100000000;
  const history = [{ ts: now - 1000, usage: { model: 'codex', in: 12, out: 3 } }, { ts: now - 2000, usage: { model: 'claude-sonnet-4', in: 4, out: 1 } }];
  const summary = providerSummaries(history, { type: 'five_hour', util: .4, ts: now - 1000 }, now);
  assert.equal(summary.claude.limit.util, .4);
  assert.deepEqual(summary.codex.last, { in: 12, out: 3, ts: now - 1000 });
  assert.equal(summary.codex.limit, null);
  assert.equal(providerSummaries(history, { util: .4, ts: now - 7 * 3600e3 }, now).claude.limit, null);
  assert.equal(providerSummaries(history, { util: 2, ts: now }, now).claude.limit, null);
});
