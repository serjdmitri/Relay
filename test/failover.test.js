const test = require('node:test');
const assert = require('node:assert/strict');
const { Failover, isLimitText, parseResetAt, DEFAULT_WAIT, MIN_WAIT, MAX_WAIT } = require('../src/main/failover');

test('usage limits are recognised, other failures are not', () => {
  for (const t of ['Claude AI usage limit reached|1761651600', "You've hit your limit · resets 3pm", 'You have hit your usage limit. Try again at 4:10 PM.', '429 Too Many Requests', 'rate_limit_error: exceeded your current quota', 'Weekly limit reached']) assert.equal(isLimitText(t), true, t);
  for (const t of ['Relay is not signed in to Claude. Open Account and sign in.', 'ECONNRESET', 'Claude could not reach Relay\'s tools.', 'The tool failed: file not found', '']) assert.equal(isLimitText(t), false, t);
});

test('the reset time is read from the words, as the next time that clock shows', () => {
  const now = new Date(2026, 9, 28, 14, 0).getTime();
  assert.equal(parseResetAt('Claude AI usage limit reached|1761651600', now), 1761651600000);
  assert.deepEqual(new Date(parseResetAt("You've hit your limit · resets 3pm", now)), new Date(2026, 9, 28, 15, 0));
  assert.deepEqual(new Date(parseResetAt('hit your usage limit. try again at 4:10 PM', now)), new Date(2026, 9, 28, 16, 10));
  assert.deepEqual(new Date(parseResetAt('limit reached, resets 9am', now)), new Date(2026, 9, 29, 9, 0), 'already past today: tomorrow');
  assert.equal(parseResetAt('try again in 2 hours 10 minutes', now), now + (2 * 60 + 10) * 60e3);
  assert.equal(parseResetAt('come back in 3 days', now), now + 3 * 864e5);
  assert.equal(parseResetAt('something broke', now), null);
});

test('the failover sends requests to Codex until the reset, then back to Claude, and remembers across a restart', () => {
  let t = 1_761_000_000_000; let saved = 0;
  const f = new Failover({ now: () => t, save: (v) => { saved = v; } });
  assert.equal(f.route(), 'claude');
  assert.equal(f.trip({ text: 'resets in 1 hour' }), t + 3600e3);
  assert.equal(saved, t + 3600e3);
  assert.equal(f.route(), 'codex');
  t += 3599e3; assert.equal(f.route(), 'codex');
  t += 2e3; assert.equal(f.route(), 'claude', 'the limit has reset: Claude is tried again');
  assert.equal(new Failover({ now: () => t, load: () => saved }).until, saved, 'loaded after a restart');
  // limits with no time, a time in the past, seconds from the CLI, and silly values
  assert.equal(f.trip({ text: 'usage limit reached' }), t + DEFAULT_WAIT);
  assert.equal(f.trip({ resetsAt: Math.floor((t + 5 * 3600e3) / 1000) }), Math.floor((t + 5 * 3600e3) / 1000) * 1000, 'seconds are turned into ms');
  assert.equal(f.trip({ resetsAt: t - 5 }), t + DEFAULT_WAIT);
  assert.equal(f.trip({ resetsAt: t + 1000 }), t + MIN_WAIT, 'never retried sooner than a couple of minutes');
  assert.equal(f.trip({ text: 'resets in 99 days' }), t + MAX_WAIT);
  f.clear();
  assert.equal(f.route(), 'claude');
  assert.equal(saved, 0);
});

test('a result is a limit when the plan says rejected or the words say so, and a good or stopped one never is', () => {
  const f = new Failover();
  assert.equal(f.isLimit({ status: 'failed', reply: "You've hit your limit · resets 3pm" }), true);
  assert.equal(f.isLimit({ status: 'failed', reply: 'Claude did not answer.' }, { status: 'rejected' }), true);
  assert.equal(f.isLimit({ status: 'failed', reply: 'Claude did not answer.' }, { status: 'allowed' }), false);
  assert.equal(f.isLimit({ status: 'done', reply: 'The rate limit on that API is 100 per minute.' }), false, 'an answer that mentions limits');
  assert.equal(f.isLimit({ status: 'stopped', reply: 'Stopped.' }), false);
  assert.equal(f.isLimit(null), false);
});
