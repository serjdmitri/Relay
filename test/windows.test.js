const test = require('node:test');
const assert = require('node:assert/strict');
const { layoutRect, pickArea, parseWindowCommand, NAMES } = require('../src/main/windows');
const { normalize } = require('../src/main/commands');

const area = { x: 0, y: 38, w: 1440, h: 800 };

test('layoutRect makes halves, quarters, thirds, centre and full from a display area', () => {
  assert.deepEqual(layoutRect('left', area), { x: 0, y: 38, w: 720, h: 800 });
  assert.deepEqual(layoutRect('right', area), { x: 720, y: 38, w: 720, h: 800 });
  assert.deepEqual(layoutRect('top', area), { x: 0, y: 38, w: 1440, h: 400 });
  assert.deepEqual(layoutRect('bottom', area), { x: 0, y: 438, w: 1440, h: 400 });
  assert.deepEqual(layoutRect('top-right', area), { x: 720, y: 38, w: 720, h: 400 });
  assert.deepEqual(layoutRect('bottom-left', area), { x: 0, y: 438, w: 720, h: 400 });
  assert.deepEqual(layoutRect('maximize', area), area);
  assert.deepEqual(layoutRect('center', area), { x: 274, y: 38 + 104, w: 893, h: 592 });
  assert.deepEqual(layoutRect('middle-third', area), { x: 480, y: 38, w: 480, h: 800 });
  assert.equal(layoutRect('right-third', area).x + layoutRect('right-third', area).w, 1440);
  assert.throws(() => layoutRect('sideways', area), /Unknown position/);
  for (const p of Object.keys(NAMES)) assert.ok(layoutRect(p, area).w > 0);
  const odd = layoutRect('right', { x: -1281, y: 0, w: 1281, h: 719 });
  assert.equal(odd.x + odd.w, 0, 'halves of an odd width still meet with no gap, on a display left of the main one');
});

test('pickArea finds the display the window is on, or the other one', () => {
  const d = [
    { bounds: { x: 0, y: 0, width: 1440, height: 900 }, workArea: { x: 0, y: 38, width: 1440, height: 800 } },
    { bounds: { x: 1440, y: 0, width: 1920, height: 1080 }, workArea: { x: 1440, y: 25, width: 1920, height: 1055 } }
  ];
  assert.equal(pickArea(d, { x: 100, y: 100, w: 600, h: 400 }).index, 0);
  assert.equal(pickArea(d, { x: 1600, y: 100, w: 600, h: 400 }).index, 1);
  assert.equal(pickArea(d, { x: 100, y: 100, w: 600, h: 400 }, 'other').index, 1);
  assert.equal(pickArea(d, { x: 1600, y: 100, w: 600, h: 400 }, 'other').index, 0);
  assert.equal(pickArea(d, { x: 1600, y: 100, w: 600, h: 400 }, 'main').index, 0);
  assert.equal(pickArea(d, null).index, 0, 'no window frame: the first display');
  assert.equal(pickArea(d, { x: 5000, y: 5000, w: 10, h: 10 }).index, 1, 'a window off every screen: the nearest');
  assert.deepEqual(pickArea(d, null, '2'), { x: 1440, y: 25, w: 1920, h: 1055, index: 1 });
  assert.throws(() => pickArea([], null), /No display/);
});

test('window commands are understood in the ways people say them, and nothing else', () => {
  const p = (t) => parseWindowCommand(normalize(t));
  assert.deepEqual(p('Snap this window to the left'), { position: 'left', app: null });
  assert.deepEqual(p('put Chrome on the right half'), { position: 'right', app: 'chrome' });
  assert.deepEqual(p('move this to the top right corner'), { position: 'top-right', app: null });
  assert.deepEqual(p('Move Spotify to the bottom left.'), { position: 'bottom-left', app: 'spotify' });
  assert.deepEqual(p('maximize this window'), { position: 'maximize', app: null });
  assert.deepEqual(p('maximize Safari'), { position: 'maximize', app: 'safari' });
  assert.deepEqual(p('make this full screen'), { position: 'maximize', app: null });
  assert.deepEqual(p('center this window'), { position: 'center', app: null });
  assert.deepEqual(p('center Notes'), { position: 'center', app: 'notes' });
  assert.deepEqual(p('left half'), { position: 'left', app: null });
  assert.deepEqual(p('put this window in the right third'), { position: 'right-third', app: null });
  assert.deepEqual(p('snap my terminal window to the top half'), { position: 'top', app: 'terminal' });
  for (const t of ['open notes', 'what is the weather', 'move my meeting to the right time', 'put milk on my shopping list', 'turn the volume to the left', 'send a message to Sam']) assert.equal(p(t), null, t);
});
