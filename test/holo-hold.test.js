const test = require('node:test');
const assert = require('node:assert/strict');
const { CLOSE_HOLOS } = require('../src/main/holo/closeWords');
const { HoloManager } = require('../src/main/holo/manager');

test('what you say to put the holograms away is understood, and nothing else is taken for it', () => {
  for (const yes of ['close', 'Close it.', 'close the hologram', 'close the holograms', 'clear them', "that's all", 'hide', 'ok close it', 'get rid of everything']) assert.ok(CLOSE_HOLOS.test(yes), yes);
  for (const no of ['close the door', 'close Safari', 'remove the heart', 'close the window on the left', 'hide the dock']) assert.ok(!CLOSE_HOLOS.test(no), no);
});

test('the manager says whether anything is up that is not pinned (so the reactor knows to stay)', async () => {
  const w = () => ({ webContents: { id: Math.random(), send() {} }, ready: Promise.resolve(), setBounds() {}, showInactive() {}, close() {}, isDestroyed: () => false });
  const m = new HoloManager({ createWindow: w, cursor: () => ({ x: 0, y: 0 }), area: () => ({ x: 0, y: 0, width: 1000, height: 800 }), download: async () => Buffer.alloc(0), saved: () => [], save: () => {} });
  assert.equal(m.hasUnpinned(), false);
  const id = await m.show({ title: 'A', items: [{ kind: 'shapes', title: 'A', parts: [] }] });
  assert.equal(m.hasUnpinned(), true);
  let changed = 0;
  m.onChange = () => { changed++; };
  m.pin(id, true);
  assert.equal(m.hasUnpinned(), false, 'pinned: the reactor can go, the hologram stays');
  assert.ok(changed >= 1, 'and the controller is told');
});

test('a save asked for by voice reaches the page and comes back with where the file went', async () => {
  const sent = [];
  const w = () => ({ webContents: { id: Math.random(), send: (...a) => sent.push(a) }, ready: Promise.resolve(), setBounds() {}, showInactive() {}, close() {}, isDestroyed: () => false });
  const m = new HoloManager({ createWindow: w, cursor: () => ({ x: 0, y: 0 }), area: () => ({ x: 0, y: 0, width: 1000, height: 800 }), download: async () => Buffer.alloc(0), saved: () => [], save: () => {} });
  const h = m.get(await m.show({ title: 'A', items: [{ kind: 'shapes', title: 'A', parts: [] }] }));
  const p = m.requestSave(h);
  assert.ok(sent.some((a) => a[0] === 'holo:state' && a[1] === 'save'), 'the page is told to save');
  m.finishSave(h, { ok: true, where: 'Downloads/Relay 3D/A.stl' });
  assert.deepEqual(await p, { ok: true, where: 'Downloads/Relay 3D/A.stl' });
  m.finishSave(h, { ok: false }); // nothing waiting: ignored
});

function fakeWin2() {
  const w = { ignore: null, destroyed: false, webContents: { id: Math.random(), send() {} }, ready: Promise.resolve(), setBounds() {}, showInactive() {}, close() { w.destroyed = true; }, isDestroyed: () => w.destroyed };
  w.setIgnoreMouseEvents = (v) => { w.ignore = v; };
  return w;
}

test('a file dragged over a hologram is accepted while the button is held; clicks go through again afterwards', async () => {
  const cur = { x: 2000, y: 2000 };
  const timers = [];
  const m = new HoloManager({ createWindow: fakeWin2, cursor: () => cur, area: () => ({ x: 0, y: 0, width: 3000, height: 3000 }), download: async () => Buffer.alloc(0), saved: () => [], save: () => {}, setTimer: (fn) => { timers.push(fn); return timers.length; }, clearTimer: () => {} });
  const a = m.get(await m.show({ title: 'A', items: [{ kind: 'shapes', title: 'A', parts: [] }], x: 500, y: 500 }));
  const b = m.get(await m.show({ title: 'B', items: [{ kind: 'shapes', title: 'B', parts: [] }], x: 1500, y: 500 }));
  m.mouseButton(true);
  assert.equal(a.win.ignore, null, 'the pointer is not over anything: nothing changes');
  cur.x = 520; cur.y = 480; timers.at(-1)();
  assert.equal(a.win.ignore, false, 'over the first hologram: its window takes the drag');
  assert.ok(b.win.ignore === null || b.win.ignore === true);
  m.dragging = { id: a.id }; cur.x = 1500; timers.at(-1)(); m.dragging = null; // a hologram being moved is not a file drag
  assert.equal(b.win.ignore, null);
  m.hit = false; m.buttonDown = false; m.restoreDrop();
  assert.equal(a.win.ignore, true, 'and it lets clicks through again');
});
