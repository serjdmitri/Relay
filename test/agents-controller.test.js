const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const real = Module._load;
Module._load = function (req, ...rest) { return req === 'electron' ? { app: {}, screen: {}, BrowserWindow: class {}, ipcMain: {}, Notification: class {}, systemPreferences: {}, desktopCapturer: {}, clipboard: {}, shell: {} } : real.call(this, req, ...rest); };
let AskController, AgentManager;
try { ({ AskController } = require('../src/main/askController')); ({ AgentManager } = require('../src/main/agents')); } finally { Module._load = real; }

function make() {
  const added = [];
  const shown = [];
  const c = Object.create(AskController.prototype);
  const gate = [];
  Object.assign(c, { store: { addHistory: (h) => added.push(h), get: () => null }, onChange() {}, sound() {}, overlay: { agents: (l) => shown.push(l) }, onAgentDone: null });
  c.agents = new AgentManager({ run: (a) => new Promise((res) => gate.push(() => res({ status: 'done', reply: 'All done.' }))), onChange: () => c.overlay.agents(c.agents.view()), onFinish: (a) => c.agentFinished(a), setTimer: () => {} });
  return { c, added, shown, gate };
}

test('starting, listing and stopping agents by command, with the screen kept up to date', async () => {
  const { c, shown } = make();
  assert.match(c.runAgentCommand({ type: 'agent-start', task: 'research headphones' }).reply, /Started an agent: research headphones/);
  assert.equal(shown.at(-1)[0].status, 'running');
  assert.match(c.runAgentCommand({ type: 'agent-list' }).reply, /1 agent working: research headphones/);
  assert.equal(c.runAgentCommand({ type: 'agent-start', task: 'x' }).status, 'failed'); // too short to be a job
  assert.match(c.runAgentCommand({ type: 'agent-stop', query: '' }).reply, /Stopped 1 agent/);
  assert.equal(c.runAgentCommand({ type: 'agent-stop', query: '' }).reply, 'No agent matches.');
});

test('a finished agent is recorded in History and reported', async () => {
  const { c, added, gate } = make();
  const done = [];
  c.onAgentDone = (a) => done.push(a.status);
  c.runAgentCommand({ type: 'agent-start', task: 'summarize my notes' });
  await new Promise((r) => setImmediate(r));
  gate.shift()();
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(done, ['done']);
  assert.equal(added[0].text, 'Agent: summarize my notes');
  assert.equal(added[0].reply, 'All done.');
});

test('the fourth agent is refused politely', () => {
  const { c } = make();
  for (const t of ['one job', 'two job', 'three job']) c.runAgentCommand({ type: 'agent-start', task: t });
  assert.match(c.runAgentCommand({ type: 'agent-start', task: 'four job' }).reply, /Three agents are already working/);
});
