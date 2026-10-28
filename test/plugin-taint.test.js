const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');


const real = Module._load;
Module._load = function (req, ...rest) { return req === 'electron' ? { app: {}, screen: {}, BrowserWindow: class {}, ipcMain: {}, Notification: class {}, systemPreferences: {}, desktopCapturer: {}, clipboard: {}, shell: {} } : real.call(this, req, ...rest); };
let AskController;
try { ({ AskController } = require('../src/main/askController')); } finally { Module._load = real; }
test('once a plugin has answered, sending, deleting and running commands ask first; normal requests are unchanged', () => {
  const c = Object.create(AskController.prototype);
  const mk = (name, confirm) => ({ name, description: name, input_schema: {}, run: async () => 'ok', ...(confirm ? { confirm } : {}) });
  Object.assign(c, { store: { get: (k) => (k === 'settings' ? { homeOnly: false, flags: {} } : k === 'settings.homeOnly' ? false : undefined) }, baseTools: () => [mk('run_shell'), mk('messages_send', () => 'Send it?'), mk('open_app')], connectorTools: () => [], pluginTools: () => [], tainted: false });
  const t = c.makeTools();
  const by = (n) => t.find((x) => x.name === n);
  assert.equal(by('run_shell').confirm({}), null, 'a normal request: as before');
  assert.equal(by('open_app').confirm?.({}) ?? null, null);
  c.tainted = true;
  assert.match(by('run_shell').confirm({}), /read output from a plugin/);
  assert.equal(by('messages_send').confirm({}), 'Send it?', 'its own question wins');
  assert.equal(by('open_app').confirm?.({}) ?? null, null, 'harmless tools are not slowed down');
  c.tainted = false;
  assert.equal(by('run_shell').confirm({}), null);
});
