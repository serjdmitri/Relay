const test = require('node:test');
const assert = require('node:assert/strict');
const { OwnerGuard, config, cosine, bestScore, addSample, parseOwnerCommand } = require('../src/main/ownerGuard');

const tick = () => new Promise((r) => setImmediate(r));
function make(cfg = { enabled: true, seconds: 20, threshold: 0.4 }, extra = {}) {
  const clock = { t: 1e6 }, log = [], locks = [];
  const g = new OwnerGuard({ lock: async () => { locks.push(clock.t); }, onAlarm: (a) => log.push(['alarm', a.seconds, a.demo]), onCount: (s) => log.push(['count', s]), onClear: (r) => log.push(['clear', r]), onLocked: () => log.push(['locked']), getConfig: () => cfg, now: () => clock.t, ...extra });
  // one second per frame; scores: what the camera page says about each face
  const feed = (scores, secs = 1) => { let last = null; for (let i = 0; i < secs; i++) { clock.t += 1000; last = g.frame({ faces: scores.length, scores }) || last; } return last; };
  return { g, clock, log, locks, feed, cfg };
}
const events = (m, kind) => m.log.filter((e) => e[0] === kind);

test('the time is adjustable within safe limits, and it is off unless turned on', () => {
  assert.deepEqual(config({ enabled: true }), { enabled: true, seconds: 20, threshold: 0.363, awayScreen: true, awaySeconds: 45, liveness: true });
  assert.equal(config({ seconds: 1 }).seconds, 5); assert.equal(config({ seconds: 9999 }).seconds, 120); assert.equal(config({ seconds: 45 }).seconds, 45);
  assert.equal(config({ threshold: 5 }).threshold, 0.7); assert.equal(config({ enabled: 'true' }).enabled, false);
  const m = make({ enabled: false }); m.feed([0.01], 60);
  assert.deepEqual(m.log, []); assert.deepEqual(m.locks, []);
});

test('matching: cosine of embeddings, the best of several templates, and "cannot tell" for anything unusable', () => {
  assert.ok(Math.abs(cosine([1, 0], [2, 0]) - 1) < 1e-9); assert.ok(Math.abs(cosine([1, 0], [0, 1])) < 1e-9);
  assert.equal(cosine([1, 2], [1]), null); assert.equal(cosine(null, [1]), null);
  assert.ok(Math.abs(bestScore([1, 0], [[0, 1], [1, 1], [2, 0]]) - 1) < 1e-9);
  assert.equal(bestScore([1, 0], []), null); assert.equal(bestScore(null, [[1, 0]]), null);
});

test('you at the computer: nothing happens. Nobody there: nothing happens. A face it cannot judge: nothing happens', () => {
  const m = make();
  m.feed([0.8], 30); m.feed([], 30); m.feed([null], 30);
  assert.deepEqual(m.log, []); assert.deepEqual(m.locks, []);
});

test('a stranger alone starts the alarm after three frames, counts down, and locks at the end, once', async () => {
  const m = make();
  m.feed([0.1], 2); assert.deepEqual(m.log, [], 'one or two odd frames are not enough');
  assert.equal(m.feed([0.1]), 'alarm');
  assert.deepEqual(events(m, 'alarm'), [['alarm', 20, false]]);
  m.feed([0.1], 10); assert.deepEqual(m.locks, []);
  assert.equal(m.g.secondsLeft(), 10);
  assert.equal(m.feed([0.1], 10), 'locked'); await tick();
  assert.equal(m.locks.length, 1); assert.equal(events(m, 'locked').length, 1);
  m.feed([0.1], 200); await tick();
  assert.equal(m.locks.length, 1, 'the stranger staying does not lock (or alarm) again and again');
});

test('the countdown length follows the setting, read when the alarm starts', () => {
  const m = make({ enabled: true, seconds: 45, threshold: 0.4 });
  m.feed([0.1], 3); assert.deepEqual(events(m, 'alarm'), [['alarm', 45, false]]);
  m.cfg.seconds = 5; m.feed([0.1], 40); assert.deepEqual(m.locks, [], 'a running countdown is not shortened by a later change');
});

test('if you come back in time, two frames of you stop the alarm and nothing locks', async () => {
  const m = make();
  m.feed([0.1], 3); m.feed([0.1], 8);
  assert.equal(m.feed([0.9]), null, 'one frame of you is not enough to be sure');
  assert.equal(m.feed([0.9]), 'cleared');
  assert.deepEqual(events(m, 'clear'), [['clear', 'owner']]);
  m.feed([0.9], 60); await tick();
  assert.deepEqual(m.locks, []); assert.equal(m.g.state, 'idle');
});

test('a flicker of you between strangers does not cancel, and you plus a stranger together do not raise the alarm', () => {
  const m = make();
  m.feed([0.1], 3); m.feed([0.9]); m.feed([0.1]); m.feed([0.9]);
  assert.equal(m.g.state, 'alarm', 'never two in a row');
  const n = make(); n.feed([0.9, 0.1], 60);
  assert.deepEqual(n.log, [], 'you are there; a second face is the viewer guard\'s business');
});

test('a wrongly flagged owner is recognised again before the alarm starts, so nothing happens', () => {
  const m = make();
  m.feed([0.3], 2);
  m.feed([0.7], 2);
  m.feed([0.3], 2);
  assert.equal(m.g.state, 'idle'); assert.deepEqual(m.log, []);
});

test('the lock happens on time even when the camera stops sending pictures (the per-second step)', async () => {
  const m = make();
  m.feed([0.1], 3);
  m.clock.t += 21000;
  assert.equal(m.g.step(), 'locked'); await tick();
  assert.equal(m.locks.length, 1);
});

test('after a lock it stays quiet, and watches again once you are seen or the stranger has gone for a while', () => {
  const a = make(); a.feed([0.1], 3); a.feed([0.1], 21);
  assert.equal(a.g.state, 'locked');
  a.feed([0.9], 2); assert.equal(a.g.state, 'idle');
  const b = make(); b.feed([0.1], 3); b.feed([0.1], 21);
  b.feed([], 10); assert.equal(b.g.state, 'idle');
  b.feed([0.1], 3); assert.equal(b.g.state, 'alarm', 'a new stranger is alarmed about again');
});

test('with no face enrolled it does nothing, and turning it off in the middle stops the alarm', () => {
  const none = make(undefined, { hasTemplates: () => false }); none.feed([0.1], 60); assert.deepEqual(none.log, []);
  const m = make(); m.feed([0.1], 3); m.cfg.enabled = false; m.feed([0.1]);
  assert.equal(m.g.state, 'idle'); assert.deepEqual(events(m, 'clear'), [['clear', 'ended']]); assert.deepEqual(m.locks, []);
});

test('the test screen runs the alarm for a few seconds, never locks, and ignores who is in view', async () => {
  const m = make();
  m.g.startDemo(6);
  assert.deepEqual(events(m, 'alarm'), [['alarm', 6, true]]);
  m.feed([0.9], 4); assert.equal(m.g.state, 'alarm', 'your own face does not end the demo early');
  m.feed([0.9], 3); await tick();
  assert.equal(m.g.state, 'idle'); assert.deepEqual(m.locks, []); assert.deepEqual(events(m, 'clear'), [['clear', 'ended']]);
});

test('enrollment keeps varied samples only, caps them, and refuses malformed ones', () => {
  const e = (i) => Array.from({ length: 128 }, (_, k) => (k === i ? 1 : 0.01));
  let r = addSample([], e(0)); assert.equal(r.added, true);
  assert.deepEqual([addSample(r.samples, e(0)).added, addSample(r.samples, e(0)).why], [false, 'similar']);
  r = addSample(r.samples, e(1)); assert.equal(r.added, true);
  assert.equal(addSample(r.samples, [1, 2, 3]).why, 'bad'); assert.equal(addSample(r.samples, Array(128).fill(NaN)).why, 'bad');
  let s = []; for (let i = 0; i < 20; i++) s = addSample(s, e(i)).samples;
  assert.equal(s.length, 12); assert.equal(addSample(s, e(40)).why, 'full');
});

test('voice commands: enroll, forget, on, off, set the countdown, status and the test screen; ordinary talk is left alone', () => {
  for (const [t, want] of [
    ['enroll my face', { type: 'enroll' }], ['Jarvis, set up face recognition', { type: 'enroll' }], ['forget my face', { type: 'forget' }], ['delete my face data', { type: 'forget' }],
    ['turn on owner recognition', { type: 'on' }], ['enable the face check', { type: 'on' }], ['turn off face recognition', { type: 'off' }],
    ['set the lock countdown to 30 seconds', { type: 'seconds', seconds: 30 }], ['change the countdown to 2 minutes', { type: 'seconds', seconds: 120 }], ['set the timer to 45', { type: 'seconds', seconds: 45 }],
    ['owner recognition status', { type: 'status' }], ['test the access denied screen', { type: 'demo' }], ['show the intruder alarm', { type: 'demo' }]
  ]) assert.deepEqual(parseOwnerCommand(t), want, t);
  for (const t of ['set a timer for 5 minutes', 'lock my screen', 'whose face is this', 'turn on the lights', 'set the volume to 30', '']) assert.equal(parseOwnerCommand(t), null, t);
});

test('the away screen: nobody in view for a while puts it on standby, and you being seen again ends it', () => {
  const away = [];
  const m = make({ enabled: true, seconds: 20, threshold: 0.4, awayScreen: true, awaySeconds: 30 }, { onAway: (on) => away.push(on) });
  m.feed([0.9], 5); m.feed([], 29); assert.deepEqual(away, [], 'not yet');
  m.feed([], 2); assert.deepEqual(away, [true]);
  m.feed([], 300); assert.deepEqual(away, [true], 'it stays up once, without repeating');
  m.feed([0.9]); assert.deepEqual(away, [true], 'one frame is not enough');
  m.feed([0.9]); assert.deepEqual(away, [true, false]);
});

test('the away screen: a stranger appearing while you are away becomes the alarm, and a face that is not yours does not end the standby', () => {
  const away = [];
  const m = make({ enabled: true, seconds: 20, threshold: 0.4, awayScreen: true, awaySeconds: 10 }, { onAway: (on) => away.push(on) });
  m.feed([], 12); assert.deepEqual(away, [true]);
  m.feed([0.1], 2); assert.equal(m.g.state, 'idle'); assert.deepEqual(away, [true], 'a stranger alone does not end it');
  m.feed([0.1]); assert.equal(m.g.state, 'alarm'); assert.deepEqual(events(m, 'alarm').length, 1);
  assert.deepEqual(away, [true], 'the alarm took the screen over; main.js shows it in place of the standby');
  m.feed([0.9], 2); assert.equal(m.g.state, 'idle'); assert.deepEqual(events(m, 'clear'), [['clear', 'owner']]);
});

test('the away screen can be turned off, needs owner recognition on, and is not shown by the test alarm', () => {
  const away = [];
  const off = make({ enabled: true, awayScreen: false, awaySeconds: 10 }, { onAway: (on) => away.push(on) }); off.feed([], 60);
  const dis = make({ enabled: false, awaySeconds: 10 }, { onAway: (on) => away.push(on) }); dis.feed([], 60);
  assert.deepEqual(away, []);
  assert.deepEqual(config({ enabled: true }).awayScreen, true); assert.equal(config({ awaySeconds: 1 }).awaySeconds, 10); assert.equal(config({ awaySeconds: 99999 }).awaySeconds, 600);
  assert.deepEqual(parseOwnerCommand('turn off the away screen'), { type: 'away-off' });
  assert.deepEqual(parseOwnerCommand('test the away screen'), { type: 'away-demo' });
  assert.deepEqual(parseOwnerCommand('enable standby mode'), { type: 'away-on' }); assert.equal(parseOwnerCommand('turn on the lights mode'), null);
});

// a face as the camera page reports it: [score], [alive]
const feedLive = (m, scores, live, secs = 1) => { let last = null; for (let i = 0; i < secs; i++) { m.clock.t += 1000; last = m.g.frame({ faces: scores.length, scores, live }) || last; } return last; };

test('liveness: a face that matches you but is not alive (a picture) is a stranger, never you', async () => {
  const m = make();
  feedLive(m, [0.9], [false], 3);
  assert.equal(m.g.state, 'alarm', 'a photo of you held to the camera starts the alarm');
  feedLive(m, [0.9], [false], 25); await tick();
  assert.equal(m.locks.length, 1, 'and it cannot stop the alarm, either');
});

test('liveness: a living you stops the alarm that a picture started, and a picture beside you does not start one', () => {
  const m = make();
  feedLive(m, [0.9], [false], 3); assert.equal(m.g.state, 'alarm');
  feedLive(m, [0.9], [true], 2); assert.equal(m.g.state, 'idle');
  const n = make(); feedLive(n, [0.9, 0.9], [true, false], 30);
  assert.deepEqual(n.log, [], 'you are there and alive; the picture next to you is the viewer guard\'s business');
});

test('liveness: it can be turned off, and a missing report (the blink finder is not ready) counts as alive', () => {
  const off = make({ enabled: true, seconds: 20, threshold: 0.4, liveness: false }); feedLive(off, [0.9], [false], 30);
  assert.deepEqual(off.log, []);
  const unknown = make(); unknown.g.frame({ faces: 1, scores: [0.9] }); unknown.g.frame({ faces: 1, scores: [0.9] }); feedLive(unknown, [0.9], [], 10);
  assert.deepEqual(unknown.log, []);
  assert.equal(config({}).liveness, true); assert.equal(config({ liveness: false }).liveness, false);
  assert.deepEqual(parseOwnerCommand('turn off the liveness check'), { type: 'liveness-off' });
  assert.deepEqual(parseOwnerCommand('enable the blink check'), { type: 'liveness-on' });
  assert.equal(parseOwnerCommand('turn on the lights check'), null);
});
