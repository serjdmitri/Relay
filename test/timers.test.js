const test = require('node:test');
const assert = require('node:assert/strict');
const { Timers, humanDuration } = require('../src/main/timers');

function harness(initial = []) {
  let t = 1_000_000;
  const store = { data: { timers: initial }, get: (k) => store.data[k.replace('timers', 'timers')], save() {} };
  const queue = [];
  const fired = [];
  const timers = new Timers({
    store, now: () => t, onFire: (x) => fired.push(x),
    setTimer: (fn, ms) => { const h = { fn, at: t + ms, live: true }; queue.push(h); return h; },
    clearTimer: (h) => { if (h) h.live = false; }
  });
  const advance = (ms) => { t += ms; queue.filter((h) => h.live && h.at <= t).forEach((h) => { h.live = false; h.fn(); }); };
  return { timers, fired, advance, store };
}

test('a timer fires once, at its time, and is removed', () => {
  const { timers, fired, advance, store } = harness();
  timers.add(300, 'pasta');
  advance(299_000);
  assert.equal(fired.length, 0);
  advance(2_000);
  assert.deepEqual(fired.map((f) => [f.label, f.missed]), [['pasta', false]]);
  assert.equal(store.data.timers.length, 0);
});

test('listing, remaining time and cancelling', () => {
  const { timers, advance } = harness();
  const a = timers.add(600, 'a');
  timers.add(60, 'b');
  assert.deepEqual(timers.list().map((t) => t.label), ['b', 'a']);
  advance(30_000);
  assert.equal(timers.remainingSeconds(timers.list()[0]), 30);
  assert.equal(timers.cancel(a.id), true);
  assert.equal(timers.cancelAll(), 1);
  assert.equal(timers.list().length, 0);
});

test('timers saved before a restart are rescheduled, and overdue ones fire as missed', () => {
  const { timers, fired } = harness([{ id: 'x', endsAt: 1_000_000 - 5000, seconds: 60, label: 'late' }, { id: 'y', endsAt: 1_000_000 + 60_000, seconds: 60, label: 'soon' }]);
  timers.start();
  assert.deepEqual(fired.map((f) => [f.label, f.missed]), [['late', true]]);
  assert.equal(timers.list().length, 1);
});

test('human durations', () => {
  assert.equal(humanDuration(45), '45 seconds');
  assert.equal(humanDuration(60), '1 minute');
  assert.equal(humanDuration(300), '5 minutes');
  assert.equal(humanDuration(5400), '1 hour 30 minutes');
  assert.equal(humanDuration(90), '1 minute 30 seconds');
});
