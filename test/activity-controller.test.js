const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const real = Module._load;
Module._load = function (req, ...rest) { return req === 'electron' ? { app: {}, screen: {}, BrowserWindow: class {}, ipcMain: {}, Notification: class {}, systemPreferences: {}, desktopCapturer: {}, clipboard: {}, shell: {} } : real.call(this, req, ...rest); };
let AskController, UndoRegistry;
try { ({ AskController } = require('../src/main/askController')); ({ UndoRegistry } = require('../src/main/activity')); } finally { Module._load = real; }

test('presence locks before pausing music and reports lock failures', async () => {
  const events = [];
  const c = Object.create(AskController.prototype);
  Object.assign(c, {
    store: { get: () => ({ lock: true, pause: true }) },
    mac: { lockScreen: async () => { events.push('lock'); throw new Error('failed'); } },
    quick: async () => { events.push('pause'); return { reply: 'Paused music.' }; },
    notice: (_message, status) => events.push(status)
  });
  await c.presenceAway();
  assert.deepEqual(events, ['lock', 'failed', 'pause']);
  assert.equal(c.pausedByPresence, true);
});

test('an instant command that can be reversed gets an Undo in the log; one that cannot does not; using it records it', async () => {
  const added = [];
  const timers = { items: [], add(s) { const t = { id: `t${this.items.length}`, seconds: s }; this.items.push(t); return t; }, cancel(id) { this.items = this.items.filter((t) => t.id !== id); } };
  const c = Object.create(AskController.prototype);
  Object.assign(c, { store: { addAction: (a) => added.push(a) }, onChange() {}, undos: new UndoRegistry(), quickContext: () => ({ timers }) });
  const r = await c.quick('set a timer for 5 minutes', 'req1');
  assert.match(r.reply, /Timer set for 5 minutes/);
  assert.equal(timers.items.length, 1);
  const act = added.at(-1);
  assert.equal(act.tool, 'timer');
  assert.ok(c.undos.has(act.id), 'the timer can be undone');
  const t = await c.quick('what time is it', 'req2');
  assert.equal(t.readonly, true);
  assert.ok(!c.undos.has(added.at(-1).id), 'reading the time has nothing to undo');
  const res = await c.undoAction(act.id);
  assert.deepEqual(res, { ok: true, message: 'Cancelled the timer.' });
  assert.equal(timers.items.length, 0);
  assert.equal(added.at(-1).tool, 'undo', 'the undo is in the log too');
  assert.equal((await c.undoAction(act.id)).ok, false, 'once only');
});
