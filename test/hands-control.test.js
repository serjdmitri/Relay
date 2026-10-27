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

test('a fist grabs and moves the whole hologram (the Option-drag), holding the pointer for the manager while it is held', async () => {
  const { hc, h, ev, at } = await rig('whole');
  await ev({ type: 'grab', ...at(900, 550) });
  const down = h.win.input.find((e) => e.type === 'mouseDown');
  assert.deepEqual(down.modifiers, ['alt']);
  assert.deepEqual(hc.virtualCursor(), { x: 900, y: 550 });
  await ev({ type: 'move', ...at(1100, 600), held: true });
  assert.deepEqual(hc.virtualCursor(), { x: 1100, y: 600 }, 'the hand now is the pointer for dragging');
  assert.deepEqual(h.win.input.at(-1).modifiers, ['leftButtonDown']);
  await ev({ type: 'release', ...at(1100, 600) });
  assert.equal(h.win.input.at(-1).type, 'mouseUp');
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
  assert.equal(h.win.input.at(-1).type, 'mouseUp');
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
  assert.equal(closed, 2);
  assert.equal(ok.status, 'off');
  ok.frame({ t: 1, hands: [{ x: 0.5, y: 0.5, gesture: 'Open_Palm', pinch: 0.9, size: 0.2, score: 1 }] }); // ignored once off
});
