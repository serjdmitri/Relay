const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');
const { AgentManager, parseAgentsDashboardCommand, MAX_QUEUE, MAX_HISTORY } = require('../src/main/agents');

const tick = () => new Promise((r) => setImmediate(r));
function make(run, extra = {}) {
  const timers = [];
  const m = new AgentManager({ run, setTimer: (fn) => timers.push(fn), ...extra });
  return { m, timers };
}
// Each job waits until the test finishes it, so slots stay taken exactly as long as the test wants.
function gated() {
  const gates = new Map();
  const run = (a, signal) => new Promise((res) => {
    gates.set(a.task, (r) => res(r));
    signal.addEventListener('abort', () => res({ status: 'stopped', reply: 'Stopped.' }));
  });
  return { run, finish: (task, r = { status: 'done', reply: `Done: ${task}` }) => gates.get(task)(r) };
}

test('the dashboard command opens the window and leaves spoken agent commands alone', () => {
  for (const t of ['open the agents dashboard', 'Show my agents dashboard', 'agents dashboard', 'jarvis, bring up the agent manager', 'show me my background jobs list', 'open my agents', 'Please open all my agents.', 'show me the task dashboard']) assert.equal(parseAgentsDashboardCommand(t), true, t);
  for (const t of ['what are my agents doing', 'show my agents', 'stop all agents', 'start an agent to find flights', 'open Notes', 'play jazz in the background', '']) assert.equal(parseAgentsDashboardCommand(t), false, t);
});

test('jobs start while there is room and wait in line when there is not, oldest first', async () => {
  const g = gated();
  const { m } = make(g.run, { max: 2 });
  const r = ['one job', 'two job', 'three job', 'four job'].map((t) => m.submit(t));
  assert.deepEqual(r.map((x) => !!x.started), [true, true, false, false]);
  assert.deepEqual([r[2].queued, r[2].position, r[3].position], [true, 1, 2]);
  assert.deepEqual(m.snapshot().queued.map((q) => q.task), ['three job', 'four job']);
  await tick(); g.finish('one job'); await tick(); await tick();
  const s = m.snapshot();
  assert.deepEqual(s.running.map((x) => x.task).sort(), ['three job', 'two job'], 'the longest-waiting job took the free slot');
  assert.deepEqual(s.queued.map((q) => [q.task, q.position]), [['four job', 1]]);
});

test('cancelling stops one running job or drops one waiting job, and touches nothing else', async () => {
  const g = gated();
  const { m } = make(g.run, { max: 1 });
  const a = m.submit('first job'), b = m.submit('second job'), c = m.submit('third job');
  await tick();
  assert.equal(m.cancel(c.id), 'queued');
  assert.deepEqual(m.snapshot().queued.map((q) => q.task), ['second job']);
  assert.equal(m.cancel('nope'), null);
  assert.equal(m.cancel(a.id), 'running');
  assert.equal(m.snapshot().running[0].stopping, true, 'it says Stopping until the job actually ends');
  await tick(); await tick();
  const s = m.snapshot();
  assert.equal(s.finished[0].status, 'stopped');
  assert.deepEqual(s.running.map((x) => x.task), ['second job'], 'the freed slot went to the next waiting job');
  assert.equal(m.cancel(b.id), 'running'); assert.equal(m.cancel(b.id), null, 'cancelling twice does nothing the second time');
});

test('finished jobs keep their result for review, newest first, and clearing empties the list without touching running jobs', async () => {
  const g = gated();
  const { m } = make(g.run, { max: 3 });
  m.submit('ok job'); m.submit('bad job'); m.submit('live job');
  await tick();
  g.finish('ok job'); g.finish('bad job', { status: 'failed', reply: 'The site was down.' });
  await tick(); await tick();
  const f = m.snapshot().finished;
  assert.deepEqual(f.map((x) => [x.task, x.status, x.result]), [['bad job', 'failed', 'The site was down.'], ['ok job', 'done', 'Done: ok job']].sort((x, y) => f.findIndex((z) => z.task === x[0]) - f.findIndex((z) => z.task === y[0])));
  assert.equal(m.clearFinished(), 2);
  assert.deepEqual([m.snapshot().finished.length, m.snapshot().running.length], [0, 1]);
});

test('the waiting line and the history are capped, and refusing says why', async () => {
  const g = gated();
  const { m } = make(g.run, { max: 1 });
  m.submit('runner job');
  for (let i = 0; i < MAX_QUEUE; i++) assert.equal(m.submit(`wait job ${i}`).queued, true);
  const full = m.submit('one too many');
  assert.match(full.error, /already waiting/); assert.equal(m.snapshot().queued.length, MAX_QUEUE);
  assert.match(m.submit('ab').error, /what the job should do/);
  const { m: h } = make(async () => ({ status: 'done', reply: 'x' }), { max: 1 });
  for (let i = 0; i < MAX_HISTORY + 5; i++) { h.submit(`quick job ${i}`); await tick(); await tick(); }
  assert.equal(h.snapshot().finished.length, MAX_HISTORY);
});

test('stopping by words drops waiting jobs too, so a freed slot cannot start something you just cancelled', async () => {
  const g = gated();
  const { m } = make(g.run, { max: 1 });
  m.submit('research headphones'); m.submit('research laptops'); m.submit('summarize notes');
  await tick();
  assert.equal(m.stop('laptops'), 1);
  assert.deepEqual(m.snapshot().queued.map((q) => q.task), ['summarize notes']);
  assert.equal(m.stop(''), 2, 'stop all: the running one and the one still waiting');
  await tick(); await tick();
  assert.deepEqual([m.snapshot().running.length, m.snapshot().queued.length], [0, 0]);
});

test('a job that throws is recorded as failed with the reason and does not block the line', async () => {
  const { m } = make((a) => (a.task === 'boom job' ? Promise.reject(new Error('Network down')) : Promise.resolve({ status: 'done', reply: 'fine' })), { max: 1 });
  m.submit('boom job'); m.submit('after job');
  await tick(); await tick(); await tick(); await tick();
  const f = m.snapshot().finished;
  assert.deepEqual(f.map((x) => [x.task, x.status]), [['after job', 'done'], ['boom job', 'failed']]);
  assert.equal(f[1].result, 'Network down');
});

// The window: checked through its IPC handler with electron stubbed.
function loadWindow() {
  const handlers = new Map();
  const orig = Module._load;
  Module._load = function (req, ...rest) {
    if (req === 'electron') return { BrowserWindow: class {}, screen: {}, ipcMain: { handle: (n, fn) => handlers.set(n, fn) } };
    return orig.call(this, req, ...rest);
  };
  try { delete require.cache[require.resolve('../src/main/agentsWindow')]; return { ...require('../src/main/agentsWindow'), handlers }; } finally { Module._load = orig; }
}

test('the window starts one job per line, refuses credentials and over-long lines, and ignores messages from other windows', async () => {
  const { AgentsWindow, handlers, MAX_LINES } = loadWindow();
  const started = [];
  const agents = { snapshot: () => ({ running: [], queued: [], finished: [] }), cancel: (id) => (id === 'x' ? 'queued' : null), clearFinished: () => 0 };
  const w = new AgentsWindow({ agents, start: (t) => { started.push(t); return { started: true, id: t }; } });
  const sender = {};
  w.win = { webContents: sender, close() { this.closed = true; } };
  const call = (action, value, s = sender) => handlers.get('agents:action')({ sender: s }, action, value);

  assert.match((await call('state', null, {})).error, /Open the agents dashboard/);
  assert.match((await call('start', '   \n ')).error, /at least one job/);
  const r = await call('start', 'find flights to Boston\n\nmy password is hunter2 please use it\n' + 'x'.repeat(401));
  assert.deepEqual(started, ['find flights to Boston']);
  assert.equal(r.results[0].started, true);
  assert.match(r.results[1].error, /credentials/); assert.match(r.results[2].error, /at most 400/);
  const many = await call('start', Array.from({ length: MAX_LINES + 3 }, (_, i) => `job number ${i}`).join('\n'));
  assert.equal(many.ignored, 3); assert.equal(many.results.length, MAX_LINES);
  assert.equal((await call('cancel', 'x')).cancelled, 'queued');
  await call('close'); assert.equal(w.win.closed, true);
});

test('the dashboard shows and safely stops only the named foreground request', async () => {
  const { AgentsWindow, handlers } = loadWindow();
  const agents = { snapshot: () => ({ running: [], queued: [], finished: [] }) };
  let current = { id: 'request-1', text: 'Open Notes', status: 'Working', queued: 1 };
  const w = new AgentsWindow({ agents, start: () => {}, foreground: () => current, stopForeground: id => { if (id !== current?.id) return false; current = null; return true; } });
  const sender = {}; w.win = { webContents: sender };
  const call = (action, value) => handlers.get('agents:action')({ sender }, action, value);
  assert.equal((await call('state')).foreground.text, 'Open Notes');
  assert.equal((await call('stop-foreground', 'old-request')).stopped, false);
  assert.equal((await call('stop-foreground', 'request-1')).stopped, true);
  assert.equal((await call('state')).foreground, null);
});
