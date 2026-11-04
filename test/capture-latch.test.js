const test = require('node:test');
const assert = require('node:assert/strict');
const { CaptureLatch } = require('../src/main/captureLatch');

function fake() {
  const timers = []; const calls = [];
  const latch = new CaptureLatch({ onChange: (v) => calls.push(v), maxMs: 1000, setTimer: (fn, ms) => { const t = { fn, ms, cancelled: false }; timers.push(t); return t; }, clearTimer: (t) => { if (t) t.cancelled = true; } });
  const fire = () => { for (const t of timers.splice(0)) if (!t.cancelled) t.fn(); };
  return { latch, calls, fire, timers };
}

test('recording a shortcut pauses the shortcuts, and finishing it resumes them', () => {
  const { latch, calls } = fake();
  latch.set(true); latch.set(true); latch.set(false);
  assert.deepEqual(calls, [true, false]);
  assert.equal(latch.on, false);
});

test('a recording that is never finished expires, so shortcuts and "Hey Jarvis" cannot stay dead', () => {
  const { latch, calls, fire } = fake();
  latch.set(true);
  fire();
  assert.equal(latch.on, false);
  assert.deepEqual(calls, [true, false]);
});

test('closing the window clears it, and a finished recording leaves no timer to fire later', () => {
  const { latch, calls, fire } = fake();
  latch.set(true); latch.clear(); fire();
  assert.deepEqual(calls, [true, false]);
  latch.set(true); latch.set(false); fire();
  assert.deepEqual(calls, [true, false, true, false]);
});

test('repeating the on signal keeps a single timer', () => {
  const { latch, timers } = fake();
  latch.set(true); latch.set(true);
  assert.equal(timers.filter((t) => !t.cancelled).length, 1);
});
