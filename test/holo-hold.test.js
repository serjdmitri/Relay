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
