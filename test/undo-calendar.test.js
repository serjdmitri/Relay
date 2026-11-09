const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const { createMac } = require('../src/main/agent/mac');
const { UndoRegistry } = require('../src/main/activity');

function rig() {
  const calls = [];
  const exec = async (cmd, args) => { calls.push(args); return args[0] === 'rem-add' ? 'REM-123\n' : args[0] === 'event-create' ? 'EVT-456\n' : ''; };
  return { calls, mac: createMac({ exec, calBin: '/x/relay-cal' }) };
}

test('a reminder or event Relay makes remembers its id, so exactly that one can be deleted again', async () => {
  const { mac, calls } = rig();
  assert.equal(mac.lastCreated, null);
  await mac.remindersAdd('milk', '', '');
  assert.deepEqual(mac.lastCreated, { kind: 'reminder', id: 'REM-123' });
  await mac.calendarCreate('Dentist', '2026-11-10T09:00', '');
  assert.deepEqual(mac.lastCreated, { kind: 'event', id: 'EVT-456' });
  await mac.calendarDeleteById('EVT-456'); await mac.remindersDeleteById('REM-123');
  assert.deepEqual(calls.slice(-2), [['event-delete', 'EVT-456'], ['rem-delete', 'REM-123']]);
});

test('without the native helper there is no id and no undo is offered', async () => {
  const mac = createMac({ exec: async () => '' });
  assert.equal(mac.lastCreated, null);
  await assert.rejects(mac.calendarDeleteById('x'), /native calendar helper/);
});

test('the activity log offers Undo for a new reminder and event, once, and the helper can delete events', async () => {
  const undos = new UndoRegistry(); const { mac, calls } = rig();
  await mac.calendarCreate('Dentist', '2026-11-10T09:00', '');
  const made = mac.lastCreated;
  undos.register('a1', () => mac.calendarDeleteById(made.id), 'Delete the event');
  assert.equal(undos.has('a1'), true);
  assert.deepEqual(await undos.run('a1'), { ok: true, message: 'Deleted the event.' });
  assert.equal((await undos.run('a1')).ok, false, 'only once');
  assert.deepEqual(calls.at(-1), ['event-delete', 'EVT-456']);
  const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  assert.match(read('src/main/askController.js'), /e\.name === 'reminders_add' \|\| e\.name === 'calendar_create'/);
  assert.match(read('native/relay-cal.swift'), /case "event-delete":/);
});
