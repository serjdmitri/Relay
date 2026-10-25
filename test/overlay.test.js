const test = require('node:test');
const assert = require('node:assert/strict');
const { toGlobal, normalizeShapes, parseFrame, guideCard, displayAt, MAX_SHAPES } = require('../src/main/overlayGeometry');

test('toGlobal applies the scale and the display origin (a second screen can start left of zero)', () => {
  assert.deepEqual(toGlobal(100, 50, { scale: 2 }), { x: 200, y: 100 });
  assert.deepEqual(toGlobal(100, 50, { scale: 2, origin: { x: -1440, y: 0 } }), { x: -1240, y: 100 });
  assert.deepEqual(toGlobal(10, 10), { x: 10, y: 10 });
  assert.throws(() => toGlobal('x', 1), /x must be a number/);
  assert.throws(() => toGlobal(1, null), /y must be a number/);
});

test('normalizeShapes converts every kind from screenshot pixels to global points', () => {
  const out = normalizeShapes([
    { type: 'box', x: 10, y: 20, w: 100, h: 40, label: 'Save' },
    { type: 'circle', x: 50, y: 50, r: 20 },
    { type: 'arrow', x: 0, y: 0, x2: 30, y2: 40, label: 'here' },
    { type: 'text', x: 5, y: 6, text: 'Step one' }
  ], { scale: 2, origin: { x: 1000, y: 10 } });
  assert.deepEqual(out[0], { type: 'box', x: 1020, y: 50, w: 200, h: 80, label: 'Save' });
  assert.deepEqual(out[1], { type: 'circle', x: 1100, y: 110, r: 40, label: '' });
  assert.deepEqual(out[2], { type: 'arrow', x: 1000, y: 10, x2: 1060, y2: 90, label: 'here' });
  assert.deepEqual(out[3], { type: 'text', x: 1010, y: 22, text: 'Step one' });
});

test('normalizeShapes refuses bad input with a message the model can act on', () => {
  assert.throws(() => normalizeShapes([]), /non-empty/);
  assert.throws(() => normalizeShapes('box'), /non-empty/);
  assert.throws(() => normalizeShapes(Array(MAX_SHAPES + 1).fill({ type: 'text', x: 0, y: 0, text: 'a' })), /at most 12/);
  assert.throws(() => normalizeShapes([{ type: 'star', x: 0, y: 0 }]), /Shape 1: type must be one of/);
  assert.throws(() => normalizeShapes([{ type: 'box', x: 0, y: 0, w: 10 }]), /Shape 1: h must be a number/);
  assert.throws(() => normalizeShapes([{ type: 'text', x: 0, y: 0 }]), /needs text/);
  assert.throws(() => normalizeShapes([{ type: 'arrow', x: 0, y: 0, x2: 'a', y2: 1 }]), /x must be a number/);
});

test('normalizeShapes shortens long labels and gives circles a default radius', () => {
  const [a] = normalizeShapes([{ type: 'circle', x: 1, y: 1, label: 'x'.repeat(200) }]);
  assert.equal(a.label.length, 60);
  assert.equal(a.r, 40);
});

test('parseFrame reads the element position System Events returns, including a screen left of the main one', () => {
  assert.deepEqual(parseFrame('100,200,80,30'), { x: 100, y: 200, w: 80, h: 30, cx: 140, cy: 215 });
  assert.equal(parseFrame(' -1440 , 12 , 50 , 20 \n').cx, -1415);
  assert.deepEqual(parseFrame('412,5|20,25|80|30'), { x: 412.5, y: 20.25, w: 80, h: 30, cx: 452.5, cy: 35.25 }, 'a decimal comma locale');
  assert.equal(parseFrame('412.5|20|80|30').x, 412.5);
  assert.throws(() => parseFrame('not found'), /Could not read/);
  assert.throws(() => parseFrame('1,2,3'), /Could not read/);
  assert.throws(() => parseFrame(''), /Could not read/);
  assert.throws(() => parseFrame('10,10,0,20'), /no size on screen/);
});

test('guideCard validates steps and turns the 1-based current step into an index', () => {
  assert.deepEqual(guideCard(['Open Settings', 'Click Displays'], 2), { steps: ['Open Settings', 'Click Displays'], current: 1, total: 2 });
  assert.equal(guideCard(['a', 'b', 'c'], 99).current, 2);
  assert.equal(guideCard(['a', 'b', 'c'], 0).current, 0);
  assert.equal(guideCard(['a', 'b'], 'x').current, 0);
  assert.deepEqual(guideCard(['  one  ', '', 'two']).steps, ['one', 'two']);
  assert.throws(() => guideCard([]), /non-empty/);
  assert.throws(() => guideCard(['', ' ']), /must contain text/);
  assert.throws(() => guideCard(Array(9).fill('x')), /at most 8/);
});

test('displayAt finds the display holding a point, or the nearest one for a point off every screen', () => {
  const main = { id: 1, bounds: { x: 0, y: 0, width: 1440, height: 900 } };
  const side = { id: 2, bounds: { x: 1440, y: 0, width: 1920, height: 1080 } };
  const left = { id: 3, bounds: { x: -1280, y: 100, width: 1280, height: 720 } };
  assert.equal(displayAt([main, side, left], { x: 10, y: 10 }).id, 1);
  assert.equal(displayAt([main, side, left], { x: 2000, y: 500 }).id, 2);
  assert.equal(displayAt([main, side, left], { x: -50, y: 300 }).id, 3);
  assert.equal(displayAt([main, side], { x: 1440, y: 0 }).id, 2);
  assert.equal(displayAt([main, side], { x: 5000, y: 100 }).id, 2);
  assert.equal(displayAt([main, side], { x: 700, y: 2000 }).id, 1);
});
