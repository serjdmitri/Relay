const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const real = Module._load;
Module._load = function (req, ...rest) { return req === 'electron' ? { app: {}, screen: { getPrimaryDisplay: () => ({ size: { width: 1440, height: 900 } }) }, BrowserWindow: class {}, ipcMain: {}, Notification: class {}, systemPreferences: {}, desktopCapturer: {}, clipboard: {}, shell: {} } : real.call(this, req, ...rest); };
let AskController, codexCli, Failover;
try { ({ AskController } = require('../src/main/askController')); codexCli = require('../src/main/agent/codexCli'); ({ Failover } = require('../src/main/failover')); } finally { Module._load = real; }

const rigs = [];
test.after(() => rigs.forEach((r) => clearTimeout(r.c.warmTimer))); // the app keeps a finished Claude process warm for 5 minutes

function rig({ codexUsable = true, setting = true, claude = [] } = {}) {
  const data = { 'settings.model': { provider: 'claude', claudeModel: 'auto' }, 'settings.failover.codex': setting, 'settings.failover.until': 0 };
  const c = Object.create(AskController.prototype);
  let t = 1_761_000_000_000;
  const asks = [], codexRuns = [];
  Object.assign(c, {
    store: { get: (k) => data[k], set: (k, v) => { data[k] = v; }, addAction() {} }, onChange() {}, push() {}, streamText() {}, forceTier: null, abort: new AbortController(),
    appsP: Promise.resolve([]), lastApps: [], mac: { listApps: async () => [] }, requestContext: () => 'CTX', claudeSystem: () => 'SYS', makeTools: () => [{ name: 'open_app' }], followUpContext: () => '',
    failover: new Failover({ now: () => t, load: () => data['settings.failover.until'], save: (v) => { data['settings.failover.until'] = v; } }), mcp: { start: async () => {} }, askConfirm: async () => true
  });
  c.codexHost = { start: async () => {} };
  const queue = [...claude];
  const mkSession = () => ({ alive: true, turns: 0, closed: false, onRate: null, ask: async (p) => { asks.push(p); return queue.shift() || { status: 'done', reply: 'Claude did it.' }; }, setModel: async () => {}, close() { this.closed = true; this.alive = false; } });
  c.warm = mkSession();
  c.refill = () => { c.warm = mkSession(); };
  codexCli.findCodex = async () => '/bin/codex';
  codexCli.codexStatus = async () => ({ installed: true, signedIn: codexUsable, method: 'chatgpt', usable: codexUsable });
  codexCli.runCodex = async (o) => { codexRuns.push({ text: o.text, tools: o.tools.map((x) => x.name), hasConfirm: typeof o.confirm === 'function' }); return { status: 'done', reply: 'Codex did it.', actions: 1, usage: { in: 1, out: 1, model: 'codex' } }; };
  const out = { c, data, asks, codexRuns, tick: (ms) => { t += ms; } };
  rigs.push(out);
  return out;
}

const LIMIT = { status: 'failed', reply: "You've hit your limit · resets 3pm", actions: 0 };

test('when Claude is out of usage Codex finishes the request and the switch is disclosed', async () => {
  const r = rig({ claude: [LIMIT] });
  const first = await r.c.execute('open notes', 'req1');
  assert.deepEqual([first.status, first.reply, first.model], ['done', 'Using Codex because Claude reached its usage limit. Codex did it.', 'codex']);
  assert.equal(r.codexRuns.length, 1);
  assert.match(r.codexRuns[0].text, /^CTX\n\nRequest: open notes$/);
  assert.deepEqual(r.codexRuns[0].tools, ['open_app']);
  assert.equal(r.codexRuns[0].hasConfirm, true, 'confirmations still apply');
  assert.ok(r.data['settings.failover.until'] > 0, 'the reset time is remembered');
  assert.equal(r.c.failover.route(), 'codex');
  r.c.warm = null;
  const second = await r.c.execute('pause', 'req2');
  assert.match(second.reply, /^Using Codex because Claude reached its usage limit\./);
  assert.equal(r.asks.length, 1, 'Claude is not asked again while it is out');
});

test('once the reset has passed, Claude takes the next request again', async () => {
  const r = rig({ claude: [LIMIT] });
  await r.c.execute('open notes', 'req1');
  r.tick(24 * 3600e3);
  assert.equal(r.c.failover.route(), 'claude');
  r.c.refill();
  const back = await r.c.execute('pause', 'req3');
  assert.deepEqual([back.reply, back.model], ['Claude did it.', 'haiku']);
  assert.equal(r.codexRuns.length, 1, 'Codex was only used while Claude was out');
});

test('if Claude is still limited when it is tried again, that request is finished by Codex and the wait starts over', async () => {
  const r = rig({ claude: [LIMIT, LIMIT] });
  await r.c.execute('a', 'r1');
  r.tick(24 * 3600e3);
  r.c.refill();
  const again = await r.c.execute('b', 'r2');
  assert.match(again.reply, /^Using Codex because Claude reached its usage limit\./);
  assert.equal(r.c.failover.route(), 'codex');
  assert.equal(r.codexRuns.length, 2);
});

test('without a usable Codex sign-in (or with the switch off) Claude\'s own message is kept, and an API-key sign-in does not count', async () => {
  const none = rig({ codexUsable: false, claude: [LIMIT] });
  assert.equal((await none.c.execute('x', 'r')).reply, LIMIT.reply);
  assert.equal(none.codexRuns.length, 0);
  const off = rig({ setting: false, claude: [LIMIT] });
  assert.equal((await off.c.execute('x', 'r')).reply, LIMIT.reply);
  assert.equal(off.codexRuns.length, 0);
  assert.equal(await off.c.codexReady(), null);
});

test('other failures are not limits: no switch, and a stale rejected report does not count', async () => {
  const bad = { status: 'failed', reply: 'Claude could not reach Relay\'s tools.', actions: 0 };
  const r = rig({ claude: [bad, bad] }); // a normal failure is retried once on the stronger model, as before
  r.c.rate = { status: 'rejected', ts: Date.now() - 3600e3 };
  const out = await r.c.execute('x', 'r');
  assert.match(out.reply, /could not reach/);
  assert.equal(r.codexRuns.length, 0);
  assert.equal(r.c.failover.route(), 'claude');
});

test('if Codex is out too, one plain sentence says so and when Claude is back', async () => {
  const r = rig({ claude: [LIMIT] });
  codexCli.runCodex = async () => ({ status: 'failed', reply: 'hit your usage limit', limit: true, actions: 0 });
  const out = await r.c.execute('x', 'r');
  assert.match(out.reply, /Claude and Codex are both out of usage right now\. Claude should be back around \d{1,2}:\d\d [AP]M\./);
});

test('a usage-limit failure is not retried on a stronger Claude model (it would be out too), other failures still are', () => {
  const { escalationReason } = require('../src/main/agent/claudeCli');
  assert.equal(escalationReason({ status: 'failed', reply: "You've hit your limit · resets 3pm" }), null);
  assert.match(escalationReason({ status: 'failed', reply: 'It hit an error' }), /hit an error/);
});
