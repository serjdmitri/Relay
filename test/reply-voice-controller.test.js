const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const original = Module._load;
Module._load = function (name, ...args) {
  return name === 'electron' ? { app: {}, screen: {}, BrowserWindow: class {}, ipcMain: {}, Notification: class {}, systemPreferences: {}, desktopCapturer: {}, clipboard: {}, shell: {} } : original.call(this, name, ...args);
};
let AskController;
try { ({ AskController } = require('../src/main/askController')); } finally { Module._load = original; }

test('completed spoken requests speak, typed requests stay silent', () => {
  for (const byVoice of [true, false]) {
    const spoken = [];
    const c = Object.create(AskController.prototype);
    Object.assign(c, {
      voiceAsk: byVoice, state: 'working', queue: [], tasks: [],
      store: { get: (key) => key === 'settings.speakReplies' ? true : key === 'settings' ? {} : key === 'settings.answerStays' ? false : null, set() {}, addHistory() {} },
      speaker: { speak: (text) => spoken.push(text) }, overlay: { endRequest() {}, workDone() {} },
      onChange() {}, push() {}, sound() {}, followUpSoon() {}, close() {},
    });
    c.finish({ id: 'x', text: 'hello', ts: Date.now() }, { status: 'done', reply: 'Hello, Sir.' });
    clearTimeout(c.doneTimer);
    assert.deepEqual(spoken, byVoice ? ['Hello, Sir.'] : []);
  }
});
