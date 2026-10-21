const test = require('node:test');
const assert = require('node:assert/strict');
const { routeModel } = require('../src/main/agent/router');

test('short single-step requests start on Haiku and may move up', () => {
  for (const t of ['open notes', "what's the weather today", 'how many apps do I have open', 'open notes and make a note called groceries', "text Sam I'm running late", "what's on my calendar today"]) {
    assert.deepEqual(routeModel(t, 'auto'), { model: 'haiku', escalate: true }, t);
  }
});

test('writing, planning and multi-step requests start on Sonnet', () => {
  for (const t of ['Summarize my unread emails and draft replies', 'schedule a meeting with Sam on Thursday at 3pm about the roadmap', 'organize my downloads folder by file type', 'find out why my wifi is slow and fix it']) {
    assert.deepEqual(routeModel(t, 'auto'), { model: 'sonnet', escalate: false }, t);
  }
});

test('a model picked by hand is always used, and never changed', () => {
  assert.deepEqual(routeModel('open notes', 'opus'), { model: 'opus', escalate: false });
  assert.deepEqual(routeModel('summarize everything', 'haiku'), { model: 'haiku', escalate: false });
  assert.deepEqual(routeModel('open notes'), { model: 'haiku', escalate: true });
});
