const test = require('node:test');
const assert = require('node:assert/strict');
const { isProjectDashboard, projectCard } = require('../src/main/projectDashboard');

test('project dashboard uses recorded request status and does not invent next steps', () => {
  assert.equal(isProjectDashboard('Hey Jarvis, show me my project dashboard'), true);
  assert.equal(isProjectDashboard('finish my robotics project'), false);
  const card = projectCard([{ text: 'Fix robotics code', status: 'failed' }], [{ text: 'Review robotics design', status: 'queued' }]);
  assert.match(card.items[1].subtitle, /failed: Fix robotics code/);
  assert.match(card.items[1].note, /Queued: Review robotics design/);
  assert.match(card.items[0].subtitle, /No matching/);
  assert.match(card.items[2].note, /No matching request queued/);
});
