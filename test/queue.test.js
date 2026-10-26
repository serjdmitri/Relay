const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const real = Module._load;
Module._load = function (req, ...rest) { return req === 'electron' ? { app: {}, screen: { getPrimaryDisplay: () => ({}) }, BrowserWindow: class {}, ipcMain: {}, Notification: class {}, systemPreferences: {}, desktopCapturer: {}, clipboard: {}, shell: {} } : real.call(this, req, ...rest); };
let AskController;
try { ({ AskController } = require('../src/main/askController')); } finally { Module._load = real; }

// A controller with just enough around it: runRequest takes as long as the test lets it.
function make() {
  const c = Object.create(AskController.prototype);
  const pushes = [];
  const gates = [];
  Object.assign(c, {
    _state: 'idle', tasks: [], queue: [], runningTask: null, pendingFinish: null,
    store: { get: (k) => (k === 'routines' ? [] : k === 'settings.speakReplies' ? false : k === 'settings.playSounds' ? false : null), addHistory() {}, set() {} },
    overlay: { beginRequest() {}, endRequest() {}, buddy() {}, workDone() {}, hud: (m) => pushes.push(m), hide() {} },
    ducker: { restore() {} }, guide: { command: () => null }, speaker: null, onChange() {}, onState() {}, wakeSoon() {},
    win: { setFocusable() {}, isDestroyed: () => false }, ensureWindow() { return this.win; }, passiveUI: () => true,
    sound() {}, reveal(extra) { pushes.push(this.captionState(extra)); }, captionState(extra) { return { state: this.state, tasks: this.taskList(), ...extra }; },
    tryQuick: async () => null, close() { this.state = 'idle'; if (!this.runningTask) { this.tasks = []; this.queue = []; } },
    ran: [],
    runRequest(text, entry) { this.ran.push(text); return new Promise((resolve) => gates.push(() => resolve(this.finish(entry, { status: 'done', reply: `did ${text}` })))); }
  });
  c.pushes = pushes;
  c.release = async () => { gates.shift()(); await new Promise((r) => setImmediate(r)); };
  return c;
}
const statuses = (c) => c.tasks.map((t) => `${t.text}:${t.status}`);

test('a second request waits, then runs when the first is done, and the list follows', async () => {
  const c = make();
  c.handleText('open notes');
  await new Promise((r) => setImmediate(r));
  assert.equal(c.state, 'working');
  c.handleText('set a timer'); // asked while the first is running
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(statuses(c), ['open notes:running', 'set a timer:queued']);
  assert.deepEqual(c.ran, ['open notes']);
  await c.release(); // first finishes: the second starts, and the screen does not show "done" in between
  assert.deepEqual(statuses(c), ['open notes:done', 'set a timer:running']);
  assert.equal(c.state, 'working');
  assert.deepEqual(c.ran, ['open notes', 'set a timer']);
  await c.release();
  assert.equal(c.state, 'done');
  assert.deepEqual(statuses(c), ['open notes:done', 'set a timer:done']);
  assert.equal(c.pushes.at(-1).reply, 'did set a timer');
});

test('stopping drops the ones that were waiting', async () => {
  const c = make();
  c.handleText('one');
  await new Promise((r) => setImmediate(r));
  c.handleText('two');
  c.handleText('three');
  await new Promise((r) => setImmediate(r));
  assert.equal(c.queue.length, 2);
  c.abort = { abort() {} };
  c.stop();
  assert.deepEqual(statuses(c), ['one:running']);
  assert.equal(c.queue.length, 0);
});

test('a new round starts a fresh list', async () => {
  const c = make();
  c.handleText('one');
  await new Promise((r) => setImmediate(r));
  await c.release();
  assert.equal(c.state, 'done');
  c.handleText('two');
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(statuses(c), ['two:running']);
});

test('a task that ends while you are asking for the next one waits to be shown', async () => {
  const c = make();
  c.handleText('one');
  await new Promise((r) => setImmediate(r));
  c.state = 'listening'; // the user is talking
  await c.release();
  assert.equal(c.state, 'listening'); // the screen stays with the new ask
  assert.equal(c.pendingFinish.reply, 'did one');
  c.resumeWork(); // nothing heard
  assert.equal(c.state, 'done');
  assert.equal(c.pushes.at(-1).reply, 'did one');
});
