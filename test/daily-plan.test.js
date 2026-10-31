const test = require('node:test');
const assert = require('node:assert/strict');
const { planToday, closeDay } = require('../src/main/dailyPlan');

test('plan proposes at most three sourced priorities, with overdue reminders first', () => {
  const now = new Date('2026-10-30T10:00:00');
  const result = planToday({ now, due: [{ title: 'Essay' }, { title: 'Pay dues', overdue: true }], school: { assignments: [{ title: 'Essay', due: 'Friday' }, { title: 'Lab', due: 'Monday' }] }, events: [{ title: 'Meeting', start: new Date('2026-10-30T14:00:00') }], missing: ['mail'] });
  assert.match(result, /1\. Pay dues — Reminders, overdue/);
  assert.match(result, /2\. Essay — Reminders, due today/);
  assert.match(result, /3\. Lab — School, due Monday/);
  assert.doesNotMatch(result, /4\./);
  assert.match(result, /Sources unavailable or not configured: mail/);
});

test('school items with unambiguous dates are ordered by deadline without guessing other dates', () => {
  const text = planToday({ now: new Date(), school: { assignments: [
    { title: 'Unknown date', due: 'Friday' }, { title: 'Later', due: '2026-11-20' }, { title: 'Sooner', due: '2026-11-02' }, { title: 'Invalid', due: '2026-02-30' }
  ] } });
  assert.match(text, /1\. Sooner[\s\S]*2\. Later[\s\S]*3\. Unknown date/);
  assert.doesNotMatch(text, /4\./);
});

test('close of day uses recorded successes and unfinished requests without claiming unrelated work', () => {
  const now = new Date('2026-10-30T18:00:00');
  const text = closeDay({ facts: { now, due: [{ title: 'Essay' }], missing: ['mail'] }, actions: [{ ts: now.getTime(), tool: 'notes_create', ok: true }, { ts: now.getTime(), tool: 'gmail_send', ok: false }], history: [{ ts: now.getTime(), status: 'failed', text: 'Check the assignment' }] });
  assert.match(text, /Recorded successful Relay actions: created a note/);
  assert.doesNotMatch(text, /sent an email/);
  assert.match(text, /Requests not completed: Check the assignment/);
  assert.match(text, /Essay/);
  assert.match(text, /Tomorrow’s calendar was not checked/);
  assert.match(text, /Work outside Relay may not appear/);
});

test('close of day lists tomorrow events while identifying an unavailable calendar', () => {
  const now = new Date('2026-10-30T18:00:00');
  const text = closeDay({ facts: { now, tomorrow: { events: [{ title: 'Exam', start: new Date('2026-10-31T09:00:00') }], missing: ['Google calendar'] } } });
  assert.match(text, /Tomorrow’s calendar: Exam at/);
  assert.match(text, /Could not check tomorrow’s Google calendar/);
  assert.doesNotMatch(text, /No events were found/);
});

test('plan reports absent priorities and unavailable school without inventing tasks', () => {
  const result = planToday({ now: new Date(), due: [], events: [], school: { problem: 'Unavailable' }, missing: ['calendar'] });
  assert.match(result, /No priorities could be identified/);
  assert.match(result, /calendar, school/);
});

test('plan proposes reviewing a failed request without claiming it remains unresolved', () => {
  const text = planToday({ now: new Date(), unfinished: [{ text: 'Check the assignment', status: 'failed' }, { text: 'Already done', status: 'done' }] });
  assert.match(text, /Review: Check the assignment — Relay history, failed; check its latest status/);
  assert.doesNotMatch(text, /Already done/);
});

test('planning includes relevant user-stated context but never turns it into a task', () => {
  const text = planToday({ now: new Date(), memories: [{ text: 'I prefer to study after lunch' }, { text: 'I like cats' }, { text: 'My school password is fake' }] });
  assert.match(text, /Saved local context \(user-stated; check whether still current\): I prefer to study after lunch/);
  assert.match(text, /No priorities could be identified/);
  assert.doesNotMatch(text, /cats|password/);
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
  assert.equal((await pending).status, 'stopped');
  release({ now: new Date() });
  assert.equal(saves, 0);
  c.briefingFacts = async () => ({ now: new Date() });
  const failedActions = [];
  c.store = { addAction: (action) => failedActions.push(action) };
  c.outputExport = () => { throw new Error('disk unavailable'); };
  const result = await c.dailyPlanCommand();
  assert.equal(result.status, 'failed');
  assert.match(result.reply, /could not save/);
  assert.equal(failedActions[0].ok, false);
  assert.match(failedActions[0].result, /Could not save/);
  const actions = [];
  c.store = { addAction: (action) => actions.push(action) };
  c.outputExport = () => '/some/desktop/memory/plan.txt';
  const saved = await c.dailyPlanCommand(false, 'request-1');
  assert.equal(saved.status, 'done');
  assert.equal(actions[0].requestId, 'request-1');
  assert.match(actions[0].result, /Checked:/);
  assert.equal(actions[1].result, 'Saved to Desktop/memory/plan.txt');
  c.store.addAction = () => { throw new Error('log failed'); };
  assert.match((await c.dailyPlanCommand()).reply, /Saved locally.*could not record/s);
});
