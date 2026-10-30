const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Store } = require('../src/main/store');
const { parseScheduleCommand, nextRun, describe, Scheduler, acknowledgeUnknown } = require('../src/main/schedule');

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

test('a user can acknowledge only an inactive uncertain scheduled run', () => {
  const store = memoryStore();
  store.data.history = [{ id: 'scheduled:a:1', status: 'unknown' }, { id: 'other', status: 'unknown' }, { id: 'scheduled:b:1', status: 'done' }];
  store.updateHistory = (id, patch) => Object.assign(store.data.history.find((h) => h.id === id), patch);
  assert.equal(acknowledgeUnknown(store, 'scheduled:a:1', 'scheduled:a:1'), false);
  assert.equal(acknowledgeUnknown(store, 'other', null), false);
  assert.equal(acknowledgeUnknown(store, 'scheduled:b:1', null), false);
  assert.equal(acknowledgeUnknown(store, 'scheduled:a:1', null), true);
  assert.equal(store.data.history[0].status, 'resolved');
  assert.match(store.data.history[0].reply, /not verified/);
  assert.equal(acknowledgeUnknown(store, 'scheduled:a:1', null), false);
});

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

test('an unlock check records overdue work without starting a newly due task', () => {
  let clock = new Date(2026, 9, 26, 7, 0);
  const sch = new Scheduler({ store: memoryStore(), now: () => clock });
  sch.add({ text: 'missed', repeat: 'once', at: new Date(2026, 9, 26, 8, 0).getTime() }, { id: 'old' });
  sch.add({ text: 'due', repeat: 'once', at: new Date(2026, 9, 26, 9, 0).getTime() }, { id: 'new' });
  clock = new Date(2026, 9, 26, 9, 1);
  const result = sch.tick(false);
  assert.deepEqual(result.missed.map(s => s.id), ['old']);
  assert.deepEqual(result.due, []);
  assert.deepEqual(sch.items.map(s => s.id), ['new']);
});

test('dispatch durably records an uncertain outcome before handing off a one-time job', () => {
  let clock = new Date(2026, 9, 26, 10, 0);
  const store = memoryStore();
  let persisted;
  store.flush = () => { persisted = JSON.parse(JSON.stringify(store.data)); };
  const sch = new Scheduler({ store, now: () => clock });
  sch.add({ text: 'send a report', repeat: 'once', at: new Date(2026, 9, 26, 10, 5).getTime() }, { id: 'once' });
  clock = new Date(2026, 9, 26, 10, 5);
  const result = sch.tick();
  assert.equal(persisted.schedules.length, 0);
  assert.equal(persisted.history[0].status, 'unknown');
  assert.equal(persisted.history[0].id, result.due[0].runId);
  const recovered = new Scheduler({ store: { data: persisted, get: (key) => persisted[key], save() {} }, now: () => clock });
  assert.deepEqual(recovered.tick().due, [], 'restart never blindly repeats an uncertain action');
});

test('missed work and schedule advancement survive a restart in the same saved snapshot', () => {
  let clock = new Date(2026, 9, 26, 7, 0);
  const store = memoryStore();
  let persisted;
  store.flush = () => { persisted = JSON.parse(JSON.stringify(store.data)); };
  const sch = new Scheduler({ store, now: () => clock });
  sch.add({ text: 'check homework', repeat: 'once', at: new Date(2026, 9, 26, 8, 0).getTime() }, { id: 'missed' });
  clock = new Date(2026, 9, 26, 10, 0);
  assert.equal(sch.tick(false).missed.length, 1);
  assert.deepEqual(persisted.schedules, []);
  assert.equal(persisted.history[0].status, 'missed');
  assert.match(persisted.history[0].reply, /Schedule it again/);
  const recovered = new Scheduler({ store: { data: persisted, get: (key) => persisted[key], save() {} }, now: () => clock });
  assert.deepEqual(recovered.tick(false).missed, [], 'restart does not duplicate the missed occurrence');
  assert.equal(persisted.history.length, 1);
});

test('a scheduled run is saved on disk before dispatch and is not repeated after restart', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-schedule-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  let clock = new Date(2026, 9, 26, 10, 0);
  const store = new Store(dir);
  const scheduler = new Scheduler({ store, now: () => clock });
  scheduler.add({ text: 'check assignments', repeat: 'once', at: new Date(2026, 9, 26, 10, 5).getTime() }, { id: 'homework' });
  clock = new Date(2026, 9, 26, 10, 5);
  const dispatched = scheduler.tick().due[0];
  const restarted = new Store(dir);
  assert.equal(restarted.get('history')[0].id, dispatched.runId);
  assert.equal(restarted.get('history')[0].status, 'unknown');
  assert.deepEqual(new Scheduler({ store: restarted, now: () => clock }).tick().due, []);
});

test('a failed disk write keeps scheduled work pending for a later retry', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-schedule-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  let clock = new Date(2026, 9, 26, 10, 0);
  const store = new Store(dir);
  const scheduler = new Scheduler({ store, now: () => clock });
  scheduler.add({ text: 'check assignments', repeat: 'once', at: new Date(2026, 9, 26, 10, 5).getTime() }, { id: 'homework' });
  store.flush();
  clock = new Date(2026, 9, 26, 10, 5);
  const flush = store.flush.bind(store);
  store.flush = () => { throw new Error('disk unavailable'); };
  assert.throws(() => scheduler.tick(), /disk unavailable/);
  assert.equal(store.get('schedules').length, 1);
  assert.deepEqual(store.get('history'), []);
  assert.equal(new Store(dir).get('schedules').length, 1);
  store.flush = flush;
  assert.equal(scheduler.tick().due.length, 1);
  assert.equal(new Store(dir).get('history')[0].status, 'unknown');
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
