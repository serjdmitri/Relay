const test = require('node:test');
const assert = require('node:assert/strict');
const { parseWorkMode, workStyle } = require('../src/main/workModes');
const { parseDebate, debatePrompt } = require('../src/main/debate');
test('work modes use an explicit command and fall back to personal', () => {
  assert.equal(parseWorkMode('set work mode to coding'), 'coding');
  assert.equal(parseWorkMode('focus mode'), null);
  assert.match(workStyle('coding'), /coding/i);
  assert.equal(workStyle('unknown'), workStyle('personal'));
});
test('debate prompts disclose simulated perspectives and preserve the topic', () => {
  const topic = parseDebate('debate whether to change jobs');
  assert.equal(topic, 'whether to change jobs');
  assert.match(debatePrompt(topic), /simulated perspectives/);
  assert.match(debatePrompt(topic), /whether to change jobs/);
  assert.equal(parseDebate('what is a debate'), null);
});
