const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');


const real = Module._load;
Module._load = function (req, ...rest) { return req === 'electron' ? { app: {}, screen: {}, BrowserWindow: class {}, ipcMain: {}, Notification: class {}, systemPreferences: {}, desktopCapturer: {}, clipboard: {}, shell: {} } : real.call(this, req, ...rest); };
let AskController;
try { ({ AskController } = require('../src/main/askController')); } finally { Module._load = real; }
function rig(offline = true) {
  const c = Object.create(AskController.prototype);
  Object.assign(c, { offline, store: { get: (k) => (k === 'settings' ? { flags: { offline: true } } : k === 'settings.model' ? { ollamaUrl: 'http://127.0.0.1:1', ollamaModel: 'm' } : undefined) } });
  return c;
}

test('offline: a request that needs the Mac or the web waits, without trying a model', async () => {
  const r = await rig().execute('open Safari and search for pizza', 'r1');
  assert.match(r.reply, /needs the internet/);
  assert.equal(r.status, 'done');
});

test('offline: plain conversation goes to the local model, and a missing one is explained', async () => {
  const realFetch = global.fetch;
  try {
    global.fetch = async () => { throw new Error('refused'); };
    assert.match((await rig().execute('who wrote Othello', 'r2')).reply, /no local model is running/);
    global.fetch = async (url, init) => ({ ok: true, json: async () => ({ message: { content: 'Shakespeare.' } }), text: async () => '' });
    assert.match((await rig().execute('who wrote Othello', 'r3')).reply, /Shakespeare/);
  } finally { global.fetch = realFetch; }
});
