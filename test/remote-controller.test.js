const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const real = Module._load;
Module._load = function (req, ...rest) { return req === 'electron' ? { app: {}, screen: { getPrimaryDisplay: () => ({}) }, BrowserWindow: class {}, ipcMain: {}, Notification: class {}, systemPreferences: {}, desktopCapturer: {}, clipboard: {}, shell: {} } : real.call(this, req, ...rest); };
let AskController;
try { ({ AskController } = require('../src/main/askController')); } finally { Module._load = real; }

function make() {
  const c = Object.create(AskController.prototype);
  const results = [];
  const spoken = [];
  const gates = [];
  Object.assign(c, {
    _state: 'idle', tasks: [], queue: [], runningTask: null, pendingFinish: null, results, spoken,
    store: { get: (k) => (k === 'routines' ? [] : k === 'settings.speakReplies' ? true : k === 'settings.playSounds' ? false : k === 'history' ? [{ text: 'a', reply: 'b', status: 'done', ts: 1 }, { text: 'c', reply: 'd', status: 'done', ts: 2 }] : null), addHistory() {}, set() {} },
    overlay: { beginRequest() {}, endRequest() {}, buddy() {}, workDone() {}, hud() {}, hide() {} }, ducker: { restore() {} }, guide: { command: () => null },
    speaker: { speak: (t) => spoken.push(t) }, onChange() {}, onState() {}, wakeSoon() {}, win: { setFocusable() {}, isDestroyed: () => false }, ensureWindow() { return this.win; }, passiveUI: () => true,
    sound() {}, reveal() {}, captionState: () => ({}), tryQuick: async () => null, close() { this.state = 'idle'; },
    agents: { view: () => [] },
    onResult: (r) => results.push(r),
    runRequest(text, entry) { return new Promise((resolve) => gates.push(() => resolve(this.finish(entry, { status: 'done', reply: `did ${text}` })))); }
  });
  c.release = async () => { gates.shift()(); await new Promise((r) => setImmediate(r)); };
  return c;
}
const tick = () => new Promise((r) => setImmediate(r));

test('a request from the phone runs, answers the phone with its id, and the Mac does not speak it', async () => {
  const c = make();
  const id = await c.remoteAsk('open notes', { name: 'iPhone' });
  await tick();
  assert.equal(c.state, 'working');
  await c.release();
  assert.deepEqual(c.results, [{ id, reply: 'did open notes', status: 'done' }]);
  assert.deepEqual(c.spoken, [], 'replies to the phone are not read out on the Mac');
});

test('a request made on the Mac still speaks and tells the phone with no id', async () => {
  const c = make();
  c.state = 'input';
  c.handleText('open notes');
  await tick();
  await c.release();
  assert.deepEqual(c.results, [{ id: null, reply: 'did open notes', status: 'done' }]);
  assert.deepEqual(c.spoken, ['did open notes']);
});

test('a phone request while something runs joins the list and keeps its id', async () => {
  const c = make();
  c.handleText('first');
  await tick();
  const id = await c.remoteAsk('second', {});
  await tick();
  assert.deepEqual(c.tasks.map((t) => `${t.text}:${t.status}`), ['first:running', 'second:queued']);
  await c.release();
  await c.release();
  assert.deepEqual(c.results.map((r) => [r.id, r.reply]), [[null, 'did first'], [id, 'did second']]);
});

test('the status snapshot and recent list are what the phone shows', () => {
  const c = make();
  c.workView = { label: 'Opening Notes' };
  c.tasks = [{ id: '1', text: 'x', status: 'running' }];
  assert.deepEqual(c.remoteSnapshot(), { volume: null, state: 'idle', label: 'Opening Notes', question: '', tasks: [{ id: '1', text: 'x', status: 'running' }], agents: [], locked: false });
  c.lockWatch = { locked: true };
  assert.equal(c.remoteSnapshot().locked, true, 'the phone shows the lock closed');
  assert.deepEqual(c.remoteRecent(1), [{ text: 'a', reply: 'b', status: 'done', ts: 1 }]);
  c._state = 'confirm';
  c.confirmQuestion = 'Send it?';
  assert.equal(c.remoteSnapshot().question, 'Send it?');
});
