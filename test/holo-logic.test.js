const test = require('node:test');
const assert = require('node:assert/strict');
const { overlapRatio, mergeTarget, layoutX, cycle, toSaved, cleanSaved } = require('../src/main/holo/logic');

const rect = (x, y, w = 400, h = 500) => ({ x, y, width: w, height: h });

test('how much one hologram covers another', () => {
  assert.equal(overlapRatio(rect(0, 0), rect(1000, 0)), 0);
  assert.equal(overlapRatio(rect(0, 0), rect(0, 0)), 1);
  assert.equal(overlapRatio(rect(0, 0), rect(200, 0)), 0.5);
  assert.equal(overlapRatio(rect(0, 0, 100, 100), rect(0, 0, 400, 500)), 1, 'a small one fully inside a big one');
});

test('a hologram dropped on another picks the one it covers most, past a third', () => {
  const others = [{ id: 'a', bounds: rect(300, 0) }, { id: 'b', bounds: rect(100, 0) }];
  assert.equal(mergeTarget(rect(0, 0), others), 'b'); // covers b by 75%, a by 25%
  assert.equal(mergeTarget(rect(0, 0), [{ id: 'a', bounds: rect(300, 0) }]), null, 'only a quarter covered: not yet');
  assert.equal(mergeTarget(rect(0, 0), []), null);
});

test('models in a combined hologram sit side by side, centred', () => {
  assert.deepEqual(layoutX([2]), [0]);
  assert.deepEqual(layoutX([2, 2], 0.5), [-1.25, 1.25]);
  const three = layoutX([1, 2, 1], 0);
  assert.deepEqual(three, [-1.5, 0, 1.5]);
});

test('options cycle round in both directions', () => {
  assert.equal(cycle(0, 4, 1), 1);
  assert.equal(cycle(3, 4, 1), 0);
  assert.equal(cycle(0, 4, -1), 3);
  assert.equal(cycle(0, 0, 1), 0);
});

test('a pinned hologram is saved as links, and the saved list is cleaned', () => {
  const saved = toSaved({ id: 'h1', title: 'Skull and heart', x: 100.4, y: 200.6, scale: 1.23456, solid: false, items: [{ kind: 'stl', title: 'Skull', url: 'https://upload.wikimedia.org/a.stl', credit: 'x', bytes: Buffer.from('big') }, { kind: 'shapes', title: 'Atom', parts: [{ shape: 'sphere' }], credit: 'y' }] });
  assert.deepEqual(saved, { id: 'h1', title: 'Skull and heart', pinned: true, x: 100, y: 201, scale: 1.235, solid: false, items: [{ kind: 'stl', title: 'Skull', url: 'https://upload.wikimedia.org/a.stl', credit: 'x' }, { kind: 'shapes', title: 'Atom', parts: [{ shape: 'sphere' }], credit: 'y' }] });
  assert.ok(!JSON.stringify(saved).includes('big'), 'no model bytes are stored');
  const list = [saved, { ...saved, id: 'bad', items: [{ kind: 'stl', title: 'x', url: 'https://evil.example/a.stl' }] }, { ...saved, id: 'unpinned', pinned: false }, null, { pinned: true, items: [] }];
  assert.deepEqual(cleanSaved(list).map((h) => h.id), ['h1']);
  assert.deepEqual(cleanSaved('nonsense'), []);
});
