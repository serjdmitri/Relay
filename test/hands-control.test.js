const test = require('node:test');
const assert = require('node:assert/strict');
const { HandControl } = require('../src/main/hands/control');
const { HoloManager } = require('../src/main/holo/manager');

let wc = 1;
function fakeHolo(mode = 'whole') {
  const w = { sent: [], input: [], destroyed: false, visible: false, bounds: { x: 0, y: 0, width: 1800, height: 1100 }, ready: Promise.resolve(), webContents: { id: wc++, send: (...a) => w.sent.push(a), sendInputEvent: (e) => w.input.push(e), executeJavaScript: async () => mode } };
  Object.assign(w, { setBounds(b) { w.bounds = b; }, showInactive() { w.visible = true; }, close() { w.destroyed = true; }, isDestroyed: () => w.destroyed });
  return w;
}

async function rig(mode = 'whole') {
  const wins = [];
  const holos = new HoloManager({ createWindow: () => { const w = fakeHolo(mode); wins.push(w); return w; }, cursor: () => ({ x: 0, y: 0 }), area: () => ({ x: 0, y: 0, width: 1800, height: 1100 }), download: async () => Buffer.alloc(0), saved: () => [], save: () => {} });
  const h = holos.get(await holos.show({ title: 'Skull', items: [{ kind: 'shapes', title: 'Skull', parts: [] }], x: 900, y: 550 }));
  const mics = [], ring = [];
  const hc = new HandControl({ holos, display: () => ({ x: 0, y: 0, width: 1801, height: 1101 }), askAccess: async () => true, createCamera: async () => ({ close() {} }), createCursor: () => ({ moveTo: (p) => ring.push(p), setState: (s) => ring.push(s), hide() {}, close() {} }), onMic: (id) => mics.push(id), now: () => Date.now() + (hc.t = (hc.t || 0) + 100) });
  await hc.enable();
  const at = (x, y) => ({ x: x / 1800, y: y / 1100 });
  return { hc, h, wins, mics, ring, at, ev: async (e) => { await hc.handle(e); } };
}

test('an open hand over a hologram moves the pointer there; far from any hologram nothing is touched', async () => {
  const { hc, h, ev, at } = await rig();
  await ev({ type: 'move', ...at(900, 550) });
  assert.deepEqual(h.win.input.at(-1), { type: 'mouseMove', x: 900, y: 550, button: 'left', clickCount: 1 });
  const n = h.win.input.length;
  await ev({ type: 'move', ...at(100, 100) });
  assert.equal(h.win.input.length, n, 'nothing near: no pointer event for any hologram');
  assert.equal(hc.virtualCursor(), null, 'and the real pointer is not replaced');
});

test('a fist grabs and moves the whole hologram, then releases it', async () => {
  const { hc, h, ev, at } = await rig('whole');
  await ev({ type: 'grab', ...at(900, 550) });
  assert.deepEqual(hc.virtualCursor(), { x: 900, y: 550 });
  await ev({ type: 'move', ...at(1100, 600), held: true });
  assert.deepEqual(hc.virtualCursor(), { x: 1100, y: 600 }, 'the hand now is the pointer for dragging');
  assert.deepEqual({ x: h.x, y: h.y }, { x: 1100, y: 600 });
  await ev({ type: 'release', ...at(1100, 600) });
  assert.equal(hc.virtualCursor(), null);
});

test('when pieces or shapes are showing, a fist carries the piece instead (a plain press)', async () => {
  const { h, ev, at } = await rig('parts');
  await ev({ type: 'grab', ...at(950, 560) });
  assert.equal(h.win.input.find((e) => e.type === 'mouseDown').modifiers, undefined);
});

test('a pinch clicks where the hand is; held, it presses and drags (turns the model)', async () => {
  const { h, ev, at } = await rig();
  await ev({ type: 'click', ...at(880, 540) });
  assert.deepEqual(h.win.input.slice(-3).map((e) => e.type), ['mouseMove', 'mouseDown', 'mouseUp']);
  h.win.input.length = 0;
  await ev({ type: 'pinchdown', ...at(880, 540) });
  await ev({ type: 'move', ...at(960, 560), held: true });
  await ev({ type: 'pinchup', ...at(960, 560) });
  assert.deepEqual(h.win.input.map((e) => e.type), ['mouseMove', 'mouseDown', 'mouseMove', 'mouseUp']);
});

test('two hands resize the hologram under them; the peace sign opens the mic for it; losing the hand lets go', async () => {
  const { hc, h, ev, at, mics } = await rig();
  await ev({ type: 'move', ...at(900, 550) });
  await ev({ type: 'scale', factor: 1.25, ...at(900, 550) });
  assert.deepEqual(h.win.sent.at(-1), ['holo:state', 'hand-scale', 1.25]);
  await ev({ type: 'mic', ...at(930, 560) });
  assert.deepEqual(mics, [h.id]);
  await ev({ type: 'grab', ...at(900, 550) });
  assert.ok(hc.captured);
  await ev({ type: 'lost' });
  assert.equal(hc.captured, null);
  assert.equal(hc.drag, null);
});

test('it is off until enabled, needs the camera allowed, and turning it off closes the camera and the ring', async () => {
  const holos = { holoNear: () => null, latest: () => null };
  let closed = 0;
  const denied = new HandControl({ holos, display: () => ({ x: 0, y: 0, width: 10, height: 10 }), askAccess: async () => false, createCamera: async () => ({ close() { closed++; } }), createCursor: () => ({ close() { closed++; } }) });
  const r = await denied.enable();
  assert.equal(r.ok, false);
  assert.match(r.error, /Camera access is off/);
  assert.equal(denied.enabled, false);
  const ok = new HandControl({ holos, display: () => ({ x: 0, y: 0, width: 10, height: 10 }), askAccess: async () => true, createCamera: async () => ({ close() { closed++; } }), createCursor: () => ({ close() { closed++; } }) });
  await ok.enable();
  ok.setStatus({ state: 'running' });
  assert.equal(ok.status, 'running');
  ok.disable();
  assert.equal(closed, 5, 'the camera and all four cursor windows close');
  assert.equal(ok.status, 'off');
  ok.frame({ t: 1, hands: [{ x: 0.5, y: 0.5, gesture: 'Open_Palm', pinch: 0.9, size: 0.2, score: 1 }] }); // ignored once off
});

test('four hands drive four distinct cursors and all are released on disable', async () => {
  const { hc } = await rig();
  const hands = [0.15, 0.35, 0.65, 0.85].map((x, i) => ({ x, y: 0.5, gesture: 'Open_Palm', pinch: 0.9, size: 0.1, score: 1, handed: i % 2 ? 'Right' : 'Left' }));
  hc.frame({ t: 1000, hands });
  await new Promise((resolve) => setImmediate(resolve));
  const cursors = [hc, hc.peer, ...hc.extraPeers];
  assert.equal(cursors.length, 4);
  assert.equal(new Set(cursors.map((c) => c.pos?.x)).size, 4);
  hc.frame({ t: 4000, hands });
  assert.equal(hc.paused, false, 'multiple people showing palms do not pause control');
  hc.disable();
  assert.equal(hc.extraPeers.length, 0);
  assert.equal(hc.enabled, false);
});

test('another hand cannot click or close a hologram being manipulated', async () => {
  const { hc, h, at } = await rig();
  await hc.handle({ type: 'pinchdown', ...at(900, 550) });
  const before = h.win.input.length;
  for (const type of ['move', 'pinchdown', 'click', 'point', 'thumbdown']) await hc.peer.handle({ type, ...at(900, 550) });
  assert.equal(h.win.input.length, before);
  assert.equal(h.win.isDestroyed(), false);
  await hc.handle({ type: 'pinchup', ...at(900, 550) });
  await hc.peer.handle({ type: 'pinchdown', ...at(900, 550) });
  assert.equal(hc.peer.captured, h);
  hc.disable();
});

test('thumb up pins the hologram, thumb down closes it, a swipe steps to the next model, fists pull apart, twisting rolls', async () => {
  const { hc, h, ev, at } = await rig();
  const stepped = [];
  hc.holos.step = async (id, dir) => stepped.push([id, dir]);
  await ev({ type: 'move', ...at(900, 550) });
  await ev({ type: 'swipe', dir: 'right', ...at(900, 550) });
  await ev({ type: 'swipe', dir: 'left', ...at(900, 550) });
  assert.deepEqual(stepped, [[h.id, 1], [h.id, -1]]);
  await ev({ type: 'pull', open: true, ...at(900, 550) });
  assert.deepEqual(h.win.sent.at(-1), ['holo:state', 'hand-explode', true]);
  await ev({ type: 'twist', angle: 0.2, ...at(900, 550) });
  assert.deepEqual(h.win.sent.at(-1), ['holo:state', 'hand-twist', 0.2]);
  await ev({ type: 'thumbup', ...at(900, 550) });
  assert.equal(h.pinned, true);
  assert.deepEqual(h.win.sent.at(-1), ['holo:state', 'pinned', true]);
  await ev({ type: 'thumbdown', ...at(900, 550) });
  assert.equal(hc.holos.get(h.id), null, 'closed');
});

test('while a hand is in view the controls are drawn bigger, and they go back a moment after it leaves', async () => {
  const { hc, h } = await rig();
  hc.frame({ t: 1, hands: [{ x: 0.5, y: 0.5, gesture: 'Open_Palm', pinch: 0.9, size: 0.2, score: 1 }] });
  assert.deepEqual(h.win.sent.filter((s) => s[1] === 'hand-mode').at(-1), ['holo:state', 'hand-mode', true]);
  assert.equal(hc.holos.handMode, true, 'new holograms start big too');
  assert.equal(hc.holos.payload(h).handMode, true);
  hc.frame({ t: 2, hands: [] });
  assert.ok(hc.handTimer, 'back to normal after a short wait, not at once');
  hc.disable();
  assert.deepEqual(h.win.sent.filter((s) => s[1] === 'hand-mode').at(-1), ['holo:state', 'hand-mode', false]);
});

test('pointing clicks where the finger is (picking a piece), and the peace sign opens the mic', async () => {
  const { h, ev, at, mics } = await rig();
  await ev({ type: 'point', ...at(900, 550) });
  assert.deepEqual(h.win.input.slice(-3).map((e) => e.type), ['mouseMove', 'mouseDown', 'mouseUp']);
  await ev({ type: 'mic', ...at(900, 550) });
  assert.deepEqual(mics, [h.id]);
});

test('a pinch alone never draws (over a hologram it turns the model); a fist and a pinch draw, and a rough circle becomes a shape', async () => {
  const calls = [];
  const shapes = [];
  const notes = [];
  const wins = [];
  const holos = new HoloManager({ createWindow: () => { const w = fakeHolo(); wins.push(w); return w; }, cursor: () => ({ x: 0, y: 0 }), area: () => ({ x: 0, y: 0, width: 1800, height: 1100 }), download: async () => Buffer.alloc(0), saved: () => [], save: () => {} });
  const h = holos.get(await holos.show({ title: 'A', items: [{ kind: 'shapes', title: 'A', parts: [] }], x: 400, y: 400 }));
  const hc = new HandControl({ holos, display: () => ({ x: 0, y: 0, width: 1801, height: 1101 }), askAccess: async () => true, createCamera: async () => ({ close() {} }), createCursor: () => ({ moveTo() {}, setState() {}, hide() {}, close() {} }), air: (t, x, y) => calls.push([t, Math.round(x), Math.round(y)]), shape: (r) => shapes.push(r), notify: (m) => notes.push(m) });
  await hc.enable();
  const at = (x, y) => ({ x: x / 1800, y: y / 1100 });
  // one pinch, far from any hologram: nothing is drawn and nothing is pressed
  await hc.handle({ type: 'pinchdown', ...at(1400, 900) });
  await hc.handle({ type: 'move', held: true, ...at(1450, 920) });
  await hc.handle({ type: 'pinchup', ...at(1500, 950) });
  assert.deepEqual(calls, []);
  assert.equal(h.win.input.length, 0);
  // over the hologram it is a press
  await hc.handle({ type: 'pinchdown', ...at(400, 400) });
  assert.equal(h.win.input.at(-1).type, 'mouseDown');
  await hc.handle({ type: 'pinchup', ...at(400, 400) });
  // a fist in one hand and a pinch in the other: a circle drawn in the air
  const n = 40;
  await hc.handle({ type: 'drawstart', ...at(1500 + 150, 700) });
  for (let i = 1; i < n; i++) { const a = (i / (n - 1)) * Math.PI * 2; await hc.handle({ type: 'drawmove', ...at(1500 + 150 * Math.cos(a), 700 + 150 * Math.sin(a)) }); }
  await hc.handle({ type: 'drawend', ...at(1650, 700) });
  assert.deepEqual([calls[0][0], calls.at(-1)[0]], ['start', 'end']);
  assert.equal(shapes.length, 1);
  assert.equal(shapes[0].kind, 'circle');
  assert.ok(Math.abs(shapes[0].cx - 1500) < 20 && Math.abs(shapes[0].w - 300) < 30);
  // a scribble that is nothing: told so, nothing made
  await hc.handle({ type: 'drawstart', ...at(1000, 500) });
  for (let i = 1; i < 30; i++) await hc.handle({ type: 'drawmove', ...at(1000 + Math.sin(i * 0.9) * 140, 500 + Math.cos(i * 2.3) * 120) });
  await hc.handle({ type: 'drawend', ...at(1000, 500) });
  assert.equal(shapes.length, 1);
  assert.match(notes[0], /did not look like a circle/);
  // losing the hands in the middle of a drawing ends it
  await hc.handle({ type: 'drawstart', ...at(900, 900) });
  await hc.handle({ type: 'lost' });
  assert.equal(calls.at(-1)[0], 'end');
});

test('the hand view: shown and hidden on the camera window, remembered when the camera starts, and told what the hands do', async () => {
  const seen = [];
  const cam = { close() {}, setPreview: (on) => seen.push(['preview', on]), action: (a) => seen.push(['action', a.type, a.dir]) };
  const holos = new HoloManager({ createWindow: () => fakeHolo(), cursor: () => ({ x: 0, y: 0 }), area: () => ({ x: 0, y: 0, width: 1800, height: 1100 }) });
  const hc = new HandControl({ holos, display: () => ({ x: 0, y: 0, width: 1801, height: 1101 }), askAccess: async () => true, createCamera: async () => cam, createCursor: () => ({ moveTo() {}, hide() {}, close() {}, setState() {} }), preview: true });
  await hc.enable();
  assert.deepEqual(seen.at(-1), ['preview', true], 'a view that was on stays on when the camera starts');
  await hc.handle({ type: 'move', x: 0.5, y: 0.5 });
  assert.equal(seen.filter((s) => s[0] === 'action').length, 0, 'plain moves are not announced');
  await hc.handle({ type: 'swipe', dir: 'left', x: 0.5, y: 0.5 });
  assert.deepEqual(seen.at(-1), ['action', 'swipe', 'left']);
  hc.setPreview(false);
  assert.deepEqual(seen.at(-1), ['preview', false]);
  await hc.handle({ type: 'click', x: 0.5, y: 0.5 });
  assert.equal(seen.filter((s) => s[0] === 'action').length, 1, 'with the view away nothing is sent to it');
});


test('two visible hands have distinct cursor rings and losing one hides only that cursor', async () => {
  const { hc } = await rig();
  const first = { x: 0.25, y: 0.5, gesture: 'Open_Palm', pinch: 0.9, size: 0.1, score: 1, handed: 'Left' };
  const second = { ...first, x: 0.75, handed: 'Right' };
  hc.frame({ t: 1000, hands: [first, second] });
  assert.notDeepEqual(hc.pos, hc.peer.pos);
  assert.ok(hc.ring && hc.peer.ring && hc.ring !== hc.peer.ring);
  for (let i = 1; i <= 8; i++) hc.frame({ t: 1000 + i * 33, hands: [first] });
  assert.ok(hc.pos);
  assert.equal(hc.peer.pos, null);
  hc.disable();
});

test('a fast right-edge release dismisses only the held floating item; a slow move or lost hand does not', async () => {
  const { hc, ev, at } = await rig();
  let t = 1000, closed = 0, position = { x: 700, y: 500 };
  hc.now = () => t;
  hc.floatingAt = () => ({ key: 'panel:test', position: () => position, move: (x,y) => { position = { x,y }; }, close: () => { closed++; } });
  await ev({ type: 'grab', ...at(800, 550) });
  t += 100;
  await ev({ type: 'move', ...at(1700, 550), held: true });
  await ev({ type: 'release', ...at(1700, 550) });
  assert.equal(closed, 1);
  await ev({ type: 'grab', ...at(800, 550) });
  t += 1000;
  await ev({ type: 'move', ...at(1700, 550), held: true });
  await ev({ type: 'release', ...at(1700, 550) });
  assert.equal(closed, 1, 'a slow move does not dismiss');
  await ev({ type: 'grab', ...at(800, 550) });
  t += 100;
  await ev({ type: 'move', ...at(1700, 550), held: true });
  await ev({ type: 'lost' });
  assert.equal(closed, 1, 'tracking loss does not dismiss');
});


test('each hand can carry a different hologram at the same time', async () => {
  const { hc, h, at } = await rig();
  const other = hc.holos.get(await hc.holos.show({ title: 'Other', items: [{ kind: 'shapes', title: 'Other', parts: [] }], x: 300, y: 300 }));
  await hc.handle({ type: 'grab', ...at(900, 550) });
  await hc.peer.handle({ type: 'grab', ...at(300, 300) });
  await hc.handle({ type: 'move', ...at(1100, 550), held: true });
  await hc.peer.handle({ type: 'move', ...at(450, 350), held: true });
  assert.deepEqual([h.x, h.y], [1100, 550]);
  assert.deepEqual([other.x, other.y], [450, 350]);
  await hc.handle({ type: 'release', ...at(1100, 550) });
  await hc.peer.handle({ type: 'release', ...at(450, 350) });
  hc.disable();
});

test('a right-edge throw closes the held hologram', async () => {
  const { hc, h, ev, at } = await rig();
  let t = 1000; hc.now = () => t;
  await ev({ type: 'grab', ...at(900, 550) });
  t += 100;
  await ev({ type: 'move', ...at(1700, 550), held: true });
  await ev({ type: 'release', ...at(1700, 550) });
  assert.equal(hc.holos.get(h.id), null);
  hc.disable();
});

test('camera frames drive both hands to grab separate floating panels', async () => {
  const { hc } = await rig();
  const positions = [{ x: 200, y: 400 }, { x: 1400, y: 400 }];
  hc.floatingAt = pt => {
    const i = pt.x < 900 ? 0 : 1;
    return { key: `panel:${i}`, position: () => positions[i], move: (x, y) => { positions[i] = { x, y }; }, close() {} };
  };
  hc.peer.floatingAt = hc.floatingAt;
  const hand = (handed, x, gesture) => ({ handed, x, y: 0.5, gesture, pinch: 0.8, score: 1, size: 0.1 });
  for (let i = 0; i < 5; i++) {
    hc.frame({ t: 1000 + i * 33, hands: [hand('Left', 0.8, 'Closed_Fist'), hand('Right', 0.2, 'Closed_Fist')] });
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.ok(hc.drag && hc.peer.drag, 'both hands captured their own panel');
  for (let i = 0; i < 10; i++) {
    hc.frame({ t: 1200 + i * 33, hands: [hand('Right', 0.35, 'Closed_Fist'), hand('Left', 0.65, 'Closed_Fist')] });
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.ok(positions[0].x > 200);
  assert.ok(positions[1].x < 1400);
  hc.disable();
});

test('thumb down closes a panel and swiping moves it without closing', async () => {
  const { hc, ev, at } = await rig();
  let x = 500, closed = 0;
  hc.floatingAt = () => ({ key: 'panel:one', position: () => ({ x, y: 100, width: 300 }), move: px => { x = px; }, close: () => { closed++; } });
  await ev({ type: 'swipe', dir: 'right', ...at(600, 200) });
  assert.ok(x > 500); assert.equal(closed, 0);
  await ev({ type: 'thumbdown', ...at(600, 200) });
  assert.equal(closed, 1);
  hc.disable();
});

test('a released panel glides and closes when it reaches the right edge', async () => {
  const { hc, ev, at } = await rig();
  let t = 1000, x = 900, closed = 0;
  hc.now = () => t;
  hc.floatingAt = () => ({ key: 'panel:glide', position: () => ({ x, y: 400 }), move: value => { x = value; }, close: () => { closed++; } });
  await ev({ type: 'grab', ...at(1000, 500) });
  t += 100;
  await ev({ type: 'move', ...at(1500, 500), held: true });
  await ev({ type: 'release', ...at(1500, 500) });
  assert.equal(closed, 0, 'not dismissed before the glide reaches the edge');
  const start = x;
  await new Promise(resolve => setTimeout(resolve, 400));
  assert.ok(x > start, 'the panel continues moving after release');
  assert.equal(closed, 1, 'the glide reached the right edge');
  hc.disable();
});

test('the tracking margin updates both cursors without restarting hand control', async () => {
  const { hc } = await rig();
  hc.sensitivity = () => 0.3;
  hc.frame({ t: 1000, hands: [] });
  assert.equal(hc.pointer.margin, 0.3);
  assert.equal(hc.peer.pointer.margin, 0.3);
  hc.sensitivity = () => 1;
  hc.frame({ t: 1033, hands: [] });
  assert.equal(hc.pointer.margin, 0.35);
  hc.disable();
});

test('both palms pause once and can resume after being lowered', async () => {
  const { hc } = await rig();
  const palms = [{ x: 0.2, y: 0.5, gesture: 'Open_Palm', pinch: 0.9, score: 1, handed: 'Left' }, { x: 0.8, y: 0.5, gesture: 'Open_Palm', pinch: 0.9, score: 1, handed: 'Right' }];
  hc.frame({ t: 1000, hands: palms }); hc.frame({ t: 2600, hands: palms });
  assert.equal(hc.paused, true);
  hc.frame({ t: 4500, hands: palms }); assert.equal(hc.paused, true, 'one hold only toggles once');
  hc.frame({ t: 4600, hands: [] });
  hc.frame({ t: 4700, hands: palms }); hc.frame({ t: 6300, hands: palms });
  assert.equal(hc.paused, false);
  hc.disable();
});

test('throwing an item registers the undo callback before closing', async () => {
  const { hc, ev, at } = await rig();
  let t = 1000, undo = null, closed = false;
  hc.now = () => t; hc.onThrow = fn => { undo = fn; };
  const restore = () => 'restored';
  hc.floatingAt = () => ({ key: 'panel:undo', position: () => ({ x: 700, y: 500 }), move() {}, close: () => { closed = true; }, undo: restore });
  await ev({ type: 'grab', ...at(800, 550) }); t += 100;
  await ev({ type: 'move', ...at(1700, 550), held: true });
  await ev({ type: 'release', ...at(1700, 550) });
  assert.equal(closed, true); assert.equal(undo, restore);
  hc.disable();
});

test('a configured peace-sign shortcut runs instead of opening the microphone', async () => {
  const { hc, ev, at, mics } = await rig();
  const called = []; hc.shortcut = () => 'timer5'; hc.onShortcut = x => called.push(x);
  await ev({ type: 'mic', ...at(900, 550) });
  assert.deepEqual(called, ['timer5']); assert.deepEqual(mics, []);
  hc.disable();
});

test('calibration saves a bounded reach only after enough two-dimensional motion', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { hc } = await rig(); const saved = []; hc.saveMargin = v => saved.push(v);
  assert.equal(hc.calibrate().ok, true);
  for (let i = 0; i < 24; i++) hc.frame({ t: i * 33, hands: [{ x: i % 2 ? 0.8 : 0.2, y: i % 2 ? 0.75 : 0.25, score: 1 }] });
  t.mock.timers.tick(8000);
  assert.deepEqual(saved, [0.2]);
  hc.calibrate();
  for (let i = 0; i < 24; i++) hc.frame({ t: i * 33, hands: [{ x: 0.5, y: 0.5, score: 1 }] });
  t.mock.timers.tick(8000);
  assert.deepEqual(saved, [0.2], 'a stationary hand does not overwrite calibration');
  hc.disable();
});

test('a fist away from Relay objects drags a Mac window and releases on tracking loss', async () => {
  const { hc, at, ev } = await rig(); const events = [];
  hc.externalDrag = { begin: (_owner, pt) => { events.push(['down', pt]); return true; }, move: (_owner, pt) => events.push(['move', pt]), end: () => events.push(['up']), close() {} };
  await ev({ type: 'grab', ...at(100, 100) });
  await ev({ type: 'move', ...at(250, 140), held: true });
  await ev({ type: 'lost' });
  assert.deepEqual(events.map(e => e[0]), ['down', 'move', 'up']);
  hc.disable();
});
