const test = require('node:test'), assert = require('node:assert/strict');
const { ensureApp, ensureOllama, helpersIn } = require('../src/main/appLauncher');
const { createMac } = require('../src/main/agent/mac');
const { OllamaProvider } = require('../src/main/agent/providers/ollama');
const { run } = require('../src/main/localMode');

const noSleep = async () => {};
// A fake Mac: apps start running after `delay` pgrep checks.
const fakeApps = (delay = 2) => { const calls = []; let n = 0, opened = false;
  const exec = async (cmd, args) => { calls.push([cmd, ...args].join(' ')); if (cmd === '/usr/bin/open') { opened = true; return ''; } if (cmd === '/usr/bin/pgrep') { if (opened && ++n > delay) return '123'; throw new Error('none'); } return ''; };
  return { exec, calls }; };

test('a closed Calendar is opened hidden and waited for; an open one is left alone', async () => {
  const m = fakeApps(); assert.equal(await ensureApp('Calendar', { exec: m.exec, sleep: noSleep }), true);
  assert.ok(m.calls.includes('/usr/bin/open -g -j -a Calendar'), 'background and hidden: no window, no focus steal');
  const open = { exec: async (c) => (c === '/usr/bin/pgrep' ? '99' : (() => { throw new Error('should not open'); })()) };
  assert.equal(await ensureApp('Reminders', { exec: open.exec, sleep: noSleep }), true);
});

test('only Calendar and Reminders are ever launched, and it gives up instead of waiting forever', async () => {
  const m = fakeApps(); assert.equal(await ensureApp('Terminal', { exec: m.exec, sleep: noSleep }), false); assert.equal(m.calls.length, 0);
  const never = { exec: async (c) => { if (c === '/usr/bin/pgrep') throw new Error('none'); return ''; } };
  assert.equal(await ensureApp('Calendar', { exec: never.exec, sleep: noSleep, tries: 3 }), false);
});

test('helpersIn finds which apps a script talks to', () => {
  assert.deepEqual(helpersIn(['tell application "Calendar"', 'end tell']), ['Calendar']);
  assert.deepEqual(helpersIn('tell application "Reminders"\ntell application "Calendar"'), ['Reminders', 'Calendar']);
  assert.deepEqual(helpersIn(['tell application "Notes"']), []);
});

test('mac Calendar and Reminders commands open the app first, with a longer timeout; without the launcher nothing changes', async () => {
  const order = []; const exec = async (cmd, args, opts) => { order.push(`${cmd}:${opts && opts.timeout || ''}`); return ''; };
  const mac = createMac({ exec, ensureApp: async (n) => { order.push('ensure:' + n); return true; } });
  await mac.calendarEvents(1); assert.deepEqual(order, ['ensure:Calendar', 'osascript:60000']);
  order.length = 0; await mac.remindersList(); assert.equal(order[0], 'ensure:Reminders');
  order.length = 0; const plain = createMac({ exec }); await plain.calendarEvents(1); assert.deepEqual(order, ['osascript:']);
});

test('a closed Ollama is started (app hidden, else ollama serve) and waited for; other addresses are never started', async () => {
  let up = false; const get = async () => { if (!up) throw new Error('ECONNREFUSED'); return {}; };
  const calls = []; const exec = async (c, a) => { calls.push([c, ...a].join(' ')); up = true; return ''; };
  assert.equal(await ensureOllama({ get, exec, fileExists: (p) => p === '/Applications/Ollama.app', spawnDetached() { throw new Error('no'); }, sleep: noSleep }), true);
  assert.deepEqual(calls, ['/usr/bin/open -g -j -a Ollama']);
  up = false; const spawned = []; assert.equal(await ensureOllama({ get, exec, fileExists: (p) => p === '/usr/local/bin/ollama', spawnDetached: (c, a) => { spawned.push([c, ...a]); up = true; }, sleep: noSleep }), true);
  assert.deepEqual(spawned, [['/usr/local/bin/ollama', 'serve']]);
  up = false; assert.equal(await ensureOllama({ get, exec, fileExists: () => true, spawnDetached() {}, sleep: noSleep, url: 'http://192.168.1.5:11434' }), false);
  assert.equal(await ensureOllama({ get, exec, fileExists: () => false, spawnDetached() {}, sleep: noSleep }), false, 'not installed: nothing to start');
});

test('the Ollama provider starts a closed Ollama and retries once', async () => {
  let calls = 0; const fetchImpl = async () => { calls++; if (calls === 1) throw new Error('fetch failed'); return { ok: true, json: async () => ({ message: { content: 'hi' } }) }; };
  let ensured = 0; const p = new OllamaProvider({ url: 'http://127.0.0.1:11434', model: 'm', fetchImpl, ensure: async () => { ensured++; return true; } });
  const r = await p.step({ system: 's', messages: [{ role: 'user', content: [{ type: 'text', text: 'x' }] }], tools: [] });
  assert.equal(ensured, 1); assert.equal(calls, 2); assert.ok(r);
  const dead = new OllamaProvider({ url: 'http://127.0.0.1:11434', model: 'm', fetchImpl: async () => { throw new Error('refused'); }, ensure: async () => false });
  await assert.rejects(dead.step({ system: 's', messages: [{ role: 'user', content: [{ type: 'text', text: 'x' }] }], tools: [] }), /Cannot reach Ollama/);
});

test('going offline starts Ollama first, so it reports ready instead of "not running"', async () => {
  let up = false; const store = { d: { 'settings.model': { provider: 'claude', ollamaModel: 'qwen2.5:7b', ollamaUrl: 'http://127.0.0.1:11434' } }, get(k) { return this.d[k]; }, set(k, v) { this.d[k] = v; } };
  const get = async () => { if (!up) throw new Error('refused'); return { models: [{ name: 'qwen2.5:7b' }] }; };
  const r = await run({ type: 'local-on' }, { store, get, ensure: async () => { up = true; }, apply() {} });
  assert.match(r.reply, /Local mode is on, Sir/);
});

test('wiring: askController builds the launcher, main pre-warms Calendar and Reminders', () => {
  const fs = require('fs'), read = (f) => fs.readFileSync(require('path').join(__dirname, '..', f), 'utf8');
  assert.match(read('src/main/askController.js'), /ensureApp: \(n\) => launcher\.ensureApp\(n/); assert.match(read('src/main/askController.js'), /ensure: this\.ensureOllama/);
  assert.match(read('src/main/main.js'), /\['Calendar', 'Reminders'\]/); assert.match(read('src/main/main.js'), /ensure: ask\.ensureOllama/);
});
