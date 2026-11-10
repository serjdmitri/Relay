const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const { ListenPause, parseListenCommand: p } = require('../src/main/listenPause');
const { AskController } = require('../src/main/askController');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('the words: pause (with or without a time), resume, status; and nothing else is taken for them', () => {
  assert.deepEqual(p('pause listening'), { type: 'listen-pause', seconds: null });
  assert.deepEqual(p('Jarvis, pause listening for an hour'), { type: 'listen-pause', seconds: 3600 });
  assert.deepEqual(p('stop listening for 30 minutes'), { type: 'listen-pause', seconds: 1800 });
  assert.deepEqual(p('mute hey jarvis for two hours'), { type: 'listen-pause', seconds: 7200 });
  assert.deepEqual(p('resume listening'), { type: 'listen-resume' }); assert.deepEqual(p('start listening again'), { type: 'listen-resume' });
  assert.deepEqual(p('are you still listening'), { type: 'listen-status' });
  for (const no of ['pause the music', 'stop listening to me', 'pause listening for banana', 'pause', 'turn on the lights']) assert.equal(p(no), null, no);
});

function rig() {
  let t = 1e9; const timers = []; const changes = [];
  const lp = new ListenPause({ now: () => t, setTimer: (fn, ms) => { const h = { fn, ms, unref() {} }; timers.push(h); return h; }, clearTimer: (h) => { if (h) h.cleared = true; }, onChange: () => changes.push(lp.paused()) });
  return { lp, timers, changes, at: (ms) => { t = ms; } };
}

test('paused until told otherwise, or for a set time and then it starts again by itself, even if the timer is missed', () => {
  const r = rig(); assert.equal(r.lp.paused(), false);
  r.lp.pause(null); assert.equal(r.lp.paused(), true); assert.match(r.lp.describe(), /until you say resume/); assert.equal(r.timers.length, 0);
  assert.equal(r.lp.resume(), true); assert.equal(r.lp.paused(), false); assert.equal(r.lp.resume(), false, 'already listening');
  r.lp.pause(1800); assert.equal(r.lp.paused(), true); assert.match(r.lp.describe(), /about 30 more minutes/);
  r.timers.at(-1).fn(); assert.equal(r.lp.paused(), false, 'the timer resumes it');
  const late = rig(); late.lp.pause(60); late.at(1e9 + 61000); assert.equal(late.lp.paused(), false, 'a missed timer cannot leave it off');
  const cap = rig(); cap.lp.pause(10 * 24 * 3600); assert.ok(cap.timers.at(-1).ms <= 24 * 3600 * 1000 + 100, 'never longer than a day');
  assert.deepEqual(r.changes.slice(0, 3), [true, false, true], 'the wake listener is told each time');
});

function ctl(over = {}) {
  const c = Object.create(AskController.prototype); const lp = new ListenPause();
  Object.assign(c, { listenPause: lp, store: { get: (k) => (k === 'settings.wake.enabled' ? true : undefined) }, ...over });
  return { c, lp };
}

test('the command pauses and resumes, says how to come back, and does nothing when Hey Jarvis is off anyway', () => {
  const { c, lp } = ctl();
  const r = c.listenCommand({ type: 'listen-pause', seconds: 3600 });
  assert.equal(lp.paused(), true); assert.match(r.reply, /for 60 minutes/); assert.match(r.reply, /start again by myself/); assert.match(r.reply, /Option key still works/);
  assert.match(c.listenCommand({ type: 'listen-status' }).reply, /paused for about/);
  assert.match(c.listenCommand({ type: 'listen-resume' }).reply, /listening for Hey Jarvis again/); assert.equal(lp.paused(), false);
  const open = c.listenCommand({ type: 'listen-pause', seconds: null }); assert.ok(!/start again by myself/.test(open.reply));
  const off = ctl({ store: { get: () => false } }); assert.match(off.c.listenCommand({ type: 'listen-pause', seconds: null }).reply, /already off/); assert.equal(off.lp.paused(), false);
});

test('while paused the wake listener is not wanted, the once-a-minute check leaves it alone, and the menu bar can resume it', () => {
  const ask = read('src/main/askController.js'), main = read('src/main/main.js');
  assert.match(ask, /enabled: !!this\.store\.get\('settings\.wake\.enabled'\) && !\(this\.listenPause && this\.listenPause\.paused\(\)\)/);
  assert.match(ask, /parseListenCommand\(effective\)/);
  assert.match(main, /settings\.wake\.enabled'\) && !ask\.listenPause\.paused\(\)/);
  assert.match(main, /label: 'Resume Hey Jarvis'/); assert.match(main, /ask\.onListenPauseChange = /);
});
