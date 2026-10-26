const { test } = require('node:test');
const assert = require('node:assert/strict');
const { corrections, noteCorrection } = require('../src/main/learn');

test('a fixed word is a correction, wherever the text sits in the field', () => {
  const typed = 'we should deploy it with cooper nettie and then check the logs';
  const after = 'Notes from today.\nwe should deploy it with Kubernetes and then check the logs\nMore below';
  assert.deepEqual(corrections(typed, after), [{ from: 'cooper nettie', to: 'Kubernetes' }]);
});

test('a single word swap, and a case fix', () => {
  assert.deepEqual(corrections('send it to sergei about the plan', 'send it to Sergey about the plan'), [{ from: 'sergei', to: 'Sergey' }]);
  assert.deepEqual(corrections('open the github repo for me now', 'open the GitHub repo for me now'), [{ from: 'github', to: 'GitHub' }]);
});

test('rewrites, additions and untouched text teach nothing', () => {
  const typed = 'please send the report to the team before lunch today';
  assert.deepEqual(corrections(typed, typed), []);
  assert.deepEqual(corrections(typed, 'please send the report to the team before lunch today and thanks'), []);
  assert.deepEqual(corrections(typed, 'please send the quarterly numbers over to everyone well before lunch today'), []);
  assert.deepEqual(corrections(typed, 'something else entirely'), []);
});

test('a correction is learned on its second sighting', () => {
  const counts = {};
  assert.equal(noteCorrection(counts, { from: 'sergei', to: 'Sergey' }), null);
  assert.deepEqual(noteCorrection(counts, { from: 'Sergei', to: 'Sergey' }), { from: 'sergei', to: 'Sergey' });
  assert.deepEqual(counts, {});
});
