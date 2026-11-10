const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const { OmniVoice } = require('../src/main/tts/omnivoice');
const { AskController } = require('../src/main/askController');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('the voice model knows how long it has been idle and can be unloaded; the next reply starts it again', async () => {
  const o = new OmniVoice({ python: '/nope/python' });
  assert.equal(o.idleMs(), Infinity, 'never used'); assert.equal(o.unload(), false, 'nothing running, nothing to unload');
  let killed = 0; o.child = { kill: () => { killed++; } };
  assert.equal(o.unload(), true); assert.equal(killed, 1);
  await assert.rejects(o.synthesize('x', { background: false }), /not installed/); // not installed here, but the call is the one that marks use
  const mk = () => { const v = new OmniVoice({ python: process.execPath, worker: process.execPath, timeoutMs: 20 }); v.child = { kill() {}, stdin: { write() {} } }; v.start = () => {}; v.dispatch = () => {}; return v; }; // no real voice process; the request gives up after 20 ms
  const fake = mk(), before = Date.now();
  await fake.synthesize('hello there', { background: false }).catch(() => {});
  assert.ok(fake.idleMs() < 1000 && fake.lastUsed >= before, 'a real reply marks the time');
  const bg = mk(); await bg.synthesize('warm up', { background: true }).catch(() => {}); assert.equal(bg.idleMs(), Infinity, 'warming up does not count as use');
});

test('unplugged, the local model is kept for 5 minutes instead of 30, unless you chose; plugged in or switched off, 30', () => {
  const mk = (settings) => { const c = Object.create(AskController.prototype); Object.assign(c, { store: { get: (k) => settings[k] } }); return c; };
  assert.equal(mk({ 'settings.model': {} }).localKeepAlive(), '30m', 'no power information in a test: the long one');
  assert.equal(mk({ 'settings.model': { ollamaKeepAlive: '2h' } }).localKeepAlive(), '2h', 'your choice wins');
  const Module = require('node:module'), real = Module._load;
  Module._load = function (name, ...a) { return name === 'electron' ? { powerMonitor: { isOnBatteryPower: () => true } } : real.call(this, name, ...a); };
  try {
    assert.equal(mk({ 'settings.model': {} }).localKeepAlive(), '5m'); assert.equal(mk({ 'settings.model': {}, 'settings.batterySaver': false }).localKeepAlive(), '30m', 'saver off');
    assert.equal(mk({ 'settings.model': { ollamaKeepAlive: '1h' } }).localKeepAlive(), '1h');
  } finally { Module._load = real; }
});

test('main.js: unplugged the voice is not pre-loaded and is unloaded after five idle minutes; the goodbyes are made ahead in the Jarvis voice; the setting is on by default with a switch', () => {
  const main = read('src/main/main.js');
  assert.match(main, /settings\.tts\.engine'\) === 'omnivoice' && !saveBattery\(\)\) omni\.warm\(\)/); assert.match(main, /saveBattery\(\) && omni\.idleMs\(\) > 5 \* 60000 && omni\.unload\(\)/);
  assert.match(main, /'Goodbye, Sir\.','See you later, Sir\.','Good night, Sir\.','Very good, Sir\. Goodbye\.'/);
  assert.match(read('src/main/store.js'), /batterySaver: true/); assert.match(read('src/renderer/app.js'), /toggleRow\('Save battery when unplugged'/);
  const ask = read('src/main/askController.js'); assert.ok(!/keepAlive: m\.ollamaKeepAlive \|\| '30m'/.test(ask), 'every local provider uses the battery-aware value'); assert.ok((ask.match(/keepAlive: this\.localKeepAlive\(\)/g) || []).length >= 4);
});
