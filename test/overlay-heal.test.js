const test = require('node:test'), assert = require('node:assert/strict'), Module = require('node:module');
const { EventEmitter } = require('node:events');
const windows = [];
class Window extends EventEmitter {
  constructor() { super(); this.destroyed = false; this.visible = false; this.sent = []; this.answers = true; windows.push(this);
    this.webContents = new EventEmitter(); this.webContents.send = (_c, cmd) => this.sent.push(cmd); this.webContents.reload = () => {};
    this.webContents.executeJavaScript = () => (this.answers ? Promise.resolve('complete') : new Promise(() => {})); }
  isDestroyed() { return this.destroyed; } destroy() { this.destroyed = true; this.emit('closed'); }
  setIgnoreMouseEvents() {} setAlwaysOnTop() {} setVisibleOnAllWorkspaces() {} loadFile() {} setHiddenInMissionControl() {}
  isVisible() { return this.visible; } showInactive() { this.visible = true; } hide() { this.visible = false; } setOpacity() {} setBounds() {} getBounds() { return { x: 0, y: 0 }; }
}
const original = Module._load;
Module._load = function (name, ...a) { return name === 'electron' ? { app: {}, BrowserWindow: Window, screen: { getCursorScreenPoint: () => ({ x: 5, y: 5 }), getDisplayNearestPoint: () => display, getAllDisplays: () => [display] } } : original.call(this, name, ...a); };
let Overlay; try { ({ Overlay } = require('../src/main/overlay')); } finally { Module._load = original; }
const display = { id: 1, bounds: { x: 0, y: 0, width: 1200, height: 800 } };
const mk = (logs = []) => new Overlay({ isEnabled: () => true, getLook: () => 'jarvis', log: (k, m) => logs.push(`${k}: ${m}`), probeMs: 20, notReadyMs: 40 });

test('a window whose page does not answer is replaced, and the new one is given the reactor that was meant to show', async () => {
  const logs = [], o = mk(logs), e = o.entry(display); o.hudEntry = e; e.hud = true;
  e.win.webContents.emit('did-finish-load');
  const hud = { type: 'hud', state: { state: 'listening' } }; o.send(e, hud);
  e.win.answers = false; // the page is dead although the window is there
  assert.equal(await o.heal(e, 'test'), true);
  assert.ok(e.win.destroyed); assert.ok(o.hudEntry && o.hudEntry !== e && !o.hudEntry.win.destroyed, 'a fresh window took its place');
  o.hudEntry.win.webContents.emit('did-finish-load');
  assert.deepEqual(o.hudEntry.win.sent.at(-1), hud); assert.ok(o.hudEntry.win.visible, 'and it is shown');
  assert.match(logs[0], /overlay-healed: test/); clearInterval(o.borderTimer);
});

test('a healthy page, or one that is still loading, is left alone', async () => {
  const o = mk(), e = o.entry(display); e.win.webContents.emit('did-finish-load');
  assert.equal(await o.heal(e, 'x'), false); assert.ok(!e.win.destroyed);
  const young = mk(), y = young.entry(display); // never became ready, but only just created
  assert.equal(await young.heal(y, 'x'), false); assert.ok(!y.win.destroyed);
});

test('a page that never becomes ready after something was sent is replaced a moment later', async () => {
  const logs = [], o = mk(logs), e = o.entry(display); e.notReadySince = Date.now() - 5000; e.hud = true; o.hudEntry = e;
  o.send(e, { type: 'hud', state: { state: 'listening' } });
  await new Promise((r) => setTimeout(r, 120));
  assert.ok(e.win.destroyed, 'replaced'); assert.match(logs.join('\n'), /overlay-healed: its page was not ready/);
  clearInterval(o.borderTimer);
});

test('summoning Jarvis checks the page, and the main process logs what it heals', () => {
  const fs = require('fs'), path = require('path');
  assert.match(fs.readFileSync(path.join(__dirname, '../src/main/overlay.js'), 'utf8'), /this\.heal\(he, 'when summoned'\)/);
  assert.match(fs.readFileSync(path.join(__dirname, '../src/main/main.js'), 'utf8'), /log: \(k, m\) => diag\.log\(k, m\) \}\);/);
});
