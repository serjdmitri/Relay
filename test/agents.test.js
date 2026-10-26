const test = require('node:test');
const assert = require('node:assert/strict');
const { AgentManager, parseAgentCommand } = require('../src/main/agents');

test('agent commands are understood, and "in the background" at the end is not one', () => {
  assert.deepEqual(parseAgentCommand('In the background, research the best headphones and save it in a note.'), { type: 'agent-start', task: 'research the best headphones and save it in a note' });
  assert.deepEqual(parseAgentCommand('Start an agent to summarize my notes about trips'), { type: 'agent-start', task: 'summarize my notes about trips' });
  assert.deepEqual(parseAgentCommand('hey Jarvis, have an agent find the cheapest flights to Boston'), { type: 'agent-start', task: 'find the cheapest flights to Boston' });
  assert.deepEqual(parseAgentCommand('what are my agents doing?'), { type: 'agent-list' });
  assert.deepEqual(parseAgentCommand('show my agents'), { type: 'agent-list' });
  assert.deepEqual(parseAgentCommand('stop all agents'), { type: 'agent-stop', query: '' });
  assert.deepEqual(parseAgentCommand('stop the agent working on headphones'), { type: 'agent-stop', query: 'headphones' });
  assert.equal(parseAgentCommand('play some jazz in the background'), null);
  assert.equal(parseAgentCommand('open Notes'), null);
  assert.equal(parseAgentCommand('in the background'), null);
});

function make(run, extra = {}) {
  const timers = [];
  const changes = [];
  const m = new AgentManager({ run, onChange: () => changes.push(m.view().map((a) => `${a.task}:${a.status}`).join(',')), setTimer: (fn) => timers.push(fn), ...extra });
  return { m, timers, changes };
}
const tick = () => new Promise((r) => setImmediate(r));

test('an agent runs, reports progress, finishes, and leaves the list after a while', async () => {
  let finish;
  const done = [];
  const { m, timers } = make((a) => new Promise((res) => { finish = res; m.progress(a, 'Searching the web'); }), { onFinish: (a) => done.push(a.status) });
  const a = m.start('research headphones');
  await tick();
  assert.equal(a.status, 'running');
  assert.equal(a.step, 'Searching the web');
  assert.equal(m.view()[0].steps, 1);
  finish({ status: 'done', reply: 'Found three.' });
  await tick();
  assert.equal(a.status, 'done');
  assert.equal(a.result, 'Found three.');
  assert.deepEqual(done, ['done']);
  assert.equal(m.view().length, 1);
  timers[0](); // the linger timer
  assert.equal(m.view().length, 0);
});

test('at most three run at once, and a crash is a failed agent, not a crash', async () => {
  const { m } = make(() => new Promise(() => {}));
  assert.ok(m.start('one'));
  assert.ok(m.start('two'));
  assert.ok(m.start('three'));
  assert.equal(m.start('four'), null);
  const bad = make(async () => { throw new Error('boom'); });
  const a = bad.m.start('x task');
  await tick();
  await tick();
  assert.equal(a.status, 'failed');
  assert.equal(a.result, 'boom');
});

test('stopping aborts the agent that matches, and it ends as stopped', async () => {
  const sigs = {};
  const { m } = make((a, signal) => new Promise((res) => { sigs[a.task] = signal; signal.addEventListener('abort', () => res({ status: 'stopped', reply: 'Stopped.' })); }));
  const a = m.start('research headphones');
  m.start('write the trip plan');
  await tick();
  assert.equal(m.stop('headphones'), 1);
  await tick();
  assert.equal(sigs['research headphones'].aborted, true);
  assert.equal(sigs['write the trip plan'].aborted, false);
  assert.equal(a.status, 'stopped');
  assert.equal(m.running().length, 1);
  assert.equal(m.stop(), 1);
});
