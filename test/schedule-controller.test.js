const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const real = Module._load;
Module._load = function (req, ...rest) { return req === 'electron' ? { app: {}, screen: {}, BrowserWindow: class {}, ipcMain: {}, Notification: class {}, systemPreferences: {}, desktopCapturer: {}, clipboard: {}, shell: {} } : real.call(this, req, ...rest); };
let AskController, Scheduler, parseScheduleCommand;
try { ({ AskController } = require('../src/main/askController')); ({ Scheduler, parseScheduleCommand } = require('../src/main/schedule')); } finally { Module._load = real; }

function make(confirm = true) {
  const data = { schedules: [] };
  const store = { data, get: (k) => data[k], save() {} };
  const c = Object.create(AskController.prototype);
  Object.assign(c, { store, onChange() {}, askConfirm: async () => confirm, scheduler: new Scheduler({ store, now: () => new Date(2026, 9, 26, 10, 0) }), tasks: [], queue: [], runningTask: null, _state: 'idle' });
  return { c, data };
}

test('a spoken schedule is saved, listed and cancelled without the model', async () => {
  const { c, data } = make();
  const r = await c.runSchedule(parseScheduleCommand('every weekday at 8am open my email', new Date(2026, 9, 26, 10, 0)));
  assert.match(r.reply, /Scheduled: open my email\. Every weekday at 8:00 AM/);
  assert.equal(data.schedules.length, 1);
  assert.match((await c.runSchedule({ type: 'schedule-list' })).reply, /open my email/);
  assert.match((await c.runSchedule({ type: 'schedule-cancel', query: 'email' })).reply, /Cancelled "open my email"/);
  assert.equal(data.schedules.length, 0);
});

test('the model path validates its fields and cancel-all asks first', async () => {
  const { c, data } = make(false);
  assert.match(c.scheduleTask({ task: 'x task', repeat: 'daily', time: '8am' }), /time like 08:00/);
  assert.match(c.scheduleTask({ task: 'x task', repeat: 'weekly', time: '08:00', days: [] }), /needs days/);
  assert.match(c.scheduleTask({ task: 'check news', repeat: 'weekly', time: '07:30', days: ['Monday', 'friday'] }), /Every Monday, Friday at 7:30 AM/);
  const once = c.scheduleTask({ task: 'say hi', repeat: 'once', time: '09:00' }); // 9:00 has passed at 10:00, so tomorrow
  assert.match(once, /Scheduled: say hi/);
  assert.equal(data.schedules.length, 2);
  assert.match((await c.runSchedule({ type: 'schedule-cancel-all' })).reply, /kept/);
  c.askConfirm = async () => true;
  await c.runSchedule({ type: 'schedule-cancel-all' });
  assert.equal(data.schedules.length, 0);
});

test('a scheduled request only runs when Relay is free', () => {
  const { c } = make();
  assert.equal(c.canRunScheduled(), true);
  c.runningTask = { id: 'x' };
  assert.equal(c.canRunScheduled(), false);
  c.runningTask = null;
  c._state = 'listening';
  assert.equal(c.canRunScheduled(), false);
});
