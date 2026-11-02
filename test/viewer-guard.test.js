const test = require('node:test');
const assert = require('node:assert/strict');
const { ViewerGuard, parseViewerGuardCommand, config } = require('../src/main/viewerGuard');

const tick = () => new Promise((r) => setImmediate(r));
function make(cfg = { enabled: true, seconds: 10, expected: 1 }) {
  const clock = { t: 1e6 }, locks = [], notes = [];
  const g = new ViewerGuard({ lock: async () => { locks.push(clock.t); }, notify: (m) => notes.push(m), getConfig: () => cfg, now: () => clock.t });
  const feed = (faces, secs = 1) => { let last = null; for (let i = 0; i < secs; i++) { clock.t += 1000; last = g.frame({ faces }) || last; } return last; };
  return { g, clock, locks, notes, feed, cfg };
}

test('it is off unless you turn it on, and settings are kept within sane limits', () => {
  const m = make({ enabled: false });
  assert.equal(m.feed(3, 60), null); assert.deepEqual(m.locks, []);
  assert.deepEqual(config({ enabled: true, seconds: 1, expected: 99 }), { enabled: true, seconds: 3, expected: 5 });
  assert.deepEqual(config({ enabled: 'yes' }), { enabled: false, seconds: 10, expected: 1 }, 'only a real true turns it on');
  assert.deepEqual(config(null), { enabled: false, seconds: 10, expected: 1 });
});

test('one passing face is ignored; a second face that stays starts a countdown, with a warning', () => {
  const m = make();
  assert.equal(m.feed(1, 5), null);
  assert.equal(m.feed(2), null, 'a single crowded frame is not enough');
  assert.equal(m.feed(1), null);
  assert.equal(m.feed(2, 2), 'countdown');
  assert.equal(m.notes.length, 1); assert.match(m.notes[0], /Locking the screen in 10 seconds/);
  assert.equal(m.g.secondsLeft(), 10);
});

test('the Mac locks when the countdown ends, once, and not again while the extra face stays', async () => {
  const m = make();
  m.feed(2, 2);
  m.feed(2, 8); assert.deepEqual(m.locks, []);
  assert.equal(m.feed(2, 3), 'locked'); await tick();
  assert.equal(m.locks.length, 1);
  m.feed(2, 120); await tick();
  assert.equal(m.locks.length, 1, 'it does not lock again and again');
  m.feed(1, 5); m.feed(2, 2); m.feed(2, 12); await tick();
  assert.equal(m.locks.length, 2, 'after things were normal for a while it can guard again');
});

test('if the extra person leaves before the end, nothing locks', async () => {
  const m = make();
  m.feed(2, 2); m.feed(2, 4);
  assert.equal(m.feed(1, 3), 'cancelled');
  m.feed(1, 30); await tick();
  assert.deepEqual(m.locks, []); assert.equal(m.g.secondsLeft(), null);
});

test('"it\'s fine" pauses the guard for 30 minutes and then it works again', async () => {
  const m = make();
  m.feed(2, 2); m.g.snooze(30);
  assert.equal(m.feed(2, 60), null); assert.deepEqual(m.locks, []);
  m.clock.t += 31 * 60000;
  m.feed(2, 2); m.feed(2, 11); await tick();
  assert.equal(m.locks.length, 1);
});

test('the expected number of faces can be raised, and turning the setting off in the middle stops a countdown', async () => {
  const m = make({ enabled: true, seconds: 5, expected: 2 });
  assert.equal(m.feed(2, 30), null); assert.deepEqual(m.locks, []);
  m.feed(3, 2); assert.equal(m.g.state, 'countdown');
  m.cfg.enabled = false; m.feed(3, 10); await tick();
  assert.deepEqual(m.locks, []); assert.equal(m.g.state, 'watching');
});

test('a lock that fails is reported rather than swallowed', async () => {
  const notes = []; let t = 0;
  const g = new ViewerGuard({ lock: async () => { throw Error('denied'); }, notify: (m) => notes.push(m), getConfig: () => ({ enabled: true, seconds: 3 }), now: () => (t += 1000) });
  for (let i = 0; i < 10; i++) g.frame({ faces: 2 });
  await tick(); await tick();
  assert.match(notes[notes.length - 1], /Could not lock the Mac/);
});

test('voice commands: on, off and "it\'s fine"; ordinary talk is left alone', () => {
  for (const [t, want] of [['turn on the viewer guard', 'on'], ['Jarvis, enable shoulder surfing protection', 'on'], ['viewer guard off', 'off'], ['turn off the second viewer guard', 'off'], ["it's fine", 'snooze'], ['pause the viewer guard', 'snooze']]) assert.deepEqual(parseViewerGuardCommand(t), { type: want }, t);
  for (const t of ['lock my screen', 'turn on the lights', 'its raining', 'what is a viewer', '']) assert.equal(parseViewerGuardCommand(t), null, t);
});
