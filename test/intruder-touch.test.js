const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

// The alarm screen's Touch ID: the system sheet comes up by itself when the alarm starts, so touching the sensor stops it with no button to click first.
const orig = Module._load;
Module._load = function (req, ...a) { return req === 'electron' ? { BrowserWindow: class {}, screen: {}, ipcMain: { handle() {} } } : orig.call(this, req, ...a); };
let IntruderWindow;
try { ({ IntruderWindow } = require('../src/main/intruderWindow')); } finally { Module._load = orig; }

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
function make({ touch = true, result = { ok: true } } = {}) {
  const calls = [];
  const w = new IntruderWindow({ touchId: () => touch, autoDelayMs: 5, fingerprint: async () => { calls.push('prompt'); if (result instanceof Error) throw result; return result; } });
  w.open = () => calls.push('open'); w.hold = () => calls.push('hold'); w.release = () => calls.push('release');
  return { w, calls };
}

test('the Touch ID sheet comes up by itself shortly after the alarm starts, once, with the alarm stepping aside', async () => {
  const { w, calls } = make();
  w.show({ seconds: 20 });
  assert.deepEqual(calls, ['open'], 'not at the very start: the screen shows first');
  await wait(40);
  assert.deepEqual(calls, ['open', 'hold', 'prompt']);
  await wait(40); assert.equal(calls.filter((c) => c === 'prompt').length, 1, 'only once for one alarm');
  assert.equal(w.busy, false);
});

test('a cancelled or refused fingerprint brings the alarm back, and it does not nag with another sheet', async () => {
  const { w, calls } = make({ result: new Error('Cancelled.') });
  w.show({ seconds: 20 });
  await wait(40);
  assert.deepEqual(calls, ['open', 'hold', 'prompt', 'release']);
  await wait(40); assert.equal(calls.filter((c) => c === 'prompt').length, 1);
  const again = await w.askFingerprint(); assert.equal(again.ok, false); assert.equal(again.error, 'Cancelled.', 'the button still works and says why it failed');
});

test('no sheet when this Mac has no Touch ID, on the calm away screen, after the alarm ended, or while one sheet is already up', async () => {
  const none = make({ touch: false }); none.w.show({ seconds: 20 }); await wait(40); assert.ok(!none.calls.includes('prompt'));
  const away = make(); away.w.showAway(); await wait(40); assert.ok(!away.calls.includes('prompt'), 'the away screen waits for your face, not a fingerprint sheet');
  const gone = make(); gone.w.show({ seconds: 20 }); gone.w.hide(); await wait(40); assert.ok(!gone.calls.includes('prompt'), 'hiding the alarm cancels the pending sheet');
  const busy = make(); busy.w.state = { active: true, mode: 'alarm' }; busy.w.busy = true; assert.deepEqual(await busy.w.askFingerprint(), { ok: false }); assert.ok(!busy.calls.includes('prompt'));
  const idle = make(); assert.deepEqual(await idle.w.askFingerprint(), { ok: false }, 'nothing to stop when there is no alarm'); assert.deepEqual(idle.calls, []);
});

test('an accepted fingerprint reports ok and leaves the alarm to be cleared by the guard', async () => {
  const { w, calls } = make({ result: { ok: true } });
  w.state = { active: true, mode: 'alarm', touchId: true };
  assert.deepEqual(await w.askFingerprint(), { ok: true });
  assert.deepEqual(calls, ['hold', 'prompt'], 'no release: the guard hides the alarm itself');
});
