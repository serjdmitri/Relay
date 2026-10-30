const test = require('node:test');
const assert = require('node:assert/strict');
const { planToday } = require('../src/main/dailyPlan');

test('plan proposes at most three sourced priorities, with overdue reminders first', () => {
  const now = new Date('2026-10-30T10:00:00');
  const result = planToday({ now, due: [{ title: 'Essay' }, { title: 'Pay dues', overdue: true }], school: { assignments: [{ title: 'Essay', due: 'Friday' }, { title: 'Lab', due: 'Monday' }] }, events: [{ title: 'Meeting', start: new Date('2026-10-30T14:00:00') }], missing: ['mail'] });
  assert.match(result, /1\. Pay dues — Reminders, overdue/);
  assert.match(result, /2\. Essay — Reminders, due today/);
  assert.match(result, /3\. Lab — School, due Monday/);
  assert.doesNotMatch(result, /4\./);
  assert.match(result, /Sources unavailable or not configured: mail/);
});

test('plan reports absent priorities and unavailable school without inventing tasks', () => {
  const result = planToday({ now: new Date(), due: [], events: [], school: { problem: 'Unavailable' }, missing: ['calendar'] });
  assert.match(result, /No priorities could be identified/);
  assert.match(result, /calendar, school/);
});

test('stopping an in-flight plan prevents saving and save errors are reported', async () => {
  const Module = require('node:module');
  const original = Module._load;
  Module._load = function (name, ...args) { return name === 'electron' ? { app: {}, screen: {}, BrowserWindow: class {}, ipcMain: {}, Notification: class {}, systemPreferences: {}, desktopCapturer: {}, clipboard: {}, shell: {}, safeStorage: {} } : original.call(this, name, ...args); };
  let AskController;
  try { ({ AskController } = require('../src/main/askController')); } finally { Module._load = original; }
  const c = Object.create(AskController.prototype);
  let release, saves = 0;
  c.briefingFacts = () => new Promise((resolve) => { release = resolve; });
  c.outputExport = () => saves++;
  const pending = c.dailyPlanCommand();
  c.abort.abort();
  release({ now: new Date() });
  assert.equal((await pending).status, 'stopped');
  assert.equal(saves, 0);
  c.briefingFacts = async () => ({ now: new Date() });
  c.outputExport = () => { throw new Error('disk unavailable'); };
  const result = await c.dailyPlanCommand();
  assert.equal(result.status, 'failed');
  assert.match(result.reply, /could not save/);
});
