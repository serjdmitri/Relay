// End-to-end run of the real Electron app under Xvfb:
//   xvfb-run -a node scripts/e2e.mjs
// A mock Ollama server plays the model and stub osascript/open binaries stand in for macOS,
// so the pill, controller, agent loop, tools and store all run for real.
import { _electron as electron } from 'playwright-core';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-e2e-'));
const bin = path.join(tmp, 'bin');
const log = path.join(tmp, 'calls.log');
const shots = path.join(root, 'shots');
fs.mkdirSync(bin);
fs.mkdirSync(shots, { recursive: true });

const stub = (name, body) => {
  fs.writeFileSync(path.join(bin, name), `#!/bin/sh\necho "${name} $*" >> "${log}"\n${body}\n`, { mode: 0o755 });
};
stub('osascript', `case "$*" in
  *"get name of (processes"*) echo "Claude, Finder, Firefox";;
  *"first application process whose frontmost"*) echo "Finder";;
esac`);
stub('open', 'true');
stub('afplay', 'true');
stub('say', 'true');

// ---- mock model (Ollama wire format) ----
const scenarios = {
  'what apps do i have open': (hasTool) => hasTool
    ? { content: 'You have 3 apps open: Claude, Finder and Firefox.' }
    : { tool_calls: [{ function: { name: 'list_running_apps', arguments: {} } }] },
  'text mom running late': (hasTool) => hasTool
    ? { content: 'Sent the message.' }
    : { tool_calls: [{ function: { name: 'messages_send', arguments: { to: '+13055550100', text: 'running late' } } }] },
  'open notes': (hasTool) => hasTool
    ? { content: 'Opened Notes.' }
    : { tool_calls: [{ function: { name: 'open_app', arguments: { name: 'Notes' } } }] },
  'open calendar': (hasTool) => hasTool ? { content: 'Opened Calendar.' } : { tool_calls: [{ function: { name: 'open_app', arguments: { name: 'Calendar' } } }] },
  'slow request': () => 'hang'
};
const modelCalls = [];
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const j = JSON.parse(body);
    modelCalls.push(j);
    const firstUser = j.messages.find((m) => m.role === 'user')?.content?.toLowerCase().replace(/[^a-z ]/g, '').trim();
    const hasTool = j.messages.some((m) => m.role === 'tool');
    const out = (scenarios[firstUser] || (() => ({ content: 'I am not sure how to do that.' })))(hasTool);
    if (out === 'hang') return; // never answers; lets the Stop test cancel it
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ message: { role: 'assistant', content: '', ...out } }));
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const modelUrl = `http://127.0.0.1:${server.address().port}`;

// ---- seed settings ----
const userData = path.join(tmp, 'userdata');
fs.mkdirSync(userData);
fs.writeFileSync(path.join(userData, 'relay.json'), JSON.stringify({
  onboardingDone: true,
  settings: { playSounds: false, model: { provider: 'ollama', ollamaUrl: modelUrl, ollamaModel: 'qwen2.5:14b' } }
}));

const results = [];
const step = async (name, fn) => {
  try {
    await fn();
    results.push(['PASS', name]);
    console.log('PASS', name);
  } catch (e) {
    results.push(['FAIL', name, e.message]);
    console.log('FAIL', name, '\n   ', e.message.split('\n').slice(0, 4).join('\n    '));
  }
};
const calls = () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '');

const app = await electron.launch({
  executablePath: path.join(root, 'node_modules/electron/dist/electron'),
  args: ['--no-sandbox', `--user-data-dir=${userData}`, root],
  env: { ...process.env, RELAY_E2E: '1', PATH: `${bin}:${process.env.PATH}` }
});
const errors = [];
app.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

const pillPage = async () => {
  for (let i = 0; i < 50; i++) {
    const p = app.windows().find((w) => w.url().includes('ask.html'));
    if (p) return p;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('pill window never appeared');
};
const waitFor = async (fn, what, ms = 8000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try { const v = await fn(); if (v) return v; } catch {}
    await new Promise((r) => setTimeout(r, 80));
  }
  throw new Error('timed out waiting for ' + what);
};
const ev = (fn, arg) => app.evaluate(fn, arg);
const askState = () => ev(() => global.__relay.ask.state);
const hist = () => ev(() => global.__relay.store.get('history').map((h) => ({ text: h.text, status: h.status, reply: h.reply })));

// first window is the main window
const main = await app.firstWindow();
await main.waitForLoadState('domcontentloaded');
await main.setViewportSize({ width: 820, height: 620 }).catch(() => {});

await step('main window renders Home with seeded state', async () => {
  await waitFor(async () => (await main.textContent('#title')) === 'Home', 'Home title');
  assert.match(await main.textContent('#content'), /Get started/);
});

async function askVia(text, { typed = false } = {}) {
  await ev((t) => global.__relay.ask.onShortcut(t ? 'type' : 'ask', t ? 'press' : 'tap'), typed);
  await waitFor(async () => (await askState()) === 'input', 'pill input state');
  const pill = await pillPage();
  await pill.waitForSelector('#in');
  await pill.fill('#in', text);
  return pill;
}

await step('tap shortcut opens the pill, Enter runs the agent and the reply lands in history', async () => {
  const pill = await askVia('What apps do I have open?');
  await pill.screenshot({ path: path.join(shots, 'e2e-pill-input.png') });
  await pill.press('#in', 'Enter');
  await waitFor(async () => (await askState()) === 'done', 'done state');
  await pill.screenshot({ path: path.join(shots, 'e2e-pill-done.png') });
  const h = await hist();
  assert.equal(h[0].status, 'done');
  assert.equal(h[0].reply, 'You have 3 apps open: Claude, Finder and Firefox.');
  assert.match(calls(), /osascript .*get name of \(processes/);
  await ev(() => global.__relay.ask.close());
});

await step('system prompt reaches the model with frontmost app and tools', async () => {
  const first = modelCalls[0];
  assert.match(first.messages[0].content, /Frontmost app when the request started: Finder/);
  assert.ok(first.tools.some((t) => t.function.name === 'open_app'));
  assert.ok(!first.tools.some((t) => t.function.name === 'screenshot'), 'non-vision model must not get screenshot');
});

await step('opening an app runs the open command', async () => {
  const pill = await askVia('Open Notes.');
  await pill.press('#in', 'Enter');
  await waitFor(async () => (await askState()) === 'done', 'done');
  assert.match(calls(), /open -a Notes/);
  await ev(() => global.__relay.ask.close());
});

await step('sending a message asks for confirmation; Allow runs it', async () => {
  const pill = await askVia('Text mom running late');
  await pill.press('#in', 'Enter');
  await waitFor(async () => (await askState()) === 'confirm', 'confirm state');
  await pill.waitForSelector('#yes');
  assert.match(await pill.textContent('.q'), /Send "running late" to \+13055550100\?/);
  await pill.screenshot({ path: path.join(shots, 'e2e-pill-confirm.png') });
  assert.ok(!/send "running late"/i.test(calls()), 'must not send before approval');
  await pill.click('#yes');
  await waitFor(async () => (await askState()) === 'done', 'done');
  assert.match(calls(), /send "running late" to b/);
  await ev(() => global.__relay.ask.close());
});

await step('declining a confirmation does not send', async () => {
  fs.writeFileSync(log, '');
  const pill = await askVia('Text mom running late');
  await pill.press('#in', 'Enter');
  await waitFor(async () => (await askState()) === 'confirm', 'confirm state');
  await pill.click('#no');
  await waitFor(async () => (await askState()) === 'done', 'done');
  assert.ok(!/send "running late"/i.test(calls()));
  await ev(() => global.__relay.ask.close());
});

await step('Stop cancels a request the model never answers', async () => {
  const pill = await askVia('Slow request');
  await pill.press('#in', 'Enter');
  await waitFor(async () => (await askState()) === 'working', 'working state');
  await pill.waitForSelector('#stop');
  await pill.screenshot({ path: path.join(shots, 'e2e-pill-working.png') });
  await pill.click('#stop');
  await waitFor(async () => (await askState()) === 'done', 'done after stop');
  assert.equal((await hist())[0].status, 'stopped');
  await ev(() => global.__relay.ask.close());
});

await step('tap while working stops it via the shortcut', async () => {
  const pill = await askVia('Slow request');
  await pill.press('#in', 'Enter');
  await waitFor(async () => (await askState()) === 'working', 'working');
  await ev(() => global.__relay.ask.onShortcut('ask', 'tap'));
  await waitFor(async () => (await askState()) === 'done', 'done');
  assert.equal((await hist())[0].status, 'stopped');
  await ev(() => global.__relay.ask.close());
});

await step('routine recording: start, run a step, save it, then run it by name', async () => {
  fs.writeFileSync(log, '');
  let pill = await askVia('Start a routine.');
  await pill.press('#in', 'Enter');
  await waitFor(async () => (await askState()) === 'done', 'done');
  await ev(() => global.__relay.ask.close());

  pill = await askVia('Open calendar');
  await pill.press('#in', 'Enter');
  await waitFor(async () => (await askState()) === 'done', 'done');
  await ev(() => global.__relay.ask.close());

  pill = await askVia('Save it as start my day.');
  await pill.press('#in', 'Enter');
  await waitFor(async () => (await askState()) === 'done', 'done');
  await ev(() => global.__relay.ask.close());
  const routines = await ev(() => global.__relay.store.get('routines'));
  assert.deepEqual(routines.map((r) => [r.name, r.steps]), [['start my day', ['Open calendar']]]);

  fs.writeFileSync(log, '');
  const before = modelCalls.length;
  pill = await askVia('Start my day.');
  await pill.press('#in', 'Enter');
  await waitFor(async () => (await askState()) === 'done', 'done');
  assert.match(calls(), /open -a Calendar/);
  assert.ok(modelCalls.length > before, 'routine step went through the agent');
  await ev(() => global.__relay.ask.close());
});

await step('"actions off" setting types text instead of acting', async () => {
  await ev(() => global.__relay.store.set('settings.actEnabled', false));
  fs.writeFileSync(log, '');
  const before = modelCalls.length;
  const pill = await askVia('Hello there');
  await pill.press('#in', 'Enter');
  await waitFor(async () => (await askState()) === 'idle', 'idle');
  await new Promise((r) => setTimeout(r, 500));
  assert.equal(modelCalls.length, before, 'no model call when actions are off');
  assert.match(calls(), /keystroke "v" using \{command down\}/);
  await ev(() => global.__relay.store.set('settings.actEnabled', true));
});

await step('missing API key surfaces a readable error in the pill', async () => {
  await ev((u) => {
    const s = global.__relay.store;
    s.set('settings.model.provider', 'anthropic');
    s.set('settings.model.anthropicKeyEnc', '');
  });
  const pill = await askVia('Open Notes.');
  await pill.press('#in', 'Enter');
  await waitFor(async () => (await askState()) === 'done', 'done');
  const reply = await pill.textContent('.reply');
  assert.match(reply, /No Anthropic API key/);
  assert.equal((await hist())[0].status, 'failed');
  await ev(() => global.__relay.ask.close());
});

await step('History page lists requests and actions from the real store', async () => {
  await ev(() => global.__relay.openMain('history'));
  await waitFor(async () => (await main.textContent('#title')) === {history:'History',model:'Model',general:'General',shortcuts:'Shortcuts',routines:'Routines'}['history'], 'history page');
  await waitFor(async () => /Open Notes/.test(await main.textContent('#content')), 'history rows');
  await main.click('.tabs button[data-t="actions"]');
  await waitFor(async () => /list_running_apps/.test(await main.textContent('#content')), 'actions list');
  await main.screenshot({ path: path.join(shots, 'e2e-history-actions.png') });
});

await step('Model page: save key stores it encrypted-or-prefixed, never exposed to the renderer', async () => {
  await ev(() => global.__relay.openMain('model'));
  await waitFor(async () => (await main.textContent('#title')) === {history:'History',model:'Model',general:'General',shortcuts:'Shortcuts',routines:'Routines'}['model'], 'model page');
  await main.evaluate(() => window.relay.set('settings.model.provider', 'anthropic'));
  await main.evaluate(() => window.relay.setApiKey('sk-ant-test-123'));
  const state = await main.evaluate(() => window.relay.getState());
  assert.equal(state.hasKey, true);
  assert.ok(!JSON.stringify(state).includes('sk-ant-test-123'));
  assert.equal(state.settings.model.anthropicKeyEnc, undefined);
  const disk = fs.readFileSync(path.join(userData, 'relay.json'), 'utf8');
  await new Promise((r) => setTimeout(r, 400));
  const disk2 = fs.readFileSync(path.join(userData, 'relay.json'), 'utf8');
  assert.ok(/plain:sk-ant-test-123|"anthropicKeyEnc": "[A-Za-z0-9+/=]{20,}"/.test(disk2), 'key persisted');
  void disk;
});

await step('General page toggles round-trip to the store', async () => {
  await ev(() => global.__relay.openMain('general'));
  await waitFor(async () => (await main.textContent('#title')) === {history:'History',model:'Model',general:'General',shortcuts:'Shortcuts',routines:'Routines'}['general'], 'general page');
  await main.waitForSelector('.toggle');
  const before = await ev(() => global.__relay.store.get('settings.cursor'));
  await main.click('.row:has-text("Relay cursor")');
  await waitFor(async () => (await ev(() => global.__relay.store.get('settings.cursor'))) === !before, 'cursor toggle');
  await main.screenshot({ path: path.join(shots, 'e2e-general.png') });
});

await step('Shortcuts page: capture a modifier-only shortcut and a combo', async () => {
  await ev(() => global.__relay.openMain('shortcuts'));
  await waitFor(async () => (await main.textContent('#title')) === {history:'History',model:'Model',general:'General',shortcuts:'Shortcuts',routines:'Routines'}['shortcuts'], 'shortcuts page');
  await main.waitForSelector('.kbd');
  await main.click('.row:has-text("Ask Relay") .kbd');
  await main.keyboard.down('ControlRight');
  await main.keyboard.up('ControlRight');
  await waitFor(async () => (await ev(() => global.__relay.store.get('settings.shortcuts.ask.code'))) === 'ControlRight', 'modifier shortcut saved');
  await main.click('.row:has-text("Type a request") .kbd');
  await main.keyboard.down('Alt');
  await main.keyboard.press('KeyK');
  await main.keyboard.up('Alt');
  await waitFor(async () => (await ev(() => global.__relay.store.get('settings.shortcuts.type.code'))) === 'KeyK', 'combo saved');
  const sc = await ev(() => global.__relay.store.get('settings.shortcuts'));
  assert.deepEqual(sc.type, { code: 'KeyK', mods: ['Alt'] });
  await ev(() => global.__relay.store.set('settings.shortcuts', { ask: { code: 'AltRight', mods: [] }, type: { code: 'KeyT', mods: ['Alt'] } }));
});

await step('shortcuts are suspended while a new one is being recorded', async () => {
  await ev(() => global.__relay.openMain('shortcuts'));
  await waitFor(async () => (await main.textContent('#title')) === 'Shortcuts', 'shortcuts page');
  await main.click('.row:has-text("Ask Relay") .kbd');
  await waitFor(() => ev(() => global.__relay.ask.suspended), 'suspended while capturing');
  await ev(() => global.__relay.ask.onShortcut('ask', 'tap'));
  assert.equal(await askState(), 'idle', 'pill must not open while recording');
  await main.keyboard.press('Escape');
  await waitFor(async () => !(await ev(() => global.__relay.ask.suspended)), 'resumed after Escape');
});

await step('Routines page: create a routine through the editor', async () => {
  await ev(() => global.__relay.openMain('routines'));
  await waitFor(async () => (await main.textContent('#title')) === {history:'History',model:'Model',general:'General',shortcuts:'Shortcuts',routines:'Routines'}['routines'], 'routines page');
  await main.click('#new');
  await main.fill('#rname', 'wind down');
  await main.fill('#rsteps', 'Quit Messages\nSet the volume to 10');
  await main.click('#save');
  await waitFor(async () => (await ev(() => global.__relay.store.get('routines'))).some((r) => r.name === 'wind down'), 'routine saved');
  await main.screenshot({ path: path.join(shots, 'e2e-routines.png') });
});

await step('Firefox bridge: extension origin connects and tools appear', async () => {
  await ev(() => { global.__relay.store.set('settings.firefox.enabled', true); });
  await main.evaluate(() => window.relay.set('settings.firefox.enabled', true));
  const WebSocket = (await import('ws')).default;
  const port = await ev(() => global.__relay.store.get('settings.firefox.port'));
  const ws = await new Promise((resolve, reject) => {
    const s = new WebSocket(`ws://127.0.0.1:${port}`, { origin: 'moz-extension://test' });
    s.on('open', () => resolve(s));
    s.on('error', reject);
  });
  ws.on('message', (d) => { const m = JSON.parse(d); ws.send(JSON.stringify({ id: m.id, result: [{ id: 7, title: 'Example', url: 'https://example.com' }] })); });
  await waitFor(async () => ev(() => global.__relay.bridge.isConnected()), 'bridge connected');
  const r = await ev(() => global.__relay.bridge.call('tabs.list', {}));
  assert.equal(r[0].title, 'Example');
  ws.close();
});

await step('onboarding window renders all steps in the real app', async () => {
  await ev(() => global.__relay.openOnboarding());
  const onb = await waitFor(() => app.windows().find((w) => w.url().includes('onboarding.html')), 'onboarding window');
  await onb.waitForLoadState('domcontentloaded');
  await onb.waitForSelector('.app-icon');
  await onb.screenshot({ path: path.join(shots, 'e2e-onb-welcome.png') });
  await onb.click('#footer .pill-btn:last-child');
  await waitFor(async () => /Pick the model/.test(await onb.textContent('.stage')), 'model step');
});

await app.close();
server.close();
const failed = results.filter((r) => r[0] === 'FAIL');
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (errors.length) console.log('main-process console errors:\n' + errors.slice(0, 8).join('\n'));
process.exit(failed.length ? 1 : 0);
