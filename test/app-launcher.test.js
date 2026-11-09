const test = require('node:test'), assert = require('node:assert/strict');
const { ensureOllama } = require('../src/main/appLauncher');
const { createMac } = require('../src/main/agent/mac');
const { OllamaProvider } = require('../src/main/agent/providers/ollama');
const { run } = require('../src/main/localMode');

const noSleep = async () => {};
test('mac Calendar and Reminders go through relay-cal (no app opened); without it the AppleScript path is unchanged', async () => {
  const calls = []; const exec = async (cmd, args) => { calls.push([cmd, ...args]); return ''; };
  const mac = createMac({ exec, calBin: '/x/relay-cal' });
  assert.equal(await mac.calendarEvents(2), 'No events.'); assert.deepEqual(calls.pop(), ['/x/relay-cal', 'events', '2']);
  assert.equal(await mac.remindersList(), 'No open reminders.'); assert.equal(await mac.remindersDue(), 'No reminders due.');
  await mac.remindersAdd('milk', '2026-11-09T09:00', 'Home'); assert.deepEqual(calls.pop(), ['/x/relay-cal', 'rem-add', 'milk', '2026-11-09T09:00', 'Home']);
  await mac.remindersAddId('milk', null); assert.deepEqual(calls.pop(), ['/x/relay-cal', 'rem-add-id', 'milk', '']);
  await mac.remindersDeleteById('ABC'); assert.deepEqual(calls.pop(), ['/x/relay-cal', 'rem-delete', 'ABC']);
  await mac.remindersComplete('milk'); assert.deepEqual(calls.pop(), ['/x/relay-cal', 'rem-complete', 'milk']);
  await mac.calendarCreate('Lunch', '2026-11-09T12:00'); assert.deepEqual(calls.pop(), ['/x/relay-cal', 'event-create', 'Lunch', '2026-11-09T12:00', '']);
  assert.ok(calls.every((c) => !/osascript/.test(c[0])), 'no AppleScript, so no app is launched');
  calls.length = 0; await createMac({ exec }).calendarEvents(1); assert.equal(calls[0][0], 'osascript');
});

test('a closed Ollama is started (ollama serve, else the app hidden) and waited for; other addresses are never started', async () => {
  let up = false; const get = async () => { if (!up) throw new Error('ECONNREFUSED'); return {}; };
  const calls = []; const exec = async (c, a) => { calls.push([c, ...a].join(' ')); up = true; return ''; };
  assert.equal(await ensureOllama({ get, exec, fileExists: (p) => p === '/Applications/Ollama.app', spawnDetached() { throw new Error('no'); }, sleep: noSleep }), true);
  assert.deepEqual(calls, ['/usr/bin/open -g -j -a Ollama'], 'only the app is installed: opened hidden');
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

test('wiring: askController and main pass the Ollama starter and relay-cal; the package carries relay-cal', () => {
  const fs = require('fs'), read = (f) => fs.readFileSync(require('path').join(__dirname, '..', f), 'utf8');
  assert.match(read('src/main/askController.js'), /calBin: calBin/); assert.match(read('src/main/askController.js'), /ensure: this\.ensureOllama/);
  assert.match(read('src/main/main.js'), /calBin: calBinPath\(\)/); assert.match(read('src/main/main.js'), /ensure: ask\.ensureOllama/); assert.match(read('package.json'), /native\/build\/relay-cal/); assert.ok(!/ensureApp/.test(read('src/main/main.js')), 'no hidden launch of Calendar or Reminders');
});
