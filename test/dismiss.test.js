const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const { parseDismiss, shouldHoldAnswer } = require('../src/main/dismiss');

test('the words that put an answer away, and real requests are not among them', () => {
  for (const t of ['ok', 'Okay.', 'OK thanks', 'thanks', 'Thank you!', 'got it', "that's all", 'Jarvis, okay', 'hey jarvis ok', 'close', 'dismiss it', 'never mind', 'cool']) assert.equal(parseDismiss(t), true, t);
  for (const t of ['what time is it', 'ok play some music', 'open notes', 'okay what about tomorrow', 'close the safari window', 'pause', '']) assert.equal(parseDismiss(t), false, t);
});

test('an answer is held when the model made it or it is a sentence, not for short command replies, the phone, schedules or a running quiz', () => {
  assert.equal(shouldHoldAnswer({ reply: 'It is 72 degrees and sunny in Hollywood, with a light breeze from the east.', status: 'done' }), true);
  assert.equal(shouldHoldAnswer({ reply: 'Sunny.', status: 'done', model: 'haiku' }), true, 'worked out by the model');
  assert.equal(shouldHoldAnswer({ reply: 'Paused.', status: 'done' }), false);
  assert.equal(shouldHoldAnswer({ reply: 'Volume 40%.', status: 'done' }), false);
  assert.equal(shouldHoldAnswer({ reply: 'x'.repeat(80), status: 'done', remote: 'r1' }), false, 'asked from the phone');
  assert.equal(shouldHoldAnswer({ reply: 'x'.repeat(80), status: 'done', unattended: true }), false);
  assert.equal(shouldHoldAnswer({ reply: 'x'.repeat(80), status: 'done', busy: true }), false);
  assert.equal(shouldHoldAnswer({ reply: 'x'.repeat(80), status: 'done', setting: false }), false, 'switched off');
  assert.equal(shouldHoldAnswer({ reply: 'Stopped.', status: 'stopped', model: 'haiku' }), false);
  assert.equal(shouldHoldAnswer({ reply: '', status: 'done' }), false);
});

test('saying ok while an answer is held closes it silently, and only then', async () => {
  const real = Module._load;
  Module._load = function (req, ...rest) { return req === 'electron' ? { app: {}, screen: { getPrimaryDisplay: () => ({ size: { width: 1440, height: 900 } }) }, BrowserWindow: class {}, ipcMain: {}, Notification: class {}, systemPreferences: {}, desktopCapturer: {}, clipboard: {}, shell: {} } : real.call(this, req, ...rest); };
  let AskController;
  try { ({ AskController } = require('../src/main/askController')); } finally { Module._load = real; }
  const log = [];
  const c = Object.create(AskController.prototype);
  Object.assign(c, { ensureWindow() {}, runningTask: null, holdAnswer: true, state: 'done', followFor: 'x', speaker: { stop: () => log.push('speaker') }, cardPanel: { hide: () => log.push('card') }, close() { log.push('close'); this.holdAnswer = false; } });
  const r = await c.handleText('okay');
  assert.deepEqual(r, { status: 'done', reply: '', actions: 0, dismissed: true });
  assert.deepEqual(log, ['speaker', 'card', 'close']);
  assert.equal(c.followFor, null, 'no more listening for a follow-up');
  assert.equal(c.holdAnswer, false);
  // nothing held: "ok" is an ordinary request and goes on to the normal path (which here has nothing set up, so it throws)
  const d = Object.create(AskController.prototype);
  Object.assign(d, { ensureWindow() {}, runningTask: null, holdAnswer: false });
  await assert.rejects(() => d.handleText('okay'));
});
