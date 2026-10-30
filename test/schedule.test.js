const test = require('node:test');
const assert = require('node:assert/strict');
const { parseScheduleCommand, nextRun, describe, Scheduler } = require('../src/main/schedule');

const add = (t, now) => parseScheduleCommand(t, now || new Date(2026, 9, 26, 10, 0));

test('repeating schedules are understood the way people say them', () => {
  assert.deepEqual(add('Every weekday at 8am, open my email.'), { type: 'schedule-add', text: 'open my email', repeat: 'weekdays', hour: 8, minute: 0, days: [] });
  assert.deepEqual(add('every day at 6:30 pm check the weather'), { type: 'schedule-add', text: 'check the weather', repeat: 'daily', hour: 18, minute: 30, days: [] });
  assert.deepEqual(add('open Spotify and play focus music every monday and thursday at 9'), { type: 'schedule-add', text: 'open spotify and play focus music', repeat: 'weekly', hour: 9, minute: 0, days: [1, 4] });
  assert.deepEqual(add('every morning, read me my calendar'), { type: 'schedule-add', text: 'read me my calendar', repeat: 'daily', hour: 8, minute: 0, days: [] });
  assert.equal(add('every weekend at 10 am clean up my downloads').repeat, 'weekends');
  assert.equal(add('on weekdays at 5 turn on dark mode').hour, 17); // 5 with no am or pm is the evening
  assert.equal(add('every weekday at 8 open my email').hour, 8);
});

test('a single later run needs the word schedule', () => {
  const now = new Date(2026, 9, 26, 10, 0);
  const r = add('schedule open my email for tomorrow at 7am', now);
  assert.equal(r.type, 'schedule-add');
  assert.equal(r.repeat, 'once');
  assert.equal(r.text, 'open my email');
  assert.equal(new Date(r.at).getDate(), 27);
  assert.equal(new Date(r.at).getHours(), 7);
  assert.equal(add('open my email at 7am', now), null); // that is a plain request, not a schedule
});

test('reminders, questions and plain requests are not schedules', () => {
  for (const t of ['remind me every day at 8 to take my pills', 'open Notes', 'every', 'what time is it', 'set a timer for 5 minutes', 'every weekday open my email']) assert.equal(add(t), null, t); // the last has no time: Relay asks
});

test('listing and cancelling are understood', () => {
  assert.deepEqual(add("what's scheduled"), { type: 'schedule-list' });
  assert.deepEqual(add('what do I have scheduled?'), { type: 'schedule-list' });
  assert.deepEqual(add('cancel the email schedule'), { type: 'schedule-cancel', query: 'email' });
  assert.deepEqual(add('cancel all my schedules'), { type: 'schedule-cancel-all' });
  assert.equal(add('cancel that'), null);
});

test('the next run skips the wrong days', () => {
  const fri = new Date(2026, 9, 30, 9, 0); // a Friday, after 8
  const wk = { repeat: 'weekdays', hour: 8, minute: 0 };
  assert.equal(new Date(nextRun(wk, fri)).getDay(), 1); // Monday
  assert.equal(new Date(nextRun({ repeat: 'daily', hour: 10, minute: 0 }, fri)).getDate(), 30);
  assert.equal(new Date(nextRun({ repeat: 'weekly', days: [4], hour: 9, minute: 0 }, fri)).getDay(), 4);
  assert.equal(nextRun({ repeat: 'once', at: fri.getTime() - 1 }, fri), null);
});

test('descriptions read naturally', () => {
  assert.equal(describe({ repeat: 'weekdays', hour: 8, minute: 0 }), 'Every weekday at 8:00 AM');
  assert.equal(describe({ repeat: 'weekly', days: [1, 4], hour: 18, minute: 30 }), 'Every Monday, Thursday at 6:30 PM');
});

function memoryStore() {
  const data = { schedules: [] };
  return { data, get: (k) => data[k], save() {} };
}

test('the scheduler runs what is due once, moves on, and skips what was missed', () => {
  let clock = new Date(2026, 9, 26, 7, 59);
  const store = memoryStore();
  const sch = new Scheduler({ store, now: () => clock });
  const s = sch.add({ text: 'open my email', repeat: 'weekdays', hour: 8, minute: 0 }, { id: 'a' });
  assert.equal(new Date(s.next).getHours(), 8);
  assert.deepEqual(sch.tick(), { due: [], missed: [] });
  clock = new Date(2026, 9, 26, 8, 0, 20);
  assert.deepEqual(sch.tick().due.map((x) => x.id), ['a']);
  assert.deepEqual(sch.tick().due, []); // not twice
  assert.equal(new Date(sch.items[0].next).getDate(), 27); // tomorrow
  clock = new Date(2026, 9, 28, 12, 0); // asleep through the 8:00 of the 27th and 28th
  const r = sch.tick();
  assert.deepEqual(r.due, []);
  assert.equal(r.missed.length, 1);
  assert.equal(new Date(sch.items[0].next).getDate(), 29);
});

test('a busy Relay leaves what is due for the next tick, and a one-time schedule goes away', () => {
  let clock = new Date(2026, 9, 26, 10, 0);
  const sch = new Scheduler({ store: memoryStore(), now: () => clock });
  sch.add({ text: 'x task', repeat: 'once', at: new Date(2026, 9, 26, 10, 5).getTime() }, { id: 'o' });
  clock = new Date(2026, 9, 26, 10, 6);
  assert.deepEqual(sch.tick(false).due, []);
  assert.equal(sch.items.length, 1);
  assert.deepEqual(sch.tick(true).due.map((x) => x.id), ['o']);
  assert.equal(sch.items.length, 0);
});

test('simultaneous scheduled jobs remain saved until each can be started', () => {
  let clock = new Date(2026, 9, 26, 10, 0);
  const store = memoryStore();
  const sch = new Scheduler({ store, now: () => clock });
  for (const id of ['a', 'b']) sch.add({ text: id, repeat: 'once', at: new Date(2026, 9, 26, 10, 5).getTime() }, { id });
  clock = new Date(2026, 9, 26, 10, 6);
  assert.deepEqual(sch.tick(true).due.map(s => s.id), ['a']);
  assert.deepEqual(sch.items.map(s => s.id), ['b']);
  assert.deepEqual(sch.tick(false).due, []);
  const restarted = new Scheduler({ store, now: () => clock });
  assert.deepEqual(restarted.tick(true).due.map(s => s.id), ['b']);
});

test('schedules can be removed by words, turned off, and cleared', () => {
  const sch = new Scheduler({ store: memoryStore(), now: () => new Date(2026, 9, 26, 7, 0) });
  sch.add({ text: 'open my email', repeat: 'daily', hour: 8, minute: 0 }, { id: 'a' });
  sch.add({ text: 'check the weather', repeat: 'daily', hour: 9, minute: 0 }, { id: 'b' });
  sch.setEnabled('a', false);
  assert.equal(sch.items[0].enabled, false);
  assert.deepEqual(sch.remove('weather').map((s) => s.id), ['b']);
  sch.clear();
  assert.equal(sch.items.length, 0);
});
