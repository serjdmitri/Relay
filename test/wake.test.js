const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { WakeWord, heardWake } = require('../src/main/wake');

test('heardWake matches the phrase, its greeting variants and one-letter mishearings, near the end of what was heard', () => {
  for (const t of ['Hey Jarvis', 'hey, jarvis!', 'okay jarvis', 'Hi Jarvis open notes', 'um so hey jarvus', 'hey jervis what time is it', 'a jarvis']) assert.ok(heardWake(t, 'hey jarvis'), t);
  for (const t of ['', 'jarvis', 'hey travis', 'hello there', 'service', 'hey jar', 'my jarvis is broken']) assert.ok(!heardWake(t, 'hey jarvis'), t);
  assert.ok(heardWake('hey computer', 'hey computer'));
  assert.ok(!heardWake('hey compost', 'hey computer'), 'a different word is not a match');
  assert.ok(heardWake('jarvis', 'jarvis'), 'a phrase with no greeting is just the name');
  assert.ok(!heardWake('anything', ''), 'no phrase set');
  assert.ok(heardWake('I said hey Jarvis now', 'hey jarvis'));
});

test('the default Jarvis phrase also accepts an explicit wake-up request', () => {
  for (const text of ['Jarvis wake up', 'Jarvis, wake up!', 'jarvus wake up please']) assert.equal(heardWake(text, 'hey jarvis'), true, text);
  for (const text of ['jarvis wake', 'wake up jarvis', 'jarvis wake down']) assert.equal(heardWake(text, 'hey jarvis'), false, text);
  assert.equal(heardWake('jarvis wake up', 'hey computer'), false, 'a custom wake phrase is not broadened');
});

test('a wake-up request activates the listener through the normal wake path', async () => {
  const r = rig();
  await r.w.refresh();
  r.speech.emit('partial', 'Jarvis wake up');
  assert.deepEqual(r.woke, ['Jarvis wake up']);
  assert.equal(r.w.armed, false);
});

function rig(over = {}) {
  const speech = new EventEmitter();
  const log = [];
  speech.listen = async () => { log.push('listen'); };
  speech.cancel = () => log.push('cancel');
  const timers = [];
  const cfg = { enabled: true, phrase: 'hey jarvis' };
  let can = true;
  const woke = [];
  const armed = [];
  const w = new WakeWord({ speech, getConfig: () => cfg, canListen: () => can, onWake: (t) => woke.push(t), onArmed: (a) => armed.push(a), setTimer: (f, ms) => { timers.push({ f, ms }); return timers.length; }, clearTimer: () => {}, ...over });
  return { w, speech, log, cfg, woke, armed, timers, setCan: (v) => { can = v; } };
}

test('it listens only when enabled and Relay is free, and stops when either changes', async () => {
  const r = rig();
  await r.w.refresh();
  assert.deepEqual(r.log, ['listen']);
  assert.deepEqual(r.armed, [true]);
  await r.w.refresh();
  assert.deepEqual(r.log, ['listen'], 'already listening');
  r.setCan(false);
  await r.w.refresh();
  assert.deepEqual(r.log, ['listen', 'cancel']);
  assert.deepEqual(r.armed, [true, false]);
  r.cfg.enabled = false;
  r.setCan(true);
  await r.w.refresh();
  assert.deepEqual(r.log, ['listen', 'cancel'], 'switched off: it stays quiet');
});

test('hearing the phrase stops listening and wakes Relay once', async () => {
  const r = rig();
  await r.w.refresh();
  r.speech.emit('partial', 'hello');
  assert.equal(r.woke.length, 0);
  r.speech.emit('partial', 'hey jarvis');
  assert.equal(r.woke.length, 1);
  assert.ok(!r.w.armed);
  r.speech.emit('partial', 'hey jarvis hey jarvis');
  assert.equal(r.woke.length, 1, 'not armed any more, so nothing more happens');
});

test('a session is renewed now and then, and a failing microphone is retried a few times then left', async () => {
  const r = rig();
  await r.w.refresh();
  assert.equal(r.timers.at(-1).ms, 90000);
  r.timers.at(-1).f(); // the renewal fires: it stops, then starts again shortly
  assert.deepEqual(r.log.slice(-1), ['cancel']);
  const again = r.timers.at(-1);
  assert.equal(again.ms, 400);
  await again.f();
  assert.deepEqual(r.log.slice(-1), ['listen']);

  const bad = rig();
  bad.speech.listen = async () => { throw new Error('mic busy'); };
  bad.w.log = { error() {} };
  for (let i = 0; i < 7; i++) await bad.w.arm();
  assert.equal(bad.w.errors, 7);
  assert.equal(bad.timers.filter((t) => t.ms >= 2000).length, 4, 'retries stop after a few tries');
});
