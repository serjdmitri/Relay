const test = require('node:test');
const assert = require('node:assert/strict');
const { Ladder, classify, REST } = require('../src/main/ladder');

test('classify tells quota from outage from a missing key, and ignores other errors', () => {
  assert.equal(classify({ status: 429 }), 'quota');
  assert.equal(classify(new Error('OpenAI says you are out of quota or going too fast.')), 'quota');
  assert.equal(classify({ status: 503 }), 'down');
  assert.equal(classify(new Error('Could not reach Gemini. Check your internet connection.')), 'down');
  assert.equal(classify(new Error('ElevenLabs rejected the key.')), 'missing');
  assert.equal(classify({ status: 404 }), 'missing');
  assert.equal(classify(new Error('something odd in my own code')), null);
});

test('a failed rung rests for the time its kind deserves, then comes back', () => {
  let t = 1000;
  const saved = [];
  const l = new Ladder({ now: () => t, save: (o) => saved.push(o) });
  assert.equal(l.pick(['gemini', 'system']), 'gemini');
  assert.equal(l.fail('gemini', { status: 429 }), 'quota');
  assert.equal(l.pick(['gemini', 'system']), 'system');
  t += REST.quota - 1;
  assert.equal(l.resting('gemini'), true);
  t += 2;
  assert.equal(l.resting('gemini'), false);
  assert.equal(l.fail('gemini', { status: 504 }), 'down');
  t += REST.quota + 1;
  assert.equal(l.resting('gemini'), true, 'an outage rests longer than a quota');
  assert.equal(l.fail('openai', { status: 404 }), 'missing');
  assert.ok(saved.length >= 2);
});

test('an error that is not a dependency problem does not rest anything; success clears a rest; the last rung is always offered', () => {
  const l = new Ladder({ now: () => 0 });
  assert.equal(l.fail('a', new Error('bad request body')), null);
  assert.equal(l.resting('a'), false);
  l.fail('a', { status: 503 });
  l.fail('b', { status: 503 });
  assert.equal(l.pick(['a', 'b']), 'b', 'when every rung rests the last is tried anyway');
  l.ok('a');
  assert.equal(l.pick(['a', 'b']), 'a');
  assert.deepEqual(l.report().map((r) => r.name), ['b']);
});

test('a restart remembers what was resting', () => {
  const l = new Ladder({ now: () => 5, load: () => ({ gemini: 99999 }) });
  assert.equal(l.resting('gemini'), true);
});
