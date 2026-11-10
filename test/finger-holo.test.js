const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const { FingerWatch } = require('../src/main/hands/finger');
const { HandControl } = require('../src/main/hands/control');

const hand = (gesture, x = 0.5, y = 0.5, over = {}) => ({ x, y, size: 0.2, pinch: 0.8, gesture, model: gesture, score: 1, handed: 'Right', ...over });
const rig = () => { const ev = []; return { ev, w: new FingerWatch({ onShow: (h) => ev.push(['show', h.x]), onMove: (h) => ev.push(['move', h.x]), onHide: () => ev.push(['hide']), holdMs: 200, dropMs: 400 }) }; };

test('a middle finger has to be held a moment before the hologram shows, and it follows the hand', () => {
  const { w, ev } = rig();
  w.update({ t: 1000, hands: [hand('Middle_Finger')] });
  w.update({ t: 1100, hands: [hand('Middle_Finger')] });
  assert.deepEqual(ev, [], 'too brief: nothing yet');
  w.update({ t: 1250, hands: [hand('Middle_Finger', 0.4)] });
  w.update({ t: 1300, hands: [hand('Middle_Finger', 0.3)] });
  assert.deepEqual(ev, [['show', 0.4], ['move', 0.3]]);
});

test('a hand passing through the shape for a moment does nothing, and other poses never show it', () => {
  const { w, ev } = rig();
  w.update({ t: 1000, hands: [hand('Middle_Finger')] });
  w.update({ t: 1100, hands: [hand('Open_Palm')] });
  w.update({ t: 1500, hands: [hand('Middle_Finger')] });
  w.update({ t: 1600, hands: [hand('Middle_Finger')] });
  assert.deepEqual(ev, [], 'the hold restarted after the break');
  for (let t = 2000; t < 3000; t += 50) w.update({ t, hands: [hand('Victory'), hand('Closed_Fist')] });
  assert.deepEqual(ev, []);
});

test('it goes away when the finger is put away, not on a one-frame flicker, and only once', () => {
  const { w, ev } = rig();
  for (let t = 1000; t <= 1300; t += 50) w.update({ t, hands: [hand('Middle_Finger')] });
  ev.length = 0;
  w.update({ t: 1400, hands: [] });
  w.update({ t: 1500, hands: [hand('Middle_Finger')] });
  assert.deepEqual(ev, [['move', 0.5]], 'a flicker keeps it up');
  ev.length = 0;
  w.update({ t: 1600, hands: [hand('Closed_Fist')] });
  w.update({ t: 1850, hands: [hand('Closed_Fist')] });
  assert.deepEqual(ev, [], 'still within the grace period');
  w.update({ t: 1950, hands: [hand('Closed_Fist')] });
  w.update({ t: 2100, hands: [] });
  assert.deepEqual(ev, [['hide']]);
});

test('a hand the finder is unsure of is ignored, and reset puts the hologram away', () => {
  const { w, ev } = rig();
  for (let t = 1000; t <= 1400; t += 50) w.update({ t, hands: [hand('Middle_Finger', 0.5, 0.5, { score: 0 })] });
  assert.deepEqual(ev, []);
  for (let t = 2000; t <= 2300; t += 50) w.update({ t, hands: [hand('Middle_Finger')] });
  ev.length = 0; w.reset();
  assert.deepEqual(ev, [['hide']]);
  w.reset(); assert.deepEqual(ev, [['hide']], 'nothing shown, nothing to hide');
});

test('hand control puts the hologram where the hand is on the screen and hides it when hand control stops', async () => {
  const events = []; let clock = 1000;
  const hc = new HandControl({ holos: { holoNear: () => null, holos: new Map() }, display: () => ({ x: 0, y: 0, width: 1801, height: 1101 }), askAccess: async () => true, createCamera: async () => ({ close() {} }), createCursor: () => ({ moveTo() {}, setState() {}, hide() {}, close() {} }), onFinger: (e) => events.push(e), now: () => clock });
  await hc.enable();
  for (let i = 0; i < 6; i++) { clock += 60; hc.frame({ t: clock, hands: [hand('Middle_Finger', 0.5, 0.5)] }); }
  assert.equal(events[0].type, 'show');
  assert.ok(Math.abs(events[0].x - 900) < 40 && Math.abs(events[0].y - 550) < 40, `centred on the hand (${events[0].x}, ${events[0].y})`);
  assert.ok(events.slice(1).every((e) => e.type === 'move'));
  events.length = 0;
  hc.disable();
  assert.deepEqual(events.map((e) => e.type), ['hide']);
});

test('main.js shows a see-through, click-through hologram window from the hand finder, and the page ships with the app', () => {
  const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  const main = read('src/main/main.js');
  assert.match(main, /onFinger: fingerHolo/);
  assert.match(main, /fingerWin\.setIgnoreMouseEvents\(true\)/, 'the hologram never takes a click');
  assert.match(main, /renderer\/finger\.html/);
  assert.ok(fs.existsSync(path.join(__dirname, '../src/renderer/finger.html')));
  assert.match(read('src/renderer/finger.html'), /Content-Security-Policy/);
});
