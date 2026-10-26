const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const real = Module._load;
Module._load = function (req, ...rest) { return req === 'electron' ? { app: {}, screen: {}, BrowserWindow: class {}, ipcMain: {}, Notification: class {}, systemPreferences: {}, desktopCapturer: {}, clipboard: {}, shell: {}, safeStorage: { isEncryptionAvailable: () => false } } : real.call(this, req, ...rest); };
let AskController;
try { ({ AskController } = require('../src/main/askController')); } finally { Module._load = real; }

test('no connectors connected means no connector tools', () => {
  const c = Object.create(AskController.prototype);
  c.store = { get: (k) => (k === 'settings.connectors' ? { notion: { tokenEnc: '' }, google: { clientId: '', accounts: [] } } : null) };
  assert.deepEqual(c.connectorTools(), []);
});

test('a Google client with an account adds the Gmail and Calendar tools', () => {
  const c = Object.create(AskController.prototype);
  const data = { 'settings.connectors': { notion: {}, google: { clientId: 'cid', accounts: [{ email: 'a@gmail.com', refreshEnc: 'x' }] } } };
  c.store = { get: (k) => data[k] };
  const names = c.connectorTools().map((t) => t.name);
  assert.ok(['gmail_search', 'gmail_read', 'gmail_draft', 'gmail_send', 'gcal_events', 'gcal_create'].every((n) => names.includes(n)));
});
