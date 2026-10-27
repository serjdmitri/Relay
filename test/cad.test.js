const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeCad, applyEdits, describeCad, typeOf } = require('../src/main/models/cad');

const design = () => normalizeCad({ shapes: [
  { name: 'Cube', type: 'cube', size: 40 },
  { name: 'Hole', type: 'cylinder', diameter: 16, through: { of: 'Cube', axis: 'y' } },
  { name: 'Cone', type: 'cone', size: [30, 25, 30], on: { of: 'Cube', side: 'top' } }
] });

test('"a cube with a hole going through it and a cone on top" comes out as the right shapes in the right places', () => {
  const { shapes } = design();
  assert.deepEqual(shapes.map((s) => [s.name, s.type, s.hole]), [['Cube', 'box', false], ['Hole', 'cylinder', true], ['Cone', 'cone', false]]);
  const [cube, hole, cone] = shapes;
  assert.deepEqual(cube.size, [40, 40, 40]);
  assert.equal(cube.pos[1], 20, 'the cube stands on the floor');
  assert.deepEqual(hole.size, [16, 44, 16], 'longer than the cube so it opens on both sides');
  assert.deepEqual(hole.pos, [0, 20, 0], 'in the middle of the cube');
  assert.equal(cone.pos[1], 52.5, 'the cone sits on top: 40 + half its 25 height');
});

test('a hole along another axis is turned to run that way', () => {
  const { shapes } = normalizeCad([{ type: 'box', size: [40, 20, 60] }, { type: 'cylinder', diameter: 10, through: { of: 'Cube', axis: 'z' } }]);
  assert.deepEqual(shapes[1].rot, [90, 0, 0]);
  assert.equal(shapes[1].size[1], 64);
});

test('sizes, types and colours are understood however they are written, and kept in range', () => {
  const { shapes } = normalizeCad([{ shape: 'ball', radius: 15, color: 'red' }, { type: 'donut' }, { type: 'plate', width: 50, height: 2, depth: 30, color: '#abc' }, { type: 'box', size: [-5, 99999, 'x'] }]);
  assert.deepEqual(shapes[0].size, [30, 30, 30]);
  assert.equal(shapes[0].color, '#d9534f');
  assert.equal(shapes[1].type, 'torus');
  assert.deepEqual(shapes[2].size, [50, 2, 30]);
  assert.equal(shapes[2].color, '#aabbcc');
  assert.deepEqual(shapes[3].size, [0.5, 5000, 20]);
  assert.equal(typeOf('triangular prism'), 'wedge');
});

test('a design needs something solid, and no more than forty shapes', () => {
  assert.throws(() => normalizeCad({ shapes: [{ type: 'cylinder', hole: true }] }), /solid/);
  const many = normalizeCad({ shapes: Array.from({ length: 60 }, () => ({ type: 'box' })) });
  assert.equal(many.shapes.length, 40);
  assert.equal(new Set(many.shapes.map((s) => s.name)).size, 40, 'names are unique');
});

test('edits work by name: resize, move, make a hole bigger, add, remove', () => {
  const d = design();
  let e = applyEdits(d, [{ op: 'set', name: 'Hole', diameter: 24 }, { op: 'set', name: 'cone', move: [0, 5, 0] }, { op: 'add', shape: { type: 'sphere', size: 10, on: { of: 'Cone', side: 'top' }, color: 'gold' } }]);
  assert.deepEqual(e.shapes[1].size, [24, 44, 24], 'the hole keeps its length and gets wider');
  assert.equal(e.shapes[2].pos[1], 57.5);
  assert.equal(e.shapes[3].pos[1], 57.5 + 12.5 + 5);
  e = applyEdits(e, [{ op: 'remove', name: 'Sphere' }, { op: 'set', name: 'Hole', hole: false }]);
  assert.equal(e.shapes.length, 3);
  assert.equal(e.shapes[1].hole, false);
  assert.throws(() => applyEdits(d, [{ op: 'set', name: 'Roof', scale: 2 }]), /no shape called "Roof".*Cube, Hole, Cone/);
  assert.throws(() => applyEdits(d, [{ op: 'remove', name: 'Cube' }, { op: 'remove', name: 'Cone' }]), /no solid/);
  const big = applyEdits(d, [{ op: 'set', name: 'Cube', scale: 2 }]);
  assert.deepEqual(big.shapes[0].size, [80, 80, 80]);
});

test('the description lists names, sizes and places for the model to read', () => {
  const t = describeCad(design());
  assert.match(t, /^Cube: Cube, 40 x 40 x 40 mm/);
  assert.match(t, /Hole: Cylinder \(hole\), 16 x 44 x 16 mm/);
});
