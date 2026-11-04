const test = require('node:test'), assert = require('node:assert/strict'), Module = require('node:module');
const { EventEmitter } = require('node:events');
let made = 0;
class Window extends EventEmitter {
  constructor() { super(); made++; this.destroyed = false; this.webContents = new EventEmitter(); this.webContents.send = () => {}; }
  isDestroyed() { return this.destroyed; }
  destroy() { this.destroyed = true; this.emit('closed'); }
  setIgnoreMouseEvents() {} setAlwaysOnTop() {} setVisibleOnAllWorkspaces() {} loadFile() {}
}
const displays = [{ id: 1, bounds: { x: 0, y: 0, width: 1200, height: 800 } }];
const original = Module._load;
Module._load = function (name, ...args) { return name === 'electron' ? { app: {}, BrowserWindow: Window, screen: { getAllDisplays: () => displays } } : original.call(this, name, ...args); };
let Overlay; try { ({ Overlay } = require('../src/main/overlay')); } finally { Module._load = original; }

test('after a lock or sleep the idle overlay windows are replaced with fresh ones, loaded ahead of use', () => {
  const o = new Overlay({ isEnabled: () => true }); const old = o.entry(displays[0]);
  o.renewIdle();
  assert.equal(old.win.destroyed, true, 'the window that sat hidden is gone');
  const fresh = o.wins.get(1);
  assert.ok(fresh && fresh !== old && !fresh.win.destroyed, 'a new one is already loading');
});

test('a window that is showing the reactor or anything else is left alone', () => {
  const o = new Overlay({ isEnabled: () => true }); const e = o.entry(displays[0]);
  o.hudEntry = e; o.renewIdle(); assert.equal(e.win.destroyed, false); assert.equal(o.wins.get(1), e);
  o.hudEntry = null; e.card = true; o.renewIdle(); assert.equal(e.win.destroyed, false);
  e.card = false; e.halo = true; o.renewIdle(); assert.equal(e.win.destroyed, false);
});
