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

test('storage map opens through the local command path for both Claude and Codex without a model request', async () => {
  for (const provider of ['claude', 'codex']) for (const wording of ['show me the storage map', 'whats taking up my storage', 'what’s taking up my storage?']) {
    const c = make(); let opened = 0;
    const get = c.store.get;
    c.store.get = k => k === 'settings.model.provider' ? provider : get(k);
    c.openStorageMap = () => { opened++; return { status: 'done', reply: 'The storage map is open.', actions: 1 }; };
    c.runRequest = () => { throw new Error('Storage request should not call a model'); };
    const result = await c.handleText(wording);
    assert.equal(opened, 1); assert.equal(result.status, 'done');
  }
});

test('natural menu phrases and multiple menus route locally with both providers', async t => {
  for (const provider of ['claude', 'codex']) {
    const c = make(), opened = [];
    t.after(() => { clearTimeout(c.doneTimer); clearTimeout(c.holdTimer); });
    const get = c.store.get;
    c.store.get = k => k === 'settings.model.provider' ? provider : k === 'settings' ? { flags: { panels: true } } : get(k);
    c.openStorageMap = () => { opened.push('storage'); return { status: 'done', reply: 'Storage open.' }; };
    c.panelHub = { show: async spec => { opened.push(spec.builtin || spec.sources[0]); return { ok: true }; } };
    c.forecastCommand = async query => { opened.push('weather:' + query.place); return { status: 'done', reply: 'Weather open.' }; };
    c.runRequest = () => { throw Error('Menus should bypass the model'); };
    const result = await c.handleText('can I see my storage and weather in Miami and calculator plus battery and wifi please');
    assert.equal(result.status, 'done'); assert.deepEqual(opened, ['storage', 'weather:Miami', 'calculator', 'battery', 'network']);
  }
});
test('a slow weather source does not delay opening other requested menus', async () => {
  const c = make(), opened = [];
  c.panelHub = { show: async () => { opened.push('calculator'); return { ok: true }; } };
  let release;
  c.forecastCommand = () => new Promise(resolve => { release = () => resolve({ status: 'done', reply: 'Weather.' }); });
  const pending = c.openMenuRequests([{ kind: 'weather', query: { place: 'Miami' } }, { kind: 'calculator' }]);
  assert.deepEqual(opened, ['calculator']); release(); await pending;
});
test('cancelling a group does not report it as a completed request after weather settles', async () => {
  const c = make();
  c.forecastCommand = (_q, { parentSignal }) => new Promise(resolve => parentSignal.addEventListener('abort', () => resolve({ status: 'stopped', reply: 'Stopped.' }), { once: true }));
  const pending = c.openMenuRequests([{ kind: 'weather', query: { place: 'Miami' } }]);
  c.abort.abort();
  assert.equal((await pending).status, 'stopped');
});
test('again repeats the last keyword menu instead of an older model task', async t => {
  const c = make(); let opened = 0;
  t.after(() => { clearTimeout(c.doneTimer); clearTimeout(c.holdTimer); });
  c.openStorageMap = () => { opened++; return { status: 'done', reply: 'Storage open.' }; };
  c.runRequest = () => { throw Error('A repeated menu should not call the model'); };
  await c.handleText('my computer has no free space');
  await c.handleText('again');
  assert.equal(opened, 2);
});
test('network keywords use the radar when available without requiring the legacy live panel switch', async t => {
  const c=make();let opened=0;t.after(()=>{clearTimeout(c.doneTimer);clearTimeout(c.holdTimer);});
  c.openNetworkRadar=()=>{opened++;return{status:'done',reply:'Radar open.'};};c.runRequest=()=>assert.fail('Network radar is a local command');
  const result=await c.handleText('can I see what my network is doing');assert.equal(opened,1);assert.equal(result.status,'done');
});
test('voice removal of a storage selection uses the same permission-gated local action', async t => {
  const c=make();let called=0;t.after(()=>{clearTimeout(c.doneTimer);clearTimeout(c.holdTimer);});
  c.trashStorageSelection=async()=>{called++;return{status:'stopped',reply:'Cancelled. No files moved.'};};c.runRequest=()=>assert.fail('Selected storage files must use the local confirmation path');
  const result=await c.handleText('delete the selected files');assert.equal(called,1);assert.equal(result.status,'stopped');
});

test('owner phone requests outrank menu keywords and never invoke either model', async () => {
  for (const provider of ['claude', 'codex']) for (const scheduled of [false, true]) {
    const c=make(),commands=[];const get=c.store.get;
    c.store.get=k=>k==='settings.model.provider'?provider:get(k);
    c.onCallCommand=async command=>{commands.push(command);return{status:'done',reply:'Prepared for review.'};};
    c.runRequest=()=>{throw Error('Call preparation must not invoke a model');};
    c.openStorageMap=()=>{throw Error('Call purpose must not trigger a menu');};
    const result=await c.handleText('call me about storage',{scheduled});
    assert.equal(result.status,'done');assert.deepEqual(commands,[{type:'prepare',purpose:'storage',background:scheduled}]);
    clearTimeout(c.doneTimer);clearTimeout(c.holdTimer);
  }
});
