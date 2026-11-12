const test = require('node:test');
const assert = require('node:assert/strict');
const { CursorBadge } = require('../src/main/cursorBadge');

function rig(over = {}) {
  const r = { wins: [], timers: [], laters: [], cursor: { x: 100, y: 200 }, enabled: true, js: [] };
  class FakeWin {
    constructor(opts) { this.opts = opts; this.visible = false; this.destroyed = false; this.pos = null; this.calls = []; r.wins.push(this);
      this.webContents = { once: (ev, fn) => { this.loaded = fn; }, executeJavaScript: (code) => { r.js.push(code); return Promise.resolve(); } }; }
    setIgnoreMouseEvents(v) { this.calls.push(['ignore', v]); } setAlwaysOnTop(...a) { this.calls.push(['top', ...a]); } setVisibleOnAllWorkspaces(...a) { this.calls.push(['all', ...a]); }
    loadURL(u) { this.url = u; } isDestroyed() { return this.destroyed; } isVisible() { return this.visible; } showInactive() { this.visible = true; } hide() { this.visible = false; }
    setPosition(x, y) { this.pos = [x, y]; } destroy() { this.destroyed = true; }
  }
  r.badge = new CursorBadge({
    BrowserWindow: FakeWin, screen: { getCursorScreenPoint: () => r.cursor }, enabled: () => r.enabled,
    setTimer: (fn) => { const t = { fn }; r.timers.push(t); return t; }, clearTimer: (t) => { if (t) t.cleared = true; },
    setLater: (fn, ms) => { const t = { fn, ms, unref() {} }; r.laters.push(t); return t; }, clearLater: (t) => { if (t) t.cleared = true; }, ...over
  });
  return r;
}

test('the badge is a click-through window on every desktop, shown beside the pointer without taking focus', () => {
  const r = rig();
  r.badge.show('ready');
  const w = r.wins[0];
  assert.equal(w.opts.focusable, false); assert.equal(w.opts.transparent, true);
  assert.deepEqual(w.calls.find((c) => c[0] === 'ignore'), ['ignore', true]);
  assert.equal(w.calls.find((c) => c[0] === 'all')[1], true);
  assert.equal(w.visible, true); assert.deepEqual(w.pos, [122, 222]);
  assert.match(w.url, /^data:text\/html/);
  w.loaded(); assert.ok(r.js.some((c) => c.includes('"pulse"')), 'it is painted once the page has loaded');
});

test('it follows the pointer while shown and stops when hidden', () => {
  const r = rig();
  r.badge.show('ready'); r.cursor = { x: 500, y: 400 }; r.timers[0].fn();
  assert.deepEqual(r.wins[0].pos, [522, 422]);
  r.badge.hide();
  assert.equal(r.wins[0].visible, false); assert.equal(r.timers[0].cleared, true);
  r.badge.show('turn'); assert.equal(r.wins.length, 1, 'the same window is reused');
});

test('the states look different, and an arrow is flashed for the desktop it moves to, then goes away', () => {
  const r = rig();
  r.badge.show('ready'); r.wins[0].loaded();
  r.badge.show('turn'); r.badge.show('blocked');
  assert.ok(r.js.some((c) => c.includes('"turn"')) && r.js.some((c) => c.includes('"blocked"')));
  r.badge.flash('right'); assert.ok(r.js.at(-1).includes('▶'));
  r.badge.show('ready'); assert.ok(r.js.at(-1).includes('▶'), 'nothing replaces the arrow while it shows');
  r.badge.hide(); assert.equal(r.wins[0].visible, true, 'nor hides it');
  r.laters[0].fn(); assert.equal(r.wins[0].visible, false);
  r.badge.flash('left'); assert.ok(r.js.at(-1).includes('◀'));
});

test('it does nothing when the hint is turned off, and close removes the window', () => {
  const r = rig({ enabled: () => false });
  r.badge.show('ready'); r.badge.flash('left');
  assert.equal(r.wins.length, 0);
  const on = rig(); on.badge.show('ready'); on.badge.close();
  assert.equal(on.wins[0].destroyed, true); assert.equal(on.timers[0].cleared, true);
});

test('a fist badge exists, and note shows any short confirmation (a raised hand) then goes away', () => {
  const r = rig();
  r.badge.show('fist'); r.wins[0].loaded(); r.badge.show('fist');
  assert.ok(r.js.some((c) => c.includes('✊')));
  r.badge.note('✋', 1000); assert.equal(r.laters[0].ms, 1000); assert.ok(r.js.at(-1).includes('✋'));
  r.laters[0].fn(); assert.equal(r.wins[0].visible, false);
});
