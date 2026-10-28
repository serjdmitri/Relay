const test = require('node:test');
const assert = require('node:assert/strict');
const { DEFAULT_LISTS, parseChecklistCommand, Checklist, parseLogCommand, sheetIdFrom, stamp } = require('../src/main/robotics');

const names = Object.keys(DEFAULT_LISTS);
test('the phrases for checklists, and the control words only count while one is running', () => {
  const P = (t, active = false) => parseChecklistCommand(t, { names, active });
  assert.deepEqual(P('start the match day checklist'), { type: 'cl-start', name: 'match day' });
  assert.deepEqual(P("let's do the pit checklist"), { type: 'cl-start', name: 'between matches' });
  assert.deepEqual(P('run the pre-match checklist'), { type: 'cl-start', name: 'match day' });
  assert.deepEqual(P('go through the pack up checklist'), { type: 'cl-start', name: 'pack up' });
  assert.deepEqual(P('what checklists do I have'), { type: 'cl-list' });
  assert.deepEqual(P('show the match day checklist'), { type: 'cl-show', name: 'match day' });
  assert.deepEqual(P('add spare bumpers to the match day checklist'), { type: 'cl-add', name: 'match day', item: 'spare bumpers' });
  assert.deepEqual(P('add to the pit checklist: check the camera'), { type: 'cl-add', name: 'between matches', item: 'check the camera' });
  assert.deepEqual(P('remove spare battery from the match day checklist'), { type: 'cl-remove', name: 'match day', item: 'spare battery' });
  assert.equal(P('start the cooking checklist'), null, 'a list that does not exist');
  assert.equal(P('done'), null, 'not running');
  assert.deepEqual(P('done', true), { type: 'cl-control', op: 'done' });
  assert.deepEqual(P('Skip it.', true), { type: 'cl-control', op: 'skip' });
  assert.deepEqual(P('not yet', true), { type: 'cl-control', op: 'later' });
  assert.deepEqual(P("what's left", true), { type: 'cl-control', op: 'status' });
  assert.deepEqual(P('stop the checklist', true), { type: 'cl-control', op: 'stop' });
  assert.equal(P('what is the weather', true), null, 'other requests pass through while it runs');
});

test('a checklist goes item by item, can postpone, go back, and says what was skipped', () => {
  const c = new Checklist('Match day', ['Battery', 'Bumpers', 'Radio']);
  assert.equal(c.ask(), '1 of 3: Battery?');
  assert.equal(c.mark('done'), '2 of 3: Bumpers?');
  assert.equal(c.later(), '3 of 3: Radio?');
  assert.equal(c.mark('done'), 'Back to: Bumpers?');
  assert.match(c.later(), /last one/);
  assert.equal(c.back(), '3 of 3: Radio?', 'back reopens the one just done');
  assert.equal(c.status().split('.')[0], '1 done, 0 skipped, 2 to go');
  c.mark('done');
  assert.match(c.mark('skipped'), /Match day checklist finished: 2 of 3 done\. Skipped: bumpers\./);
  assert.equal(c.done, true);
  assert.match(c.logLine(), /^Match day checklist: finished: 2 of 3 done/);
  const s = new Checklist('Pit', ['a', 'b']);
  s.mark('done');
  assert.match(s.summary(), /stopped: 1 of 2 done\. Not reached: 1/);
});

test('the log phrases, and "log in" is not one', () => {
  const P = parseLogCommand;
  assert.deepEqual(P('log this'), { type: 'log-add', note: '' });
  assert.deepEqual(P('Log this: drifted left on the ramp.'), { type: 'log-add', note: 'drifted left on the ramp' });
  assert.deepEqual(P('log that battery 3 sagged to 10 volts'), { type: 'log-add', note: 'battery 3 sagged to 10 volts' });
  assert.deepEqual(P('add to the log: new bumpers on'), { type: 'log-add', note: 'new bumpers on' });
  const id = 'a'.repeat(44);
  assert.deepEqual(P(`set my log sheet to https://docs.google.com/spreadsheets/d/${id}/edit#gid=0`), { type: 'log-sheet', id });
  assert.deepEqual(P('use the sheet I copied as my log sheet'), { type: 'log-sheet', id: null, fromClipboard: true });
  assert.deepEqual(P('which sheet is my log'), { type: 'log-where' });
  for (const t of ['log in', 'log out of my account', 'log off', 'what is a log', 'open the log cabin']) assert.equal(P(t), null, t);
  assert.equal(sheetIdFrom(`https://docs.google.com/spreadsheets/d/${id}/edit`), id);
  assert.equal(sheetIdFrom('hello'), null);
  assert.equal(stamp(new Date(2026, 9, 28, 9, 5)), '2026-10-28 09:05');
});
