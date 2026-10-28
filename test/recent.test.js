const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
// recent.js imports electron; the pure EdgeHover needs none of it.
const origLoad = Module._load;
Module._load = function (request, ...rest) { return request === 'electron' ? { BrowserWindow: class {}, screen: {} } : origLoad.call(this, request, ...rest); };
const { EdgeHover, HANDLE_W, HANDLE_H, tabHeight } = require('../src/main/recent');
Module._load = origLoad;

const displays = [{ bounds: { x: 0, y: 0, width: 1440, height: 900 } }, { bounds: { x: 1440, y: 0, width: 1920, height: 1080 } }];
const panel = { x: 12, y: 48, width: 344, height: 600 };

test('resting the pointer on the left edge opens it, passing through does not', () => {
  const h = new EdgeHover({ dwell: 380 });
  assert.equal(h.update({ x: 0, y: 400 }, displays, null, 1000).action, null);
  assert.equal(h.update({ x: 0, y: 400 }, displays, null, 1200).action, null);
  assert.equal(h.update({ x: 300, y: 400 }, displays, null, 1250).action, null, 'it left the edge: the timer starts over');
  assert.equal(h.update({ x: 0, y: 400 }, displays, null, 1300).action, null);
  const r = h.update({ x: 0, y: 400 }, displays, null, 1700);
  assert.equal(r.action, 'open');
  assert.equal(r.display, displays[0]);
});

test('the left edge of a second display opens it on that display', () => {
  const h = new EdgeHover({ dwell: 100 });
  h.update({ x: 1440, y: 540 }, displays, null, 0);
  const r = h.update({ x: 1440, y: 540 }, displays, null, 150);
  assert.equal(r.action, 'open');
  assert.equal(r.display, displays[1]);
});

test('an open panel stays while the pointer is on or near it, and closes after a pause away', () => {
  const h = new EdgeHover({ leave: 700 });
  assert.equal(h.update({ x: 100, y: 200 }, displays, panel, 0).action, null);
  assert.equal(h.update({ x: 380, y: 200 }, displays, panel, 100).action, null, 'a little past the panel still counts');
  assert.equal(h.update({ x: 900, y: 200 }, displays, panel, 200).action, null, 'away, but not for long enough');
  assert.equal(h.update({ x: 900, y: 200 }, displays, panel, 800).action, null);
  assert.equal(h.update({ x: 900, y: 200 }, displays, panel, 950).action, 'close');
  const back = new EdgeHover({ leave: 700 });
  back.update({ x: 900, y: 200 }, displays, panel, 0);
  back.update({ x: 100, y: 200 }, displays, panel, 500); // came back in time
  assert.equal(back.update({ x: 900, y: 200 }, displays, panel, 600).action, null, 'the timer started over');
});

test('resting on the tab that sticks out of the edge opens it, only near its height', () => {
  const h = new EdgeHover({ dwell: 100 });
  h.update({ x: 5, y: 450 }, displays, null, 0); // 5 points in, level with the middle of the screen: on the tab
  assert.equal(h.update({ x: 5, y: 450 }, displays, null, 150).action, 'open');
  const far = new EdgeHover({ dwell: 100 });
  far.update({ x: 5, y: 100 }, displays, null, 0); // same distance in, but near the top: not on the tab
  assert.equal(far.update({ x: 5, y: 100 }, displays, null, 150).action, null);
});

test('it opens quickly by default', () => {
  const h = new EdgeHover();
  h.update({ x: 0, y: 400 }, displays, null, 0);
  assert.equal(h.update({ x: 0, y: 400 }, displays, null, 160).action, 'open');
});


test('only the tab opens it: the rest of the left edge does nothing', () => {
  const h = new EdgeHover({ dwell: 0 });
  assert.equal(h.update({ x: 0, y: 20 }, displays, null, 0).action, null, 'top of the edge');
  assert.equal(h.update({ x: 0, y: 880 }, displays, null, 100).action, null, 'bottom of the edge');
  assert.equal(h.update({ x: 20, y: 450 }, displays, null, 200).action, null, 'beside the tab, not on it');
  assert.equal(h.update({ x: 0, y: 450 }, displays, null, 300).action, 'open', 'on the tab');
});

test('the tab is half as thick as before and three times as tall', () => {
  assert.equal(HANDLE_W, 7);
  assert.equal(HANDLE_H, 360);
  const tall = { bounds: { x: 0, y: 0, width: 1440, height: 900 }, workArea: { x: 0, y: 25, width: 1440, height: 875 } };
  assert.equal(tabHeight(tall), 360);
  const mid = 25 + 875 / 2;
  const on = new EdgeHover({ dwell: 0 });
  assert.equal(on.update({ x: 3, y: mid - 175 }, [tall], null, 0).action, 'open', 'near the top of the tab');
  const off = new EdgeHover({ dwell: 0 });
  assert.equal(off.update({ x: 3, y: mid - 190 }, [tall], null, 0).action, null, 'above the tab');
  assert.equal(tabHeight({ bounds: { x: 0, y: 0, width: 800, height: 400 } }), 340, 'a short screen: less than 360, never off the screen');
});

test('the wait before it opens can be changed', () => {
  const quick = new EdgeHover({ dwell: 0 });
  assert.equal(quick.update({ x: 0, y: 450 }, displays, null, 1000).action, 'open', 'instantly');
  const slow = new EdgeHover({ dwell: 800 });
  slow.update({ x: 0, y: 450 }, displays, null, 0);
  assert.equal(slow.update({ x: 0, y: 450 }, displays, null, 700).action, null);
  assert.equal(slow.update({ x: 0, y: 450 }, displays, null, 850).action, 'open');
  const live = new EdgeHover({ dwell: 800 });
  live.dwell = 100; // Settings changes it while Relay runs
  live.update({ x: 0, y: 450 }, displays, null, 0);
  assert.equal(live.update({ x: 0, y: 450 }, displays, null, 120).action, 'open');
});
