const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const original = Module._load;
let available = true;
const safeStorage = { isEncryptionAvailable: () => available, encryptString: s => Buffer.from(`sealed:${s}`), decryptString: b => b.toString().replace(/^sealed:/, '') };
Module._load = function (name, ...args) {
  return name === 'electron' ? { app: {}, screen: {}, BrowserWindow: class {}, ipcMain: {}, Notification: class {}, systemPreferences: {}, desktopCapturer: {}, clipboard: {}, shell: {}, safeStorage } : original.call(this, name, ...args);
};
let encryptKey, decryptKey;
try { ({ encryptKey, decryptKey } = require('../src/main/askController')); } finally { Module._load = original; }
test('new secrets require encryption but old plain credentials remain readable', () => {
  available = true;
  const encrypted = encryptKey('example-secret');
  assert.notEqual(encrypted, 'plain:example-secret');
  assert.equal(decryptKey(encrypted), 'example-secret');
  available = false;
  assert.throws(() => encryptKey('example-secret'), /secure storage is unavailable/);
  assert.equal(encryptKey(''), '');
  assert.equal(decryptKey('plain:legacy-secret'), 'legacy-secret');
});
