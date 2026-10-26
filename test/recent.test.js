const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
// recent.js imports electron; the pure EdgeHover needs none of it.
const origLoad = Module._load;
Module._load = function (request, ...rest) { return request === 'electron' ? { BrowserWindow: class {}, screen: {} } : origLoad.call(this, request, ...rest); };
const { EdgeHover } = require('../src/main/recent');
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
  h.update({ x: 1440, y: 200 }, displays, null, 0);
  const r = h.update({ x: 1440, y: 200 }, displays, null, 150);
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
  h.update({ x: 10, y: 450 }, displays, null, 0); // 10 points in, level with the middle of the screen: on the tab
  assert.equal(h.update({ x: 10, y: 450 }, displays, null, 150).action, 'open');
  const far = new EdgeHover({ dwell: 100 });
  far.update({ x: 10, y: 100 }, displays, null, 0); // same distance in, but near the top: not on the tab
  assert.equal(far.update({ x: 10, y: 100 }, displays, null, 150).action, null);
});

test('it opens quickly by default', () => {
  const h = new EdgeHover();
  h.update({ x: 0, y: 400 }, displays, null, 0);
  assert.equal(h.update({ x: 0, y: 400 }, displays, null, 160).action, 'open');
});
