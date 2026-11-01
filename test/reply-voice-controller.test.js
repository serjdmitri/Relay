const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const original = Module._load;
Module._load = function (name, ...args) {
  return name === 'electron' ? { app: {}, screen: {}, BrowserWindow: class {}, ipcMain: {}, Notification: class {}, systemPreferences: {}, desktopCapturer: {}, clipboard: {}, shell: {} } : original.call(this, name, ...args);
};
let AskController;
try { ({ AskController } = require('../src/main/askController')); } finally { Module._load = original; }

test('spoken answers and failures are spoken, while typed requests and stopped work stay silent', () => {
  for (const [byVoice, status] of [[true, 'done'], [true, 'failed'], [true, 'stopped'], [false, 'done'], [false, 'failed']]) {
    const spoken = [];
    const c = Object.create(AskController.prototype);
    Object.assign(c, {
      voiceAsk: byVoice, state: 'working', queue: [], tasks: [],
      store: { get: (key) => key === 'settings.speakReplies' ? true : key === 'settings' ? {} : key === 'settings.answerStays' ? false : null, set() {}, addHistory() {} },
      speaker: { speak: (text) => spoken.push(text) }, overlay: { endRequest() {}, workDone() {} },
      onChange() {}, push() {}, sound() {}, followUpSoon() {}, close() {},
    });
    c.finish({ id: 'x', text: 'hello', ts: Date.now() }, { status, reply: 'Hello, Sir.' });
    clearTimeout(c.doneTimer);
    assert.deepEqual(spoken, byVoice && status !== 'stopped' ? ['Hello, Sir. Anything else, Sir?'] : [], `${status}, voice=${byVoice}`);
  }
});

test('yes listens again and no closes only during a spoken follow-up', async () => {
  for (const [text, expected] of [['no thank you', 'close'], ['yes', 'listen'], ['open Notes', 'command']]) {
    const c = Object.create(AskController.prototype);
    const calls = [];
    Object.assign(c, { state: 'input', awaitingFollowAnswer: true, runningTask: null,
      store: { get: () => true }, close: () => calls.push('close'),
      listen: () => calls.push('listen'), handleText: () => calls.push('command') });
    await c.submit(text, { voice: true });
    assert.deepEqual(calls, [expected]);
  }
});

test('a follow-up containing a request is not mistaken for a bare no', () => {
  const { followUpAnswer, spokenReply } = require('../src/main/conversation');
  assert.equal(followUpAnswer('No, open Notes'), null);
  assert.equal(followUpAnswer('no thank you'), 'no');
  assert.equal(spokenReply('Opened Notes.', true), 'I have opened Notes for you, Sir. Anything else, Sir?');
});

test('replaying a reply uses the selected voice and does not rearm follow-up', () => {
  const c = Object.create(AskController.prototype), calls = [];
  Object.assign(c, { followFor: 'old', store: { get: k => k === 'lastReply' ? 'Opened Notes.' : {} }, speaker: { speak: (...args) => calls.push(args) } });
  assert.equal(c.speakLastReply(), true);
  assert.equal(c.followFor, null);
  assert.equal(calls[0][0], 'Opened Notes.');
  assert.equal(calls[0][1].lang, 'en');
  c.store.get = () => '';
  assert.equal(c.speakLastReply(), false);
});

test('wake greeting finishes before the microphone opens and can be dismissed', async () => {
  for (const dismissed of [false, true]) {
    const calls = [];
    const c = Object.create(AskController.prototype);
    Object.assign(c, { state: 'idle', wake: { disarm: () => calls.push('disarm'), refresh() {}, canListen: () => false },
      store: { get: k => k === 'settings.speakReplies' ? true : {} },
      ensureWindow() {}, ready: Promise.resolve(), reveal: () => calls.push('show'),
      speaker: { speak: async text => { calls.push(text); if (dismissed) c.state = 'idle'; } },
      listen: async () => calls.push('listen') });
    await c.wakeTriggered();
    assert.deepEqual(calls, dismissed ? ['disarm', 'show', 'Yes, Sir.'] : ['disarm', 'show', 'Yes, Sir.', 'listen']);
  }
});

test('idle reactor shortcut toggles only when the assistant is idle', () => {
  const c = Object.create(AskController.prototype), events = [];
  Object.assign(c, { state: 'idle', suspended: false, store: { get: () => 'center' }, overlay: { hud: x => events.push(x), buddy() {} } });
  c.onShortcut('reactorIdle', 'press');
  c.onShortcut('reactorIdle', 'press');
  c.state = 'working';
  c.onShortcut('reactorIdle', 'press');
  assert.deepEqual(events, [{ state: 'reactor-idle', idlePosition: 'center' }, { hide: true }]);
});

test('tapped ask uses silence detection unless disabled; holding remains manual', () => {
  for (const [enabled, kind, auto] of [[true, 'tap', true], [false, 'tap', false], [true, 'hold-start', false]]) {
    const c = Object.create(AskController.prototype), calls = [];
    Object.assign(c, { state: 'idle', suspended: false, store: { get: key => key === 'settings.autoSend.enabled' ? enabled : 'tap-or-hold' }, listen: (...a) => calls.push(a) });
    c.onShortcut('ask', kind);
    assert.equal(calls[0][2].auto, auto);
  }
});
