const test = require('node:test');
const assert = require('node:assert/strict');
const { parseSavedSetup } = require('../src/main/layouts');

test('short workspace requests match only saved names', () => {
  assert.deepEqual(parseSavedSetup('Jarvis, set up robotics', [], [{ name: 'Robotics' }]), { type: 'layout-restore', name: 'Robotics' });
  assert.deepEqual(parseSavedSetup('start robotics', [{ name: 'Robotics' }], [{ name: 'Robotics' }]), { type: 'mode-start', name: 'Robotics' });
  assert.equal(parseSavedSetup('set up a meeting', [], [{ name: 'Robotics' }]), null);
});
