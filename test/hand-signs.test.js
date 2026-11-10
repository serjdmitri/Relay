const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const { HandPointer } = require('../src/main/hands/logic');
const { HandControl } = require('../src/main/hands/control');

function rig() {
  const events = []; const hp = new HandPointer({ onEvent: (e) => events.push(e) }); let t = 1000;
  const hand = (o = {}) => ({ x: 0.5, y: 0.5, gesture: 'Open_Palm', pinch: 0.9, size: 0.2, score: 1, ...o });
  const run = (n, hands) => { for (let i = 0; i < n; i++) { hp.update({ t, hands: typeof hands === 'function' ? hands(i) : hands }); t += 33; } };
  return { hp, events, run, hand, count: (type) => events.filter((e) => e.type === type).length };
}

test('a rock sign held a moment fires once', () => {
  const r = rig();
  r.run(10, [r.hand({ gesture: 'Rock' })]); assert.equal(r.count('rock'), 0);
  r.run(30, [r.hand({ gesture: 'Rock' })]); assert.equal(r.count('rock'), 1, 'once, however long it is held');
});

test('an open palm held still stops; one that keeps moving (pointing around) never does', () => {
  const r = rig();
  r.run(20, [r.hand()]); assert.equal(r.count('stop'), 0);
  r.run(30, [r.hand()]); assert.equal(r.count('stop'), 1);
  const m = rig();
  m.run(120, (i) => [m.hand({ x: 0.3 + 0.4 * (i % 40) / 40 })]); // a steady sweep across the picture
  assert.equal(m.count('stop'), 0);
});

test('waving the open hand side to side is a wave; a single flick, a slow drift or a still hand is not', () => {
  const w = rig();
  w.run(60, (i) => [w.hand({ x: 0.5 + 0.12 * Math.sin(i * 0.55) })]);
  assert.equal(w.count('wave'), 1, 'one wave, then quiet for a few seconds');
  const d = rig(); d.run(60, (i) => [d.hand({ x: 0.3 + i * 0.004 })]); assert.equal(d.count('wave'), 0, 'drift');
  const s = rig(); s.run(60, [s.hand()]); assert.equal(s.count('wave'), 0, 'still');
  const f = rig(); f.run(60, (i) => [f.hand({ gesture: 'Closed_Fist', x: 0.5 + 0.12 * Math.sin(i * 0.55) })]); assert.equal(f.count('wave'), 0, 'a fist is not a wave');
});

function control(handlers) {
  const done = []; let clock = 1000;
  const hc = new HandControl({ holos: { holoNear: () => null, latest: () => null, holos: new Map() }, display: () => ({ x: 0, y: 0, width: 1801, height: 1101 }), askAccess: async () => true, createCamera: async () => ({ close() {} }), createCursor: () => ({ moveTo() {}, setState() {}, hide() {}, close() {} }), now: () => clock, ...handlers(done) });
  return { hc, done };
}

test('hand control hands the signs to Relay, and a thumb answers a waiting question instead of pinning', async () => {
  const { hc, done } = control((done) => ({ onGesture: (t) => { done.push(t); return t !== 'rock'; } }));
  await hc.enable();
  for (const type of ['rock', 'stop', 'wave']) await hc.handle({ type, x: 0.5, y: 0.5 });
  await hc.handle({ type: 'thumbup', x: 0.5, y: 0.5 }); await hc.handle({ type: 'thumbdown', x: 0.5, y: 0.5 });
  assert.deepEqual(done, ['rock', 'stop', 'wave', 'confirm-yes', 'confirm-no']);
  const off = control((done) => ({ extraGestures: () => false, onGesture: (t) => { done.push(t); return true; } }));
  await off.hc.enable(); await off.hc.handle({ type: 'wave', x: 0.5, y: 0.5 }); await off.hc.handle({ type: 'thumbup', x: 0.5, y: 0.5 });
  assert.deepEqual(off.done, [], 'switched off: nothing');
});

test('main.js wires them safely: a thumb only answers questions that need no approval at the Mac, a wave and a rock wait until Relay is idle', () => {
  const main = fs.readFileSync(path.join(__dirname, '../src/main/main.js'), 'utf8');
  assert.match(main, /confirm-yes'\) return ask\.remoteConfirm\(true\)/);
  assert.match(main, /if \(type === 'wave'\) \{ if \(!idle\) return false/);
  assert.match(main, /type === 'stop'\) return ask\.interruptSpeech\(\)/);
  const ask = fs.readFileSync(path.join(__dirname, '../src/main/askController.js'), 'utf8');
  assert.match(ask, /remoteConfirm\(yes\) \{\s*if \(!this\.pendingConfirm \|\| this\.confirmMacOnly\) return false/);
});
