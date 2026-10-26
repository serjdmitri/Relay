const { test } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

// askController.js imports electron; only interruptSpeech is under test here.
const real = Module._load;
Module._load = function (req, ...rest) { return req === 'electron' ? { app: {}, screen: {}, BrowserWindow: class {}, ipcMain: {}, Notification: class {}, systemPreferences: {} } : real.call(this, req, ...rest); };
let AskController;
try { ({ AskController } = require('../src/main/askController')); } finally { Module._load = real; }

test('interruptSpeech stops a voice that is talking, and says so', () => {
  let stopped = 0;
  const self = { speaker: { speaking: true, stop: () => stopped++ } };
  assert.equal(AskController.prototype.interruptSpeech.call(self), true);
  assert.equal(stopped, 1);
});

test('interruptSpeech does nothing when it is quiet', () => {
  let stopped = 0;
  assert.equal(AskController.prototype.interruptSpeech.call({ speaker: { speaking: false, stop: () => stopped++ } }), false);
  assert.equal(AskController.prototype.interruptSpeech.call({}), false);
  assert.equal(stopped, 0);
});
