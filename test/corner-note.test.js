const test = require('node:test');
const assert = require('node:assert/strict');
const { CornerNote } = require('../src/main/cornerNote');

function rig() {
  const r = { wins: [], laters: [], js: [], cursor: { x: 100, y: 200 }, work: { x: 0, y: 25, width: 1440, height: 800 } };
  class FakeWin {
    constructor(opts) { this.opts = opts; this.visible = false; this.destroyed = false; this.pos = null; this.calls = []; r.wins.push(this);
      this.webContents = { once: (ev, fn) => { this.loaded = fn; }, executeJavaScript: (code) => { r.js.push(code); return Promise.resolve(); } }; }
    setIgnoreMouseEvents(v) { this.calls.push(['ignore', v]); } setAlwaysOnTop(...a) { this.calls.push(['top', ...a]); } setVisibleOnAllWorkspaces(...a) { this.calls.push(['all', ...a]); }
    loadURL(u) { this.url = u; } isDestroyed() { return this.destroyed; } isVisible() { return this.visible; } showInactive() { this.visible = true; } hide() { this.visible = false; }
    setPosition(x, y) { this.pos = [x, y]; } destroy() { this.destroyed = true; }
  }
  r.note = new CornerNote({
    BrowserWindow: FakeWin, screen: { getCursorScreenPoint: () => r.cursor, getDisplayNearestPoint: () => ({ workArea: r.work }) },
    setLater: (fn, ms) => { const t = { fn, ms, unref() {} }; r.laters.push(t); return t; }, clearLater: (t) => { if (t) t.cleared = true; }
  });
  return r;
}

test('the message sits in the bottom left of the screen the pointer is on, click-through, without taking focus', () => {
  const r = rig();
  r.note.show('Hand control is on.');
  const w = r.wins[0];
  assert.equal(w.opts.focusable, false); assert.equal(w.opts.transparent, true);
  assert.deepEqual(w.calls.find((c) => c[0] === 'ignore'), ['ignore', true]);
  assert.equal(w.calls.find((c) => c[0] === 'all')[1], true);
  assert.equal(w.visible, true);
  assert.deepEqual(w.pos, [14, 25 + 800 - 92 - 14], 'left edge of the work area, just above the bottom');
  w.loaded(); assert.ok(r.js.at(-1).includes('Hand control is on.'), 'it is painted once the page has loaded');
});

test('it follows the pointer to another screen, goes away by itself, and the window is reused', () => {
  const r = rig();
  r.note.show('One', 3000); r.wins[0].loaded();
  assert.equal(r.laters[0].ms, 3000);
  r.work = { x: 1440, y: 0, width: 1920, height: 1080 };
  r.note.show('Two');
  assert.deepEqual(r.wins[0].pos, [1454, 1080 - 92 - 14]); assert.equal(r.wins.length, 1);
  assert.equal(r.laters[0].cleared, true, 'the first timer was replaced');
  r.laters[1].fn(); assert.equal(r.wins[0].visible, false);
});

test('text is passed safely, nothing is shown for an empty message, and close removes the window', () => {
  const r = rig();
  r.note.show(''); assert.equal(r.wins.length, 0);
  r.note.show('say "hi"\n</script>'); r.wins[0].loaded();
  assert.ok(r.js.at(-1).includes(JSON.stringify('say "hi"\n</script>')));
  r.note.close(); assert.equal(r.wins[0].destroyed, true);
  r.note.show('again'); assert.equal(r.wins.length, 2, 'a fresh window after close');
});
