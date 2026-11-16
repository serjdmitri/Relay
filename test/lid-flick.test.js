const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { LidFlickDetector, LidSensor, LidFlick } = require('../src/main/lidFlick');

// ---- fake lid angles ----
// The lid sits still at `angle` for `ms` (the helper reports a still lid about once a second, and the first still sample is at the start).
const still = (angle, from, ms, step = 500) => { const out = []; for (let t = from; t <= from + ms; t += step) out.push([angle, t]); return out; };
// A smooth move from `a` to `b` over `ms`, sampled every `step` ms (the helper polls about every 10 ms while the lid moves).
const move = (a, b, from, ms, step = 10) => { const out = []; for (let t = step; t <= ms; t += step) out.push([Math.round(a + (b - a) * (0.5 - 0.5 * Math.cos(Math.PI * t / ms))), from + t]); return out; };
// Open (or close) a little and back: a bump of `peak` degrees taking `ms` out and `ms` back.
const flick = (base, peak, from, ms = 150) => [...move(base, base + peak, from, ms), ...move(base + peak, base, from + ms, ms)];
const run = (det, samples) => samples.filter(([a, t]) => det.push(a, t)).map(([, t]) => t);

test('a quick small open-and-back of the lid is a flick', () => {
  const det = new LidFlickDetector();
  const fired = run(det, [...still(100, 0, 1000), ...flick(100, 12, 1010)]);
  assert.equal(fired.length, 1);
  assert.equal(det.last.fired, true);
  assert.equal(det.last.dir, 'open');
});

test('a quick small close-and-back is a flick too', () => {
  const det = new LidFlickDetector();
  const fired = run(det, [...still(100, 0, 1000), ...flick(100, -12, 1010)]);
  assert.equal(fired.length, 1);
  assert.equal(det.last.dir, 'close');
});

test('opening the lid for real is not a flick', () => {
  const det = new LidFlickDetector();
  assert.deepEqual(run(det, [...still(25, 0, 1000), ...move(25, 110, 1010, 1500), ...still(110, 2510, 3000)]), []);
});

test('closing the lid for real, down to sleep, is not a flick', () => {
  const det = new LidFlickDetector();
  assert.deepEqual(run(det, [...still(110, 0, 1000), ...move(110, 2, 1010, 900), ...still(2, 1910, 1000)]), []);
  assert.deepEqual(run(det, [...still(110, 4000, 1000), ...move(110, 40, 5010, 400), ...move(40, 2, 5410, 400)]), [], 'a fast close that keeps going');
});

test('a slow wobble, jitter and a small bump are not flicks', () => {
  const det = new LidFlickDetector();
  assert.deepEqual(run(det, [...still(100, 0, 1000), ...move(100, 110, 1010, 3000), ...move(110, 100, 4010, 3000)]), [], 'slow: it takes seconds');
  const jitter = [];
  for (let i = 0; i < 200; i++) jitter.push([100 + (i % 3 === 0 ? 1 : 0), 10000 + i * 10]);
  assert.deepEqual(run(det, jitter), [], 'a degree of jitter');
  assert.deepEqual(run(det, [...still(100, 13000, 1000), ...flick(100, 3, 14010)]), [], 'a few degrees is a nudge of the desk');
  assert.equal(det.last.reason, 'too small');
});

test('a big excursion that comes back is a normal open and close, not a flick', () => {
  const det = new LidFlickDetector();
  assert.deepEqual(run(det, [...still(100, 0, 1000), ...flick(100, 55, 1010, 250)]), []);
  assert.match(det.last.reason, /too far/);
});

test('a push that does not come back is not a flick, and the next flick from the new place still is', () => {
  const det = new LidFlickDetector();
  const pushed = [...still(100, 0, 1000), ...move(100, 112, 1010, 120), ...still(112, 1130, 2500)];
  assert.deepEqual(run(det, pushed), []);
  const fired = run(det, flick(112, 12, 4000));
  assert.equal(fired.length, 1);
});

test('a flick needs the lid to have been still first', () => {
  const det = new LidFlickDetector();
  // the lid is still settling after being opened: a bump right after the move is part of the same movement
  assert.deepEqual(run(det, [...move(30, 100, 0, 600), ...flick(100, 12, 610)]), []);
});

test('with the lid nearly closed, nothing counts', () => {
  const det = new LidFlickDetector();
  assert.deepEqual(run(det, [...still(10, 0, 1000), ...flick(10, 12, 1010)]), []);
});

test('sleep and wake are ignored: a gap resets everything', () => {
  const det = new LidFlickDetector();
  run(det, still(100, 0, 1000));
  // asleep for a minute, awake with the lid at a different angle, then a quiet moment
  assert.deepEqual(run(det, [[40, 61000], [40, 61500], [40, 62000]]), []);
  // a lid moving between two samples a minute apart is not a flick either
  assert.deepEqual(run(det, [[100, 130000]]), []);
});

test('two flicks in a row count once; a later one counts again', () => {
  const det = new LidFlickDetector();
  const first = flick(100, 12, 1010);
  const second = [...still(100, 1300, 350), ...flick(100, 12, 1660)];
  assert.equal(run(det, [...still(100, 0, 1000), ...first, ...second]).length, 1);
  assert.equal(run(det, [...still(100, 3000, 1600), ...flick(100, 12, 4610)]).length, 1);
});

test('garbage and out-of-order samples are ignored', () => {
  const det = new LidFlickDetector();
  assert.equal(det.push(NaN, 0), false);
  assert.equal(det.push(100, 'x'), false);
  det.push(100, 1000);
  assert.equal(det.push(120, 500), false);
  assert.equal(det.base, 100);
});

// ---- the helper ----
function fakeChild() {
  const c = new EventEmitter();
  c.stdout = new EventEmitter(); c.stdin = new EventEmitter(); c.stdin.end = () => { c.ended = true; };
  c.kill = () => { c.killed = true; };
  return c;
}

test('the sensor reads lines, even split across chunks, and says when it is on', () => {
  const child = fakeChild(), angles = [], states = [];
  const s = new LidSensor({ binPath: '/x/relay-lid', spawnFn: () => child, exists: () => true });
  s.start({ onAngle: (a, t) => angles.push([a, t]), onState: (st) => states.push(st) });
  child.stdout.emit('data', '{"ready":true,"angle":99,"t":1000}\n{"angle":10');
  child.stdout.emit('data', '1,"t":1050}\nnot json\n{"angle":"x","t":1}\n');
  assert.deepEqual(angles, [[99, 1000], [101, 1050]]);
  assert.deepEqual(states, ['starting', 'on']);
  s.stop();
  assert.equal(child.ended, true);
  assert.equal(s.state, 'off');
});

test('a Mac without the sensor says so once and is not started again', () => {
  let spawned = 0;
  const child = fakeChild();
  const s = new LidSensor({ binPath: '/x', spawnFn: () => { spawned++; return child; }, exists: () => true });
  s.start({});
  child.stdout.emit('data', '{"error":"no-sensor"}\n');
  child.emit('exit', 2);
  assert.equal(s.state, 'no-sensor');
  s.start({});
  assert.equal(spawned, 1);
});

test('a missing helper fails quietly', () => {
  const s = new LidSensor({ binPath: '/nope', spawnFn: () => { throw new Error('must not run'); }, exists: () => false });
  assert.equal(s.start({}), 'failed');
});

test('a helper that keeps dying is given up on, one that dies once is restarted', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const kids = [];
  const s = new LidSensor({ binPath: '/x', spawnFn: () => { const c = fakeChild(); kids.push(c); return c; }, exists: () => true });
  s.start({});
  kids[0].emit('exit', 1);
  assert.equal(s.state, 'starting');
  t.mock.timers.tick(2000);
  assert.equal(kids.length, 2);
  kids[1].stdout.emit('data', '{"angle":90,"t":1}\n'); // it worked for a while: the count starts over
  kids[1].emit('exit', 1); t.mock.timers.tick(2000);
  assert.equal(kids.length, 3);
  kids[2].emit('exit', 1); t.mock.timers.tick(4000);
  assert.equal(kids.length, 4);
  kids[3].emit('exit', 1); t.mock.timers.tick(8000);
  assert.equal(kids.length, 4, 'no fifth try');
  assert.equal(s.state, 'failed');
});

// ---- deciding what to send ----
function rig({ settings = { enabled: true, action: 'finder' }, locked = false, phone = { paired: 1, connected: 1 }, items = {}, deliver = () => ({ ok: true }) } = {}) {
  const sent = [], said = [], logs = [], gathered = [];
  const sensor = { started: 0, stopped: 0, state: 'on', start(h) { this.started++; this.h = h; }, stop() { this.stopped++; } };
  const it = { finder: async () => { gathered.push('finder'); return { kind: 'file', name: 'report.pdf', mime: 'application/pdf', bytes: Buffer.from('%PDF') }; }, clipboard: async () => { gathered.push('clipboard'); return { kind: 'text', name: 'Clipboard.txt', mime: 'text/plain', bytes: Buffer.from('hi') }; }, screenshot: async () => { gathered.push('screenshot'); return { kind: 'image', name: 'Relay.png', mime: 'image/png', bytes: Buffer.from([1, 2]) }; }, ...items };
  const cfg = { ...settings };
  const lf = new LidFlick({ sensor, getSettings: () => cfg, isLocked: () => (typeof locked === 'function' ? locked() : locked), phone: { status: () => phone, deliver: (i) => { sent.push(i); return deliver(i); } }, items: it, notify: (m) => said.push(m), log: (m) => logs.push(m) });
  const play = (samples) => { for (const [a, t] of samples) sensor.h.onAngle(a, t); };
  return { lf, sensor, sent, said, logs, gathered, cfg, play };
}
const FLICK = [...still(100, 0, 1000), ...flick(100, 12, 1010)];
const settle = () => new Promise((r) => setImmediate(r));

test('the sensor only runs while the feature is on', () => {
  const r = rig({ settings: { enabled: false, action: 'finder' } });
  r.lf.sync();
  assert.equal(r.sensor.started, 0);
  r.cfg.enabled = true; r.lf.sync(); r.lf.sync();
  assert.equal(r.sensor.started, 1);
  r.cfg.enabled = false; r.lf.sync();
  assert.equal(r.sensor.stopped, 1);
  assert.equal(r.lf.onAngle(100, 5), false, 'angles after it is off are ignored');
});

test('a flick sends the item chosen in Settings to the phone', async () => {
  for (const [action, name] of [['finder', 'report.pdf'], ['clipboard', 'Clipboard.txt'], ['screenshot', 'Relay.png']]) {
    const r = rig({ settings: { enabled: true, action } });
    r.lf.sync(); r.play(FLICK); await settle();
    assert.deepEqual(r.gathered, [action]);
    assert.equal(r.sent.length, 1);
    assert.equal(r.sent[0].name, name);
    assert.match(r.said[0], new RegExp(`Sent ${name.replace('.', '\\.')}`));
    assert.equal(r.lf.info().last.sent, true);
  }
});

test('an unknown action falls back to the Finder file', async () => {
  const r = rig({ settings: { enabled: true, action: 'everything' } });
  r.lf.sync(); r.play(FLICK); await settle();
  assert.deepEqual(r.gathered, ['finder']);
});

test('nothing is gathered or sent while the Mac is locked', async () => {
  const r = rig({ locked: true });
  r.lf.sync(); r.play(FLICK); await settle();
  assert.deepEqual(r.gathered, []);
  assert.deepEqual(r.sent, []);
  assert.equal(r.lf.info().last.reason, 'locked');
});

test('it locking while the item is being gathered still sends nothing', async () => {
  let locked = false;
  const r = rig({ locked: () => locked, items: { finder: async () => { locked = true; return { kind: 'file', name: 'a.txt', mime: 'text/plain', bytes: Buffer.from('a') }; } } });
  r.lf.sync(); r.play(FLICK); await settle();
  assert.deepEqual(r.sent, []);
  assert.equal(r.lf.info().last.reason, 'locked');
});

test('nothing is sent without a paired phone, and a paired phone that is not connected is told so on the Mac', async () => {
  const none = rig({ phone: { paired: 0, connected: 0 } });
  none.lf.sync(); none.play(FLICK); await settle();
  assert.deepEqual(none.gathered, []);
  assert.equal(none.lf.info().last.reason, 'not-paired');
  const off = rig({ phone: { paired: 1, connected: 0 } });
  off.lf.sync(); off.play(FLICK); await settle();
  assert.deepEqual(off.gathered, []);
  assert.equal(off.lf.info().last.reason, 'phone-offline');
  assert.match(off.said[0], /not connected/);
});

test('nothing to send is said, not sent', async () => {
  const r = rig({ settings: { enabled: true, action: 'finder' }, items: { finder: async () => null } });
  r.lf.sync(); r.play(FLICK); await settle();
  assert.deepEqual(r.sent, []);
  assert.match(r.said[0], /Select a file in Finder/);
  assert.equal(r.lf.info().last.reason, 'nothing');
});

test('a gatherer that fails does not throw, and the phone refusing is reported', async () => {
  const bad = rig({ items: { finder: async () => { throw new Error('no Finder'); } } });
  bad.lf.sync(); bad.play(FLICK); await settle();
  assert.equal(bad.lf.info().last.reason, 'gather-failed');
  const big = rig({ deliver: () => ({ ok: false, reason: 'too-big' }) });
  big.lf.sync(); big.play(FLICK); await settle();
  assert.equal(big.lf.info().last.sent, false);
  assert.match(big.said[0], /too big/);
});

test('a second flick while the first is still being gathered is ignored', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const r = rig({ items: { finder: async () => { await gate; return { kind: 'file', name: 'a.txt', mime: 'text/plain', bytes: Buffer.from('a') }; } } });
  r.lf.sync();
  const first = r.lf.flick();
  const second = await r.lf.flick();
  assert.equal(second.reason, 'busy');
  release();
  assert.equal((await first).sent, true);
  assert.equal(r.sent.length, 1);
});

test('normal use of the lid sends nothing at all', async () => {
  const r = rig();
  r.lf.sync();
  r.play([...still(25, 0, 1000), ...move(25, 110, 1010, 1500), ...still(110, 2510, 2000), ...move(110, 2, 4510, 900)]);
  await settle();
  assert.deepEqual(r.gathered, []);
  assert.deepEqual(r.sent, []);
});
