const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const { EyeBreaks, parseEyeCommand, breakHtml, TICK_MS } = require('../src/main/eyeBreak');
const { decideAway, isMusicSite } = require('../src/main/presenceMedia');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

function rig(over = {}) {
  let t = 1e9, idle = 0, busy = false; const started = []; const cfg = { enabled: true, everyMin: 20, seconds: 20, ...over };
  const e = new EyeBreaks({ cfg: () => cfg, idleSeconds: () => idle, busy: () => busy, start: (s) => started.push(s), now: () => t });
  const run = (minutes) => { for (let i = 0; i < minutes * 2; i++) { t += TICK_MS; e.tick(); } };
  return { e, run, started, cfg, setIdle: (v) => { idle = v; }, setBusy: (v) => { busy = v; } };
}

test('after 20 minutes of work a 20 second break starts, then the clock begins again', () => {
  const r = rig();
  r.run(19); assert.deepEqual(r.started, []);
  r.run(2); assert.deepEqual(r.started, [20]);
  r.run(15); assert.equal(r.started.length, 1); r.run(6); assert.equal(r.started.length, 2);
});

test('time away from the keyboard counts as a break; a meeting or a snooze holds it back; off means off', () => {
  const r = rig(); r.run(15); r.setIdle(300); r.run(5); r.setIdle(0); r.run(15);
  assert.deepEqual(r.started, [], 'the idle stretch reset the clock');
  const m = rig(); m.setBusy(true); m.run(60); assert.deepEqual(m.started, [], 'not during a meeting'); m.setBusy(false); m.run(21); assert.equal(m.started.length, 1);
  const s = rig(); s.run(19); s.e.snooze(10); s.run(9); assert.deepEqual(s.started, []); s.run(5); assert.equal(s.started.length, 1);
  const off = rig({ enabled: false }); off.run(120); assert.deepEqual(off.started, []);
  const odd = rig({ seconds: 9999, everyMin: 1 }); odd.run(1); assert.deepEqual(odd.started, [120], 'the length is kept sane');
});

test('the words, and the blur screen is plain local HTML with a countdown and a skip', () => {
  assert.deepEqual(parseEyeCommand('turn on eye breaks'), { type: 'eye-on' }); assert.deepEqual(parseEyeCommand('Jarvis, turn off the eye breaks'), { type: 'eye-off' });
  assert.deepEqual(parseEyeCommand('take an eye break'), { type: 'eye-now' }); assert.deepEqual(parseEyeCommand('snooze the eye break'), { type: 'eye-snooze' });
  assert.deepEqual(parseEyeCommand('when is my next eye break'), { type: 'eye-status' }); assert.equal(parseEyeCommand('turn on the lights'), null);
  const html = breakHtml(20); assert.match(html, /Look at something far away/); assert.match(html, /relay-skip:\/\/now/); assert.ok(!/https?:\/\//.test(html), 'nothing loaded from outside');
  assert.match(breakHtml(1), /let n=5;/, 'a silly length is kept sane');
  const main = read('src/main/main.js');
  assert.match(main, /vibrancy: 'hud'/); assert.match(main, /startsWith\('relay-skip:'\)/); assert.match(main, /store\.get\('settings\.eyeBreaks'\)/);
  assert.match(read('src/main/store.js'), /eyeBreaks: \{ enabled: false/, 'off until you turn it on');
  assert.match(read('src/main/askController.js'), /parseEyeCommand\(effective\)/);
});

test('leaving the desk: music can be kept playing, video is paused, and what is paused depends on what is playing', () => {
  assert.equal(isMusicSite('https://music.youtube.com/watch?v=1'), true); assert.equal(isMusicSite('https://open.spotify.com/track/x'), true); assert.equal(isMusicSite('https://www.youtube.com/watch?v=1'), false);
  assert.deepEqual(decideAway({ musicApp: 'Spotify' }), { pauseMusicApp: true, pauseVideo: false });
  assert.equal(decideAway({}).pauseMusicApp, true, 'the music pause still works out for itself what is playing');
  assert.deepEqual(decideAway({ musicApp: 'Spotify', keepMusic: true }), { pauseMusicApp: false, pauseVideo: false }, 'keep the music');
  assert.deepEqual(decideAway({ tabs: [{ url: 'https://www.youtube.com/watch?v=1' }] }), { pauseMusicApp: true, pauseVideo: true });
  assert.deepEqual(decideAway({ keepMusic: true, tabs: [{ url: 'https://music.youtube.com/watch?v=1' }] }), { pauseMusicApp: false, pauseVideo: false }, 'a music site is music');
  assert.deepEqual(decideAway({ tabs: [{ url: 'https://music.youtube.com/watch?v=1' }] }), { pauseMusicApp: true, pauseVideo: true });
  assert.equal(decideAway({ pauseVideo: false, tabs: [{ url: 'https://www.youtube.com/x' }] }).pauseVideo, false, 'video pausing switched off');
  assert.equal(decideAway({}).pauseVideo, false, 'nothing playing: nothing pressed');
  assert.match(read('src/main/askController.js'), /decideAway\(\{ keepMusic: cfg\.keepMusic === true/);
  assert.match(read('src/main/store.js'), /keepMusic: false, pauseVideo: true/);
});
