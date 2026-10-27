import test from 'node:test';
import assert from 'node:assert/strict';
import { rotateVec, resizeFace, moveBy, setField, addShape, duplicateShape, removeShape, toggleHole, bounds, History, snap } from '../src/renderer/holo-cad-spec.js';

const cube = { id: 's1', name: 'Cube', type: 'box', size: [40, 40, 40], pos: [0, 20, 0], rot: [0, 0, 0], hole: false, color: '#8ec7e6' };
const base = () => ({ shapes: [{ ...cube, size: [...cube.size], pos: [...cube.pos], rot: [...cube.rot] }] });

test('dragging a face grows the shape that way and keeps the opposite face where it was', () => {
  const grown = resizeFace(cube, 0, 1, 10);
  assert.deepEqual(grown.size, [50, 40, 40]);
  assert.deepEqual(grown.pos, [5, 20, 0], 'the right face moved 10, the left stayed at -20');
  const other = resizeFace(cube, 1, -1, -10); // pulling the bottom face down 10 (towards -y): grows by 10 downwards
  assert.deepEqual([other.size[1], other.pos[1]], [50, 15]);
  assert.equal(resizeFace(cube, 0, 1, -100).size[0], 0.5, 'never smaller than half a millimetre');
});

test('moving snaps to the grid, and typed fields set one number', () => {
  assert.deepEqual(moveBy(cube, [3.4, 0.2, -7.6], 1).pos, [3, 20, -8]);
  assert.deepEqual(moveBy(cube, [3.4, 0, 0], 5).pos, [5, 20, 0]);
  assert.deepEqual(setField(cube, 'size.1', 12.345).size, [40, 12.35, 40]);
  assert.deepEqual(setField(cube, 'pos.2', 7).pos, [0, 20, 7]);
  assert.equal(snap(7.5, 0), 7.5);
});

test('a new shape goes beside what is there, standing on the floor, with its own name; copies are offset', () => {
  let r = addShape(base(), 'cylinder');
  assert.equal(r.spec.shapes.length, 2);
  const c = r.spec.shapes[1];
  assert.deepEqual([c.name, c.type, c.hole], ['Cylinder', 'cylinder', false]);
  assert.deepEqual(c.pos, [36, 10, 0], 'right of the cube (20) + half its own width (10) + 6');
  r = addShape(r.spec, 'cylinder', true);
  assert.equal(r.spec.shapes[2].name, 'Cylinder hole');
  const d = duplicateShape(r.spec, 's2');
  assert.equal(d.spec.shapes[3].name, 'Cylinder 2');
  assert.notDeepEqual(d.spec.shapes[3].pos, d.spec.shapes[1].pos);
  assert.equal(addShape({ shapes: [] }, 'box').spec.shapes[0].pos[1], 10);
});

test('the last solid shape cannot be taken away or turned into a hole; holes and others can', () => {
  let { spec } = addShape(base(), 'cone');
  const withHole = addShape(spec, 'cylinder', true).spec;
  assert.equal(removeShape(withHole, 's3').shapes.length, 2);
  assert.equal(removeShape(base(), 's1').shapes.length, 1, 'kept');
  assert.equal(toggleHole(base(), 's1').shapes[0].hole, false, 'kept solid');
  assert.equal(toggleHole(spec, 's2').shapes[1].hole, true);
  assert.equal(toggleHole(spec, 's2').shapes[1].color, '#ff9f43');
});

test('the bounds of the solids ignore holes and count quarter turns', () => {
  const s = addShape(base(), 'box').spec;
  s.shapes[1].size = [10, 30, 10];
  s.shapes[1].rot = [0, 0, 90];
  s.shapes[1].pos = [40, 5, 0];
  const b = bounds(s);
  assert.deepEqual(b.min, [-20, 0, -20]);
  assert.deepEqual(b.max, [55, 40, 20], 'the turned slab is 30 wide and 10 tall');
  assert.equal(bounds({ shapes: [{ ...cube, hole: true }] }), null);
});

test('undo and redo walk the edits', () => {
  const h = new History(base());
  const a = addShape(base(), 'sphere').spec;
  h.push(a);
  h.push(a);
  assert.equal(h.stack.length, 2, 'an unchanged state is not a step');
  assert.equal(h.undo().shapes.length, 1);
  assert.equal(h.canUndo, false);
  assert.equal(h.redo().shapes.length, 2);
  h.undo();
  h.push(addShape(base(), 'cone').spec);
  assert.equal(h.canRedo, false, 'a new edit drops what could be redone');
});

test('a turned shape grows along its own axis, not the world\'s', () => {
  const v = rotateVec([1, 0, 0], [0, 0, 90]);
  assert.deepEqual(v.map((x) => Math.round(x * 1000) / 1000), [0, 1, 0]);
  const lying = { ...cube, rot: [0, 0, 90], pos: [0, 20, 0] };
  const g = resizeFace(lying, 0, 1, 10); // its own x face now points up
  assert.deepEqual([g.size[0], Math.round(g.pos[0] * 100) / 100, Math.round(g.pos[1] * 100) / 100], [50, 0, 25]);
});
