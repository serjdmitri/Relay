const test = require('node:test');
const assert = require('node:assert/strict');
const { isRetry, isAgain, parseModelCommand } = require('../src/main/meta');

test('"try again" is a retry on a stronger model, "again" stays a plain repeat', () => {
  for (const t of ['Try again.', 'try it again', 'try again with a smarter model', 'think harder', "that's wrong", 'That did not work, try again']) assert.equal(isRetry(t), true, t);
  assert.equal(isAgain('do it again'), true);
  assert.equal(isAgain('try it again'), false);
  assert.equal(isRetry('open notes'), false);
});

test('model speed can be changed by voice', () => {
  assert.equal(parseModelCommand('use the fast model'), 'haiku');
  assert.equal(parseModelCommand('Switch to smarter mode'), 'sonnet');
  assert.equal(parseModelCommand('use deep'), 'opus');
  assert.equal(parseModelCommand('go to auto'), 'auto');
  assert.equal(parseModelCommand('use Spotify'), null);
  assert.equal(parseModelCommand('use the best model'), 'opus');
});
