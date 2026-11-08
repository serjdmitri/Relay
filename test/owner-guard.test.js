const test = require('node:test');
const assert = require('node:assert/strict');
const { OwnerGuard, config, cosine, bestScore, addSample, parseOwnerCommand } = require('../src/main/ownerGuard');

const tick = () => new Promise((r) => setImmediate(r));
function make(cfg = { enabled: true, seconds: 20, threshold: 0.4 }, extra = {}) {
  const clock = { t: 1e6 }, log = [], locks = [];
  const g = new OwnerGuard({ lock: async () => { locks.push(clock.t); }, onAlarm: (a) => log.push(['alarm', a.seconds, a.demo]), onCount: (s) => log.push(['count', s]), onClear: (r) => log.push(['clear', r]), onLocked: () => log.push(['locked']), getConfig: () => cfg, now: () => clock.t, strangerFrames: 3, ...extra });
  if (!extra.unarmed) g.armed = true; // most tests are about a guard that already knows you; the unarmed ones say so
  // one second per frame; scores: what the camera page says about each face
  const feed = (scores, secs = 1) => { let last = null; for (let i = 0; i < secs; i++) { clock.t += 1000; last = g.frame({ faces: scores.length, scores }) || last; } return last; };
  return { g, clock, log, locks, feed, cfg };
}
const events = (m, kind) => m.log.filter((e) => e[0] === kind);

test('the time is adjustable within safe limits, and it is off unless turned on', () => {
  assert.deepEqual(config({ enabled: true }), { enabled: true, seconds: 20, threshold: 0.363, awayScreen: true, awaySeconds: 45, liveness: true, margin: 0.12, photos: true });
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

test('liveness: a face that matches you but never blinks for a full minute (a picture) is a stranger, never you', async () => {
  const m = make();
  feedLive(m, [0.9], [false], 40);
  assert.equal(m.g.state, 'idle', 'forty seconds of you staring at the screen without a blink is not an alarm (it was one, on you)');
  feedLive(m, [0.9], [false], 30);
  assert.equal(m.g.state, 'alarm', 'but a minute of a face that matches you and never blinks is a photo held to the camera');
  feedLive(m, [0.9], [false], 25); await tick();
  assert.equal(m.locks.length, 1, 'and it cannot stop the alarm, either');
});

test('liveness: a living you stops the alarm that a picture started, and a picture beside you does not start one', () => {
  const m = make();
  feedLive(m, [0.9], [false], 70); assert.equal(m.g.state, 'alarm');
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

test('safety: until you have been recognised this session it is not armed, so a recognition that fails for you can never alarm, blank the screen or lock you out', () => {
  const m = make(undefined, { unarmed: true });
  m.feed([0.05], 60); m.feed([], 120);
  assert.deepEqual(m.log, []); assert.deepEqual(m.locks, []); assert.equal(m.g.armed, false);
  assert.equal(m.g.lastScore, 0.05, 'the best score seen is kept for the status answer');
  m.feed([0.8], 2); assert.equal(m.g.armed, false, 'two frames are not enough to be sure it is you');
  m.feed([0.8]); assert.equal(m.g.armed, true);
  m.feed([0.05], 3); assert.equal(m.g.state, 'alarm', 'armed: a stranger now starts the alarm');
});

test('safety: a picture of you (matches but not alive) does not arm it', () => {
  const m = make(undefined, { unarmed: true });
  feedLive(m, [0.9], [false], 20);
  assert.equal(m.g.armed, false);
});

test('less trigger-happy: a "not sure" score (far away, turned, badly lit) is neither you nor a stranger, and a stranger needs five frames by default', async () => {
  const m = make({ enabled: true, seconds: 20, threshold: 0.4 });
  m.feed([0.3], 60); // between threshold - margin (0.28) and the threshold
  assert.deepEqual(m.log, [], 'not sure is not enough to sound the alarm');
  const d = new OwnerGuard({ lock: async () => {}, getConfig: () => ({ enabled: true, threshold: 0.4 }), now: () => 0 });
  assert.equal(d.strangerFrames, 5, 'five by default');
  d.armed = true; for (let i = 0; i < 4; i++) d.frame({ faces: 1, scores: [0.05] }); assert.equal(d.state, 'idle');
  d.frame({ faces: 1, scores: [0.05] }); assert.equal(d.state, 'alarm');
  assert.equal(config({}).margin, 0.12); assert.equal(config({ margin: 5 }).margin, 0.3);
});

test('the status question is understood even when it is misheard or misspelled', () => {
  for (const t of ['owner recognition status', 'owner recognistion status', 'owner recognision status', 'face recognition settings', 'is the owner recognition working']) assert.deepEqual(parseOwnerCommand(t), { type: 'status' }, t);
});

test('looking down: a face that vanishes right after looking down gets three times as long before the away screen, and a down-looking face is not judged', () => {
  const away = [];
  const m = make({ enabled: true, seconds: 20, threshold: 0.4, awayScreen: true, awaySeconds: 20 }, { onAway: (on) => away.push(on) });
  const feedDown = (secs) => { for (let i = 0; i < secs; i++) { m.clock.t += 1000; m.g.frame({ faces: 1, scores: [null], down: true }); } };
  feedDown(3); assert.equal(m.g.lookingAway, true);
  m.feed([], 30); assert.deepEqual(away, [], '30 seconds is more than 20, but you just looked down');
  m.feed([], 31); assert.deepEqual(away, [true], 'after about a minute (3 x 20) it is a real absence');
  const n = make({ enabled: true, seconds: 20, threshold: 0.4, awayScreen: true, awaySeconds: 20 }, { onAway: (on) => away.push(on) });
  n.feed([0.9], 5); n.feed([], 25);
  assert.equal(away.length, 2, 'without a look down first, the normal 20 seconds applies');
  const k = make(); k.feed([0.9], 5); for (let i = 0; i < 30; i++) { k.clock.t += 1000; k.g.frame({ faces: 1, scores: [null], down: true }); }
  assert.deepEqual(k.log, [], 'looking down at the keyboard never alarms');
});

test('a fingerprint stops the alarm, and the guard stays quiet for five minutes so a friend in view does not restart it', async () => {
  const m = make();
  m.feed([0.1], 3); assert.equal(m.g.state, 'alarm');
  m.g.dismiss('fingerprint');
  assert.equal(m.g.state, 'idle'); assert.deepEqual(events(m, 'clear'), [['clear', 'fingerprint']]);
  m.feed([0.1], 200); await tick();
  assert.equal(m.g.state, 'idle', 'the stranger is still there, but you said it is fine'); assert.deepEqual(m.locks, []);
  m.clock.t += 5 * 60000;
  m.feed([0.1], 3); assert.equal(m.g.state, 'alarm', 'after five minutes it is watching again');
});

test('a fingerprint also ends the standby screen and keeps it from coming straight back, and does not undo a lock that already happened', () => {
  const away = [];
  const m = make({ enabled: true, seconds: 20, threshold: 0.4, awayScreen: true, awaySeconds: 10 }, { onAway: (on) => away.push(on) });
  m.feed([], 12); assert.deepEqual(away, [true]);
  m.g.dismiss('fingerprint'); assert.deepEqual(away, [true, false]);
  m.feed([], 60); assert.deepEqual(away, [true, false], 'quiet for five minutes');
  const k = make(); k.feed([0.1], 3); k.feed([0.1], 21); assert.equal(k.g.state, 'locked');
  k.g.dismiss('fingerprint'); assert.equal(k.g.state, 'locked', 'once the Mac is locked, macOS is in charge of getting back in');
});

const { authenticateOwner } = require('../src/main/ownerGuard');
test('confirming it is you: Touch ID first; a failed or cancelled attempt never falls back; a system problem falls back to the macOS prompt and says so', async () => {
  const ok = async () => {}, no = (m) => async () => { throw new Error(m); };
  assert.deepEqual(await authenticateOwner({ touchId: ok, admin: no('should not run') }), { ok: true, via: 'touchid' });
  await assert.rejects(authenticateOwner({ touchId: no('Canceled by user.'), admin: ok }), /Cancelled/);
  await assert.rejects(authenticateOwner({ touchId: no('Authentication failed.'), admin: ok }), /not recognised/);
  await assert.rejects(authenticateOwner({ touchId: no('Fingerprint did not match.'), admin: ok }), /not recognised/);
  const problems = [];
  assert.deepEqual(await authenticateOwner({ touchId: no('Biometry is not available on this device.'), admin: ok, onProblem: (m) => problems.push(m) }), { ok: true, via: 'macos' });
  assert.deepEqual(problems, ['Biometry is not available on this device.']);
  await assert.rejects(authenticateOwner({ touchId: no('The app is not entitled.'), admin: no('execution error: User canceled. (-128)') }), /Cancelled/);
  await assert.rejects(authenticateOwner({ touchId: no('The app is not entitled.'), admin: no('some other failure') }), /Could not confirm it is you: The app is not entitled/);
});

test('the camera looks quickly only while waiting to see you, and slowly the rest of the time', () => {
  const m = make({ enabled: true, seconds: 20, threshold: 0.4, awaySeconds: 10 }, { unarmed: true });
  assert.equal(m.g.pace(), 1000, 'nothing seen yet: the countdown for quick looking has not started');
  m.clock.t += 1000; m.g.frame({ faces: 1, scores: [0.1] });
  assert.equal(m.g.pace(), 400, 'just turned on and you are not recognised yet: look quickly');
  m.clock.t += 31000; assert.equal(m.g.pace(), 1000, 'still not recognised after 30 seconds: back to slow, so a face that never matches does not keep the camera busy');
  const armed = make(); armed.feed([0.9], 3);
  assert.equal(armed.g.pace(), 1000, 'recognised and idle: slow');
  const off = make({ enabled: false }); assert.equal(off.g.pace(), 1000);
  assert.equal(make({ enabled: true, threshold: 0.4 }, { unarmed: true }).g.pace(), 1000);
});

test('quick looking brings you back from the away screen and the alarm in under a second, and never changes how many frames an alarm or a lock takes', () => {
  const away = make({ enabled: true, seconds: 20, threshold: 0.4, awaySeconds: 10 });
  away.feed([], 11); away.g.step(); assert.equal(away.g.awayActive, true, 'nobody for 10 seconds: the away screen');
  assert.equal(away.g.pace(), 400);
  const start = away.clock.t; let back = null;
  for (let i = 1; i <= 5 && back === null; i++) { away.clock.t += 400; away.g.frame({ faces: 1, scores: [0.9] }); if (!away.g.awayActive) back = away.clock.t - start; }
  assert.equal(back, 800, 'two frames of you at the quick pace: 0.8 seconds, not 2');
  assert.equal(away.g.pace(), 1000, 'and slow again once you are back');
  // a stranger is judged while idle and armed, which is the slow pace: five frames, exactly as before
  const s = make(undefined, { strangerFrames: 5 }); assert.equal(s.g.pace(), 1000);
  s.feed([0.05], 4); assert.equal(s.g.state, 'idle'); s.feed([0.05], 1); assert.equal(s.g.state, 'alarm');
  assert.equal(s.g.pace(), 400, 'the alarm counts down at the quick pace so your return clears it fast');
  // after the lock it is slow again, so the quiet period still takes ten frames of nobody strange
  s.feed([0.05], 25); assert.equal(s.g.state, 'locked'); assert.equal(s.g.pace(), 1000);
});

test('the camera page reads the pace the main process sends and loads the face model before the first face appears', () => {
  const fs = require('node:fs'), path = require('node:path');
  const page = fs.readFileSync(path.join(__dirname, '../src/renderer/presence.js'), 'utf8'), main = fs.readFileSync(path.join(__dirname, '../src/main/main.js'), 'utf8');
  assert.match(page, /pace = Math\.min\(1000, Math\.max\(250, Number\(c\?\.pace\) \|\| 1000\)\)/, 'the page clamps what it is told, so a bad value cannot make it spin');
  assert.match(page, /if \(recogOn && !embed && !embedFailed && !embedLoading\) loadEmbedder\(\);/);
  assert.match(page, /setTimeout\(tick, Math\.max\(50, pace - /);
  assert.doesNotMatch(page, /setInterval\(async/, 'the frame loop reschedules itself, so frames never overlap');
  assert.match(main, /pace: faceId && !enrolling \? ownerGuard\?\.pace\?\.\(\) \|\| 1000 : 1000/);
});

test('an enrollment is kept only when it covers your face from around: straight ahead and enough directions, with clean numbers', () => {
  const { acceptEnrollment } = require('../src/main/ownerGuard');
  const emb = (k) => Array.from({ length: 128 }, (_, i) => Math.sin(i * 0.3 + k));
  const set = (ids) => ids.flatMap((pose, k) => [{ pose, embedding: emb(k) }, { pose, embedding: emb(k + 0.01) }]);
  const all = ['center', 'left', 'topLeft', 'top', 'topRight', 'right', 'bottomRight', 'bottom', 'bottomLeft'];
  const full = acceptEnrollment(set(all)); assert.equal(full.ok, true); assert.equal(full.templates.length, 18); assert.equal(full.poses.length, 9);
  assert.equal(acceptEnrollment(set(all.slice(0, 7))).ok, true, 'center and six directions is enough');
  assert.match(acceptEnrollment(set(all.slice(0, 6))).why, /Only 5 of the 8 directions/);
  assert.match(acceptEnrollment(set(all.slice(1))).why, /straight-ahead pose is missing/);
  assert.equal(acceptEnrollment([]).ok, false); assert.equal(acceptEnrollment(null).ok, false);
  const dirty = set(all); dirty[0].embedding = [1, 2, 3]; dirty[3].embedding = emb(1).map((x, i) => (i === 5 ? NaN : x)); dirty[4].pose = 'sideways';
  const r = acceptEnrollment(dirty); assert.equal(r.ok, true); assert.equal(r.templates.length, 15, 'the three bad ones are dropped, the rest kept');
  assert.equal(acceptEnrollment(Array.from({ length: 60 }, () => ({ pose: 'center', embedding: emb(1) }))).ok, false, 'a flood of one pose is not a full set');
});

test('the standby screen never traps you: it stays away while you use the keyboard or mouse, clears when you touch them, and gives up when the camera goes blind', () => {
  let idle = Infinity;
  const away = (extra = {}) => make({ enabled: true, seconds: 20, threshold: 0.4, awaySeconds: 10 }, { getIdleSeconds: () => idle, ...extra });
  const shown = (m) => m.log.filter((e) => e[0] === 'away');
  // 1. someone is using the Mac (input a few seconds ago): nobody in the picture does not put the screen up
  idle = 5; const a = away(); const events = []; a.g.onAway = (on) => events.push(on);
  a.feed([], 60); assert.equal(a.g.awayActive, false, 'typing, but the camera sees nobody (looking down, camera blocked): no standby screen');
  idle = 100; a.feed([], 2); assert.equal(a.g.awayActive, true, 'no input for a while and nobody in view: now it is shown');
  // 2. touching the keyboard or mouse clears it, after two seconds in a row, and it stays down for two minutes
  idle = 0.5; a.clock.t += 1000; a.g.step(); assert.equal(a.g.awayActive, true, 'one second of input is not enough (a bump of the desk)');
  a.clock.t += 1000; a.g.step(); assert.equal(a.g.awayActive, false); assert.deepEqual(events, [true, false]);
  idle = 100; a.feed([], 100); assert.equal(a.g.awayActive, false, 'quiet for two minutes after being cleared by input, even with nobody in view');
  a.feed([], 40); assert.equal(a.g.awayActive, true, 'and it can come back after that');
  // 3. the camera stops sending pictures: that is blindness, not an empty chair
  const b = away(); idle = 100; b.feed([], 12); assert.equal(b.g.awayActive, true);
  b.clock.t += 9000; b.g.step(); assert.equal(b.g.awayActive, false, 'no pictures for 9 seconds: the standby screen is taken down');
  b.clock.t += 60000; b.g.step(); assert.equal(b.g.awayActive, false, 'and it does not come back while the camera is blind');
  // 4. seeing you still clears it, as before, and does not start the two-minute quiet
  const c = away(); idle = 100; c.feed([], 12); assert.equal(c.g.awayActive, true);
  c.feed([0.9], 2); assert.equal(c.g.awayActive, false); assert.equal(c.g.quietUntil, 0);
  // 5. without an idle reading (older callers) nothing changes
  const d = make({ enabled: true, seconds: 20, threshold: 0.4, awaySeconds: 10 }); d.feed([], 12); assert.equal(d.g.awayActive, true);
});

test('"enroll my face" does not leave the reactor on the screen in front of the setup window', () => {
  const fs = require('node:fs'), path = require('node:path');
  const { shouldHoldAnswer } = require('../src/main/dismiss');
  const long = 'x'.repeat(120);
  assert.equal(shouldHoldAnswer({ reply: long, status: 'done' }), true, 'an ordinary long answer stays until dismissed');
  assert.equal(shouldHoldAnswer({ reply: long, status: 'done', noHold: true }), false, 'a command that says it must not stay is not held');
  const main = fs.readFileSync(path.join(__dirname, '../src/main/main.js'), 'utf8'), ask = fs.readFileSync(path.join(__dirname, '../src/main/askController.js'), 'utf8'), win = fs.readFileSync(path.join(__dirname, '../src/main/enrollWindow.js'), 'utf8');
  assert.match(main, /enrollWin\.open\(\);[\s\S]{0,500}noHold: true, noFollowUp: true/, 'the enroll command asks not to be held and not to be followed up');
  assert.match(ask, /noHold: !!res\.noHold/); assert.match(ask, /res\.noHold \? 1500 :/, 'and the reactor goes after a moment, not after ten seconds');
  assert.match(win, /setAlwaysOnTop\(true, 'screen-saver', 1\)/, 'the setup window sits above the reactor (level 0) and below the alarm (level 2)');
});

test('trusted people: a recognised trusted face is neither you nor a stranger (needs to match them, not you, and to have blinked)', () => {
  const { trustedFlags } = require('../src/main/ownerGuard');
  assert.deepEqual(trustedFlags({ scores: [0.1, 0.9, 0.1], trustedScores: [0.8, 0.8, 0.2], live: [true, true, true], threshold: 0.4 }), [true, false, false], 'a face that is you is not "trusted", and one matching nobody is not either');
  assert.deepEqual(trustedFlags({ scores: [0.1], trustedScores: [0.8], live: [false], threshold: 0.4 }), [false], 'a trusted face that has not blinked (a picture of them) does not count');
  assert.deepEqual(trustedFlags({ scores: [null], trustedScores: [0.8], threshold: 0.4 }), [true], 'no score against you (a far or turned face) but a clear trusted match still counts');
  assert.deepEqual(trustedFlags({ scores: [0.1, 0.1], trustedScores: [], live: [] }), [false, false], 'no trusted profiles: nobody is trusted'); assert.deepEqual(trustedFlags(), []);
});

test('a trusted person at the desk does not start the alarm, cannot stand in for you, and an alarm ends once only trusted people are in view', () => {
  const m = make({ enabled: true, seconds: 20, threshold: 0.4 }, { strangerFrames: 5 });
  const feed = (scores, trusted, n = 1) => { for (let i = 0; i < n; i++) { m.clock.t += 1000; m.g.frame({ faces: scores.length, scores, trusted }); } };
  feed([0.05], [true], 30); assert.equal(m.g.state, 'idle', 'a trusted person alone for 30 seconds: no alarm'); assert.equal(m.g.seen, 'trusted'); assert.equal(m.g.awayActive, false, 'and not the standby screen: someone is there');
  feed([0.05, 0.05], [true, false], 5); assert.equal(m.g.state, 'alarm', 'a trusted person with a STRANGER beside them: the stranger still starts the alarm');
  feed([0.05], [true], 1); assert.equal(m.g.state, 'alarm'); feed([0.05], [true], 1);
  assert.equal(m.g.state, 'idle', 'the stranger leaves and the trusted person stays for two looks: the alarm ends'); assert.deepEqual(events(m, 'clear').at(-1), ['clear', 'trusted']); assert.deepEqual(m.locks, [], 'nothing locked');
  const demo = make({ enabled: true, seconds: 20, threshold: 0.4 }); demo.g.startDemo(6);
  for (let i = 0; i < 4; i++) { demo.clock.t += 1000; demo.g.frame({ faces: 1, scores: [0.05], trusted: [true] }); } assert.equal(demo.g.state, 'alarm', 'the test screen ignores who is in view');
  const unarmed = make({ enabled: true, seconds: 20, threshold: 0.4 }, { unarmed: true });
  for (let i = 0; i < 10; i++) { unarmed.clock.t += 1000; unarmed.g.frame({ faces: 1, scores: [0.05], trusted: [true] }); } assert.equal(unarmed.g.armed, false, 'a trusted person cannot arm the guard as if they were you');
});

test('the camera page compares each face with you and, separately, with the trusted profiles, and main keeps trusted people out of the extra-viewer count', () => {
  const fs = require('node:fs'), path = require('node:path');
  const page = fs.readFileSync(path.join(__dirname, '../src/renderer/presence.js'), 'utf8'), main = fs.readFileSync(path.join(__dirname, '../src/main/main.js'), 'utf8');
  assert.match(page, /trustedTemplates = c\.trusted \|\| \[\]/); assert.match(page, /frame\.trustedScores = both\.map/);
  assert.match(main, /out\.templates = \[\.\.\.ownerState\.templates\]; out\.trusted = trustedPeople\?\.templates\(\) \|\| \[\]/, 'the two lists are sent apart');
  assert.match(main, /faces: Math\.max\(0, faces - trusted\.filter\(Boolean\)\.length\)/, 'the viewer guard does not count trusted people');
  assert.match(main, /ownerGuard\?\.frame\(\{ faces, scores, live, trusted, down: f\?\.down === true \}\)/);
});

test('intruder pictures: the guard says when you have just been seen, the photos setting and commands exist, and main takes pictures only for a real stranger alarm', () => {
  const seen = []; const m = make({ enabled: true, seconds: 20, threshold: 0.4 }, { onOwnerSeen: () => seen.push(m.clock.t) });
  m.feed([0.9], 1); assert.equal(seen.length, 0, 'one look is not enough'); m.feed([0.9], 1); assert.equal(seen.length, 1, 'the second look in a row: seen'); m.feed([0.9], 5); assert.equal(seen.length, 1, 'not again while you stay');
  m.feed([], 3); m.feed([0.9], 2); assert.equal(seen.length, 2, 'and again when you come back after being away');
  const throws = make({ enabled: true, seconds: 20, threshold: 0.4 }, { onOwnerSeen: () => { throw Error('boom'); } }); assert.doesNotThrow(() => throws.feed([0.9], 3), 'a failing report must not stop the guard');
  const after = make({ enabled: true, seconds: 20, threshold: 0.4 }, { strangerFrames: 3, onOwnerSeen: () => { after.sawState = after.g.state; } }); after.feed([0.05], 3); assert.equal(after.g.state, 'alarm'); after.feed([0.9], 2); assert.equal(after.sawState, 'idle', 'by the time you are reported seen, the alarm has been cleared');
  assert.equal(config({ enabled: true }).photos, true); assert.equal(config({ photos: false }).photos, false); assert.equal(config({ photos: 'no' }).photos, true, 'only an explicit false turns it off');
  for (const [text, type] of [['show the intruder pictures', 'intruders'], ['show intruders', 'intruders'], ['who was at my computer', 'intruders'], ['who sat at my computer while i was away', 'intruders'], ['turn off intruder photos', 'photos-off'], ['turn on the stranger pictures', 'photos-on'], ['delete the intruder photos', 'intruders-clear']]) assert.equal(parseOwnerCommand(text)?.type, type, text);
  assert.equal(parseOwnerCommand('who was at the door'), null);
  const fs = require('node:fs'), path = require('node:path'), main = fs.readFileSync(path.join(__dirname, '../src/main/main.js'), 'utf8'), page = fs.readFileSync(path.join(__dirname, '../src/renderer/presence.js'), 'utf8');
  assert.match(main, /onAlarm: \(\{ seconds, demo \}\) => \{ (?:diag\.log\([^;]*\); )?intruder\.show\(\{ seconds, demo \}\); ask\.sound\('Basso'\); if \(!demo\) startVisit\(seconds\); \}/, 'the test screen never takes pictures');
  assert.match(main, /intruderLog: _intruderLog/, 'the log is never sent to the screen with the rest of the state');
  assert.match(main, /\['enroll','forget','off','liveness-off','intruders-clear','looser','forget-person'\]\.includes\(c\.type\)/, 'deleting the pictures asks the Mac owner to confirm first');
  assert.match(main, /if \(screenLocked \|\| ownerGuard\.state !== 'idle'\) return;/, 'it waits until the screen is unlocked and the alarm is over before telling you');
  assert.match(page, /window\.__relaySnapshot = \(\) =>/); assert.match(page, /lastFaces = both\.filter\(Boolean\)/);
});

test('"why didn\'t it alert?": each reason a face did not set off the alarm is recorded and explained in words', () => {
  const cfg = { enabled: true, seconds: 20, threshold: 0.4 }; // margin 0.12: below 0.28 is a stranger, 0.28 to 0.4 is "not sure"
  const run = (extra, scores, n = 8) => { const m = make(cfg, { strangerFrames: 5, ...extra }); m.feed(scores, n); return m; };
  const a = run({ unarmed: true }, [0.05]); assert.equal(a.g.state, 'idle'); assert.match(a.g.explain(), /Relay had not recognised you yet since it last started, so it was not guarding.*restart while you are away/);
  const b = make(cfg, { strangerFrames: 5 }); b.g.dismiss('fingerprint'); b.feed([0.05], 8); assert.equal(b.g.state, 'idle'); assert.match(b.g.explain(), /stopped an alarm with your fingerprint a few minutes earlier/);
  const c = run({}, [0.33]); assert.equal(c.g.state, 'idle'); assert.match(c.g.explain(), /scored 0\.33 to 0\.33 against yours\. The alarm needs a score below 0\.28.*"not sure" zone, which never alarms/);
  const d = run({}, [0.5]); assert.equal(d.g.state, 'idle'); assert.match(d.g.explain(), /matched yours at only 0\.50 to 0\.50.*above the 0\.40 limit.*look-alike, such as a brother or sister.*stricter/);
  const e = run({}, [0.05]); assert.equal(e.g.state, 'alarm'); assert.match(e.g.explain(), /who was not you set off the alarm/);
  const f = make(cfg, { strangerFrames: 5 }); for (let i = 0; i < 6; i++) { f.clock.t += 1000; f.g.frame({ faces: 1, scores: [null] }); } assert.match(f.g.explain(), /too small, too far or turned away for me to judge/);
  const g = make(cfg, { strangerFrames: 5 }); g.feed([0.05], 3); assert.match(g.g.explain(), /only seen for a moment: the alarm needs five clear looks/, 'a few looks are not enough');
  const none = make(cfg); none.feed([0.9], 5); assert.match(none.g.explain(), /have not noted anyone but you/);
  const nobodyArmed = make(cfg, { unarmed: true }); assert.match(nobodyArmed.g.explain(), /not recognised you yet since Relay started, so I am not guarding until I do/);
});

test('episodes are separated by calm looks, saved through a callback, restored on start, and newest-first with a cap', () => {
  const saved = []; const m = make({ enabled: true, seconds: 20, threshold: 0.4 }, { onEpisode: (ep, all) => saved.push([ep, all.length]) });
  m.feed([0.33], 4); m.feed([0.9], 3); assert.equal(saved.length, 1, 'three looks of you end the episode'); assert.equal(saved[0][0].counts.unsure, 4);
  m.feed([0.05], 2); m.feed([], 3); assert.equal(saved.length, 2, 'nobody in view for three looks ends it too');
  m.clock.t += 60000; m.feed([0.33], 2); m.clock.t += 20000; m.feed([0.33], 1); assert.equal(saved.length, 3, 'a gap of more than 15 seconds starts a new one');
  const restored = new OwnerGuard({ lock: async () => {}, getConfig: () => ({ enabled: true, threshold: 0.4 }), episodes: saved.map((s) => s[0]), now: () => 5e6 });
  assert.equal(restored.episodes.length, 3); assert.match(restored.explain({ enabled: true, threshold: 0.4 }, { count: 1 }), /^At .*:/, 'what was seen before a restart can still be explained');
  const many = new OwnerGuard({ lock: async () => {}, getConfig: () => ({}), episodes: Array.from({ length: 80 }, (_, i) => ({ at: i, seconds: 1, faces: 1, counts: { unsure: 1 }, gates: {}, best: 0.3, worst: 0.3, alarmed: false })) });
  assert.equal(many.episodes.length, 30, 'only the latest 30 are kept');
});

test('main: a fingerprint stop discards the pictures, the guard starts armed if you were seen in the last day, and "stricter/looser" move the limit within bounds (looser asks for confirmation)', () => {
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '../src/main/main.js'), 'utf8');
  assert.match(src, /if \(outcome === 'fingerprint'\) \{ learnFromAlarmVisit\(id\); intruderLog\.remove\(id\); \} else intruderLog\.finish\(id, outcome\)/, 'that was you, so the pictures are not kept');
  assert.match(src, /Date\.now\(\) - \(Number\(store\.get\('ownerArmedAt'\)\) \|\| 0\) < 24 \* 3600 \* 1000 && ownerState\.templates\.length > 0\) ownerGuard\.armed = true/);
  assert.match(src, /onOwnerSeen: \(\) => \{ store\.set\('ownerArmedAt', Date\.now\(\)\); tellAboutVisits\(\); \}/);
  assert.match(src, /ownerGuard\.dismiss\('fingerprint'\); store\.set\('ownerArmedAt', Date\.now\(\)\)/);
  assert.match(src, /Math\.min\(0\.6, Math\.max\(0\.3, now \+ \(c\.type === 'stricter' \? 0\.05 : -0\.05\)\)\)/);
  assert.match(src, /'intruders-clear','looser','forget-person'\]\.includes\(c\.type\)/);
  assert.match(src, /episodes: store\.get\('ownerEpisodes'\) \|\| \[\]/);
});

test('a stranger whose face keeps turning away or going unclear still starts the alarm (the count pauses on unclear looks, not resets)', () => {
  const m = make({ enabled: true, seconds: 20, threshold: 0.4 }); const f = (scores, faces = scores.length) => { m.clock.t += 1000; return m.g.frame({ faces, scores }); };
  f([0.01]); f([], 1); f([0.33]); f([0.01]); f([], 1); f([0.01]);
  assert.equal(events(m, 'alarm').length, 1, 'three stranger looks with unclear ones between them reach the alarm');
});

test('unclear looks do not hide you: your face, an empty chair, or a long stretch of unclear looks still resets the stranger count', () => {
  let m = make({ enabled: true, seconds: 20, threshold: 0.4 }); let f = (scores, faces = scores.length) => { m.clock.t += 1000; return m.g.frame({ faces, scores }); };
  f([0.01]); f([0.01]); f([0.9]); f([0.01]); f([0.01]);
  assert.equal(events(m, 'alarm').length, 0, 'you in between resets it');
  m = make({ enabled: true, seconds: 20, threshold: 0.4 }); f = (scores, faces = scores.length) => { m.clock.t += 1000; return m.g.frame({ faces, scores }); };
  f([0.01]); f([0.01]); f([], 0); f([0.01]);
  assert.equal(events(m, 'alarm').length, 0, 'nobody in view resets it');
  m = make({ enabled: true, seconds: 20, threshold: 0.4 }); f = (scores, faces = scores.length) => { m.clock.t += 1000; return m.g.frame({ faces, scores }); };
  f([0.01]); f([0.01]); for (let i = 0; i < 13; i++) f([], 1); f([0.01]);
  assert.equal(events(m, 'alarm').length, 0, 'a long stretch of unclear looks is not a stranger sitting there');
});

test('a stranger with a low score is still caught at once, even when your own face is steady, and a stranger whose face is turned away is not judged', () => {
  const m = make(); m.feed([0.02], 4);
  assert.equal(m.g.state, 'alarm', 'a clearly different face starts the alarm within a few looks');
  const n = make(); for (let i = 0; i < 20; i++) { n.clock.t += 1000; n.g.frame({ faces: 1, scores: [], down: true }); }
  assert.deepEqual(n.log, [], 'a face turned away or down is neither you nor a stranger');
});

test('an alarm you stop with your fingerprint teaches Relay your face, but only when that is safe', () => {
  const { learnFromAlarm } = require('../src/main/ownerGuard');
  const unit = (v) => { const n = Math.hypot(...v); return v.map((x) => x / n); };
  const mk = (i, j) => { const v = new Array(128).fill(0); v[0] = 1; v[i] = j; return unit(v); }; // cosine with mk(1,0) = 1/sqrt(1+j^2)
  const mine = [mk(1, 0)], near = mk(2, 2.2); // cosine ~0.41? build from j: 1/sqrt(1+4.84)=0.41 (above the 0.363 limit) so use a larger j
  const lookalike = mk(2, 3.5); // 1/sqrt(1+12.25)=0.275: close to you but below the limit
  const stranger = mk(2, 20); // ~0.05: nothing like you
  const base = { templates: mine, sinceSeenMs: 30000, threshold: 0.363 };
  let r = learnFromAlarm({ ...base, embeddings: [lookalike] }); assert.equal(r.learned, 1); assert.equal(r.samples.length, 2);
  assert.equal(learnFromAlarm({ ...base, embeddings: [stranger] }).learned, 0, 'a face nothing like yours is never learned');
  assert.equal(learnFromAlarm({ ...base, embeddings: [near] }).learned, 0, 'a face that already counts as you needs no teaching');
  assert.equal(learnFromAlarm({ ...base, sinceSeenMs: 300000, embeddings: [lookalike] }).learned, 0, 'you were not seen just before the alarm');
  assert.equal(learnFromAlarm({ ...base, sinceSeenMs: -5, embeddings: [lookalike] }).learned, 0);
  assert.equal(learnFromAlarm({ ...base, embeddings: [lookalike, mk(5, 3.5)] }).learned, 0, 'two different people in the pictures: nothing is learned');
  assert.equal(learnFromAlarm({ ...base, embeddings: [] }).learned, 0); assert.equal(learnFromAlarm({ ...base, templates: [], embeddings: [lookalike] }).learned, 0);
  r = learnFromAlarm({ ...base, templates: Array.from({ length: 24 }, (_, i) => mk(40 + i, 0.01 * (i + 1))), embeddings: [lookalike] }); assert.equal(r.learned, 0, 'never more than 24 faces');
  assert.deepEqual(parseOwnerCommand('undo what you learned'), { type: 'unlearn' });
  assert.deepEqual(parseOwnerCommand('forget the faces you added from alarms'), { type: 'unlearn' });
});
