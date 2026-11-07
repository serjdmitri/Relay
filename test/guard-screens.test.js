const test = require('node:test'), assert = require('node:assert/strict'), Module = require('node:module');
const { EventEmitter } = require('node:events');
class Window extends EventEmitter {
  constructor() { super(); this.destroyed = false; this.webContents = new EventEmitter(); this.webContents.setWindowOpenHandler = () => {}; this.ignoring = false; }
  isDestroyed() { return this.destroyed; } close() { this.destroyed = true; } destroy() { this.destroyed = true; }
  setBounds() {} setAlwaysOnTop() {} setVisibleOnAllWorkspaces() {} setHiddenInMissionControl() {} setIgnoreMouseEvents(v) { this.ignoring = v; } loadFile() {} once() {} showInactive() {}
}
const original = Module._load;
Module._load = function (name, ...args) { return name === 'electron' ? { BrowserWindow: Window, screen: { getAllDisplays: () => [{ id: 1, bounds: { x: 0, y: 0, width: 800, height: 600 } }], getCursorScreenPoint: () => ({ x: 0, y: 0 }), getDisplayNearestPoint: () => ({ id: 1, bounds: { x: 0, y: 0, width: 800, height: 600 }, workArea: { x: 0, y: 0, width: 800, height: 600 } }) }, ipcMain: { handle() {} }, app: {} } : original.call(this, name, ...args); };
let IntruderWindow, Overlay; try { ({ IntruderWindow } = require('../src/main/intruderWindow')); ({ Overlay } = require('../src/main/overlay')); } finally { Module._load = original; }

const mk = () => new IntruderWindow({ touchId: () => false, fingerprint: async () => ({ ok: false }) });

test('a guard screen that nothing wants any more comes down, so it cannot sit over everything swallowing clicks', () => {
  const w = mk(); w.show({ seconds: 20 });
  assert.equal(w.sweep({ alarmWanted: true }), false, 'a live alarm stays');
  w.state.at -= 6000;
  assert.equal(w.sweep({ alarmWanted: false }), true, 'an alarm the guard no longer has is taken down');
  assert.equal(w.state.active, false); assert.equal(w.wins.length, 0);
  w.showAway(); w.state.at -= 20000;
  assert.equal(w.sweep({ awayWanted: true }), false, 'standby stays while you are away');
  assert.equal(w.sweep({ awayWanted: false }), true, 'standby comes down when you are not away');
  w.show({ seconds: 20, demo: true }); w.state.at -= 60000;
  assert.equal(w.sweep({ alarmWanted: false }), false, 'a demo is left to its own timer');
  const stray = mk(); stray.open(); stray.state = { active: false };
  assert.equal(stray.sweep({}), true, 'windows with no state are removed');
  const gone = mk(); gone.open(); gone.wins.forEach((x) => x.destroy());
  assert.equal(gone.sweep({}), false); assert.equal(gone.wins.length, 0);
});

test('releaseInput hands the mouse back to every overlay window and drops a stuck drop target', () => {
  const o = new Overlay({ isEnabled: () => true }); const e = o.entry({ id: 1, bounds: { x: 0, y: 0, width: 800, height: 600 } });
  e.accepting = true; e.win.ignoring = false; o.dropTimer = setInterval(() => {}, 1000); o.marking = e;
  o.releaseInput();
  assert.equal(e.win.ignoring, true, 'clicks pass through again'); assert.equal(e.accepting, false); assert.equal(o.dropTimer, null); assert.equal(o.marking, null);
});
