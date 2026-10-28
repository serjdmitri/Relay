const test = require('node:test');
const assert = require('node:assert/strict');
const { AssistPanel } = require('../src/main/assistPanel');
const { ClaudeAnswerer, ProviderAnswerer, RECYCLE_AFTER } = require('../src/main/assistModel');

function fakeElectron() {
  const log = [];
  class BrowserWindow {
    constructor(o) { log.push(['new', o]); this.destroyed = false; this.webContents = { once: (e, f) => setImmediate(f), send: (...a) => log.push(['send', ...a]) }; }
    setIgnoreMouseEvents(v) { log.push(['ignoreMouse', v]); } setAlwaysOnTop(...a) { log.push(['top', ...a]); } setHiddenInMissionControl(v) { log.push(['noMC', v]); } setVisibleOnAllWorkspaces() {}
    setContentProtection(v) { log.push(['protect', v]); } loadFile() {} on() {} isDestroyed() { return this.destroyed; } setBounds(b) { log.push(['bounds', b]); } showInactive() { log.push(['show']); } hide() { log.push(['hide']); } destroy() { this.destroyed = true; }
  }
  return { log, electron: { BrowserWindow, screen: { getPrimaryDisplay: () => ({ workArea: { x: 0, y: 25, width: 1440, height: 875 } }) } } };
}

test('the answer window is excluded from capture before it is shown, never takes clicks or focus, and follows the switch', async () => {
  const { log, electron } = fakeElectron();
  let hidden = true;
  const p = new AssistPanel({ preload: 'p.js', electron, getHidden: () => hidden });
  await p.update({ id: 1, question: 'q', text: 'a', stage: 'quick' });
  const kinds = log.map((l) => l[0]);
  assert.ok(kinds.indexOf('protect') < kinds.indexOf('show'), 'protection is on before the window appears');
  assert.deepEqual(log.find((l) => l[0] === 'protect'), ['protect', true]);
  assert.deepEqual(log.find((l) => l[0] === 'ignoreMouse'), ['ignoreMouse', true]);
  const opts = log.find((l) => l[0] === 'new')[1];
  assert.equal(opts.focusable, false);
  assert.equal(opts.skipTaskbar, true);
  assert.deepEqual(log.find((l) => l[0] === 'bounds')[1], { x: 1024, y: 31, width: 408, height: 440 });
  assert.deepEqual(log.at(-1), ['send', 'assist:state', 'answer', { id: 1, question: 'q', text: 'a', stage: 'quick' }]);
  hidden = false;
  await p.test();
  assert.deepEqual(log.filter((l) => l[0] === 'protect').at(-1), ['protect', false], 'turned off in Settings: it shows, and the test says so');
  assert.deepEqual(log.at(-1), ['send', 'assist:state', 'test', { hidden: false }]);
  assert.equal(log.filter((l) => l[0] === 'new').length, 1, 'one window');
});

function fakeSession(replies, tag, made) {
  return class {
    constructor(o) { this.o = o; this.alive = true; this.uses = 0; made.push({ tag: o.tools.length ? 'research' : 'quick', system: o.system, model: o.model, tools: o.tools.length }); }
    async ask(text, { onEvent }) { onEvent({ type: 'text-delta', text: 'Hel' }); onEvent({ type: 'text-delta', text: 'lo' }); return { status: 'done', reply: replies.shift() ?? 'Hello' }; }
    close() { this.alive = false; }
  };
}

test('the Claude answerer keeps a no-tools fast session and a web session, streams the first, and renews them', async () => {
  const made = []; let stops = 0;
  const a = new ClaudeAnswerer({ deps: { findClaude: async () => '/bin/claude', McpHost: class { async start() {} stop() { stops++; } }, ClaudeSession: fakeSession([], 'x', made) }, getTools: () => [{ name: 'web_search' }], getName: () => 'Sergey', getMemory: () => 'likes robots' });
  await a.warm();
  assert.deepEqual(made.map((m) => [m.tag, m.model, m.tools]), [['quick', 'haiku', 0], ['research', 'haiku', 1]]);
  assert.match(made[0].system, /Sergey's private assistant[^]*likes robots/);
  assert.match(made[1].system, /CONFIRMED, CORRECTION or NEW/);
  const deltas = [];
  assert.equal(await a.quick('q', { onDelta: (d) => deltas.push(d) }), 'Hello');
  assert.deepEqual(deltas, ['Hel', 'lo']);
  for (let i = 0; i < RECYCLE_AFTER; i++) await a.quick('q', {});
  await a.quick('q', {});
  assert.equal(made.filter((m) => m.tag === 'quick').length, 2, 'a fresh fast session after enough questions');
  a.close();
  assert.equal(stops, 3);
  const none = new ClaudeAnswerer({ deps: { findClaude: async () => null, McpHost: class {}, ClaudeSession: class {} }, getTools: () => [] });
  await assert.rejects(() => none.quick('q', {}), /not installed/);
  const failing = new ClaudeAnswerer({ deps: { findClaude: async () => 'c', McpHost: class { async start() {} stop() {} }, ClaudeSession: class { constructor() { this.alive = true; } async ask() { return { status: 'failed', reply: 'not signed in' }; } close() {} } }, getTools: () => [] });
  await assert.rejects(() => failing.quick('q', {}), /not signed in/);
});

test('another model service answers in one piece and checks with a short agent run', async () => {
  const calls = [];
  const a = new ProviderAnswerer({ deps: { buildProvider: () => ({ provider: { step: async (o) => { calls.push(['step', o.tools.length]); return { text: 'Answer.' }; } } }), runAgent: async (o) => { calls.push(['agent', o.maxSteps, o.tools.length]); return { status: 'done', reply: 'CONFIRMED: ok' }; } }, getTools: () => [{ name: 'web_search' }] });
  const d = []; assert.equal(await a.quick('q', { onDelta: (x) => d.push(x) }), 'Answer.');
  assert.deepEqual(d, ['Answer.']);
  assert.equal(await a.research('q', {}), 'CONFIRMED: ok');
  assert.deepEqual(calls, [['step', 0], ['agent', 5, 1]]);
});
