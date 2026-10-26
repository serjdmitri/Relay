const test = require('node:test');
const assert = require('node:assert/strict');
const { learnFrom, describeStep, REPLAYABLE, READ_ONLY } = require('../src/main/learned');

test('learnFrom keeps the repeatable actions in order and leaves out looking around', () => {
  const calls = [
    { tool: 'list_running_apps', input: {}, ok: true },
    { tool: 'open_app', input: { name: 'Notes' }, ok: true },
    { tool: 'screenshot', input: {}, ok: true },
    { tool: 'notes_create', input: { title: 'Plan', body: 'x' }, ok: true },
    { tool: 'press_keys', input: { keys: 'cmd+s' }, ok: false }, // a failed try is not part of the recipe
    { tool: 'press_keys', input: { keys: 'cmd+shift+s' }, ok: true }
  ];
  assert.deepEqual(learnFrom(calls), [
    { tool: 'open_app', input: { name: 'Notes' } },
    { tool: 'notes_create', input: { title: 'Plan', body: 'x' } },
    { tool: 'press_keys', input: { keys: 'cmd+shift+s' } }
  ]);
});

test('anything that depends on what was on screen cannot be learned, and neither can doing nothing', () => {
  assert.equal(learnFrom([{ tool: 'open_app', input: { name: 'A' }, ok: true }, { tool: 'click', input: { x: 5, y: 5 }, ok: true }]), null);
  assert.equal(learnFrom([{ tool: 'scroll', input: { amount: -5 }, ok: true }]), null);
  assert.equal(learnFrom([{ tool: 'web_search', input: { query: 'x' }, ok: true }]), null, 'only looking');
  assert.equal(learnFrom([]), null);
  assert.equal(learnFrom(null), null);
  assert.equal(learnFrom([{ tool: 'open_app', input: {}, ok: false }]), null);
});

test('a tool is never both replayable and read-only, and every learned tool is a real one', () => {
  for (const t of REPLAYABLE) assert.ok(!READ_ONLY.has(t), t);
  const { buildTools } = require('../src/main/agent/tools');
  const names = new Set(buildTools({ mac: {}, firefox: { isConnected: () => true }, overlay: null, getScale: () => 1 }).map((t) => t.name));
  for (const t of REPLAYABLE) assert.ok(names.has(t), `${t} is not a tool`);
});

test('describeStep gives a short phrase', () => {
  assert.equal(describeStep({ tool: 'open_app', input: { name: 'Notes' } }), 'open app: Notes');
  assert.equal(describeStep({ tool: 'toggle_dark_mode', input: {} }), 'toggle dark mode');
});
