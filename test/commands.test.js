const test = require('node:test');
const assert = require('node:assert/strict');
const { parseCommand, normalize, splitSteps } = require('../src/main/commands');

const routines = [{ id: '1', name: 'Start my day', steps: ['Open Calendar'] }];

test('normalize strips Talkify punctuation and wake word', () => {
  assert.equal(normalize('Hey Relay, open Notes.'), 'open notes');
  assert.equal(normalize('  Please   show me my Downloads folder! '), 'show me my downloads folder');
});

test('routine runs by exact or "run" phrasing', () => {
  assert.equal(parseCommand('Start my day.', routines).type, 'routine-run');
  assert.equal(parseCommand('run start my day', routines).type, 'routine-run');
  assert.equal(parseCommand('start my dayy', routines).type, 'agent');
});

test('recording commands', () => {
  assert.equal(parseCommand('Start a routine.', routines).type, 'routine-start');
  const s = parseCommand('Save it as focus mode.', routines, { recording: true });
  assert.deepEqual([s.type, s.name, s.source], ['routine-save', 'focus mode', 'recording']);
  assert.equal(parseCommand('save that as lunch', routines).source, 'last');
});

test('inline routine definition', () => {
  const c = parseCommand('When I say start my day, open Calendar and tell me the weather.', []);
  assert.equal(c.type, 'routine-inline');
  assert.equal(c.name, 'start my day');
  assert.deepEqual(c.steps, ['open Calendar', 'tell me the weather']);
});

test('plain request goes to the agent unchanged', () => {
  assert.deepEqual(parseCommand('What apps do I have open?', routines), { type: 'agent', text: 'What apps do I have open?' });
  assert.equal(parseCommand('   ', routines).type, 'empty');
});

test('splitSteps', () => {
  assert.deepEqual(splitSteps('open notes, then open mail'), ['open notes', 'open mail']);
});

// ---- remembering a task under a name
test('remember, learn and keep work like save, and forget removes a saved task by name', () => {
  const { parseCommand } = require('../src/main/commands');
  const routines = [{ id: '1', name: 'Morning setup', steps: ['open mail'] }];
  for (const phrase of ['Remember this as morning setup', 'learn that as Morning Setup.', 'Save it as morning setup', 'keep this as morning setup']) {
    assert.deepEqual(parseCommand(phrase, routines), { type: 'routine-save', name: phrase.toLowerCase().replace(/[.]/g, '').replace(/^.*? as /, ''), source: 'last' }, phrase);
  }
  assert.equal(parseCommand('Forget morning setup', routines).type, 'routine-delete');
  assert.equal(parseCommand('delete the routine morning setup', routines).routine.id, '1');
  assert.equal(parseCommand('forget my morning setup task', routines).type, 'routine-delete');
  assert.equal(parseCommand('forget about the meeting', routines).type, 'agent', 'not a saved name: left for the model');
  assert.equal(parseCommand('run morning setup', routines).type, 'routine-run');
});
