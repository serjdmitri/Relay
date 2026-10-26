import test from 'node:test';
import assert from 'node:assert/strict';
import { splitTriangles, explodeOffsets } from '../src/renderer/holo-parts.js';

// a unit cube at (ox, oy, oz) as 12 loose triangles
function cube(ox = 0, oy = 0, oz = 0, s = 1) {
  const v = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]].map(([x, y, z]) => [ox + x * s, oy + y * s, oz + z * s]);
  const f = [[0, 1, 2], [0, 2, 3], [4, 6, 5], [4, 7, 6], [0, 4, 5], [0, 5, 1], [2, 6, 7], [2, 7, 3], [0, 3, 7], [0, 7, 4], [1, 5, 6], [1, 6, 2]];
  return f.flatMap((t) => t.flatMap((i) => v[i]));
}
const join = (...parts) => Float32Array.from(parts.flat());

test('separate bodies split along themselves', () => {
  const m = join(cube(0, 0, 0), cube(5, 0, 0), cube(0, 5, 0));
  const r = splitTriangles(m);
  assert.equal(r.kind, 'components');
  assert.equal(r.groups.length, 3);
  assert.ok(r.groups.every((g) => g.length === 12));
});

test('touching cubes stay one piece, and tiny loose bits join the nearest real piece', () => {
  const touching = splitTriangles(join(cube(0, 0, 0), cube(1, 0, 0), cube(1, 1, 0)), { regions: 3 }); // share corners and faces: one body
  assert.equal(touching.kind, 'regions', 'one body has nothing to split along, so it is cut into regions');
  // two big cubes made of many small triangles' worth, plus one lone triangle near the first
  const lone = [0.5, 0.5, 2, 0.6, 0.5, 2, 0.5, 0.6, 2];
  const r = splitTriangles(join(cube(0, 0, 0, 4), cube(30, 0, 0, 4), lone));
  assert.equal(r.kind, 'components');
  assert.equal(r.groups.length, 2);
  assert.equal(r.groups.reduce((s, g) => s + g.length, 0), 25, 'every triangle is in some piece');
});

test('one solid skin is cut into regions by where its triangles are', () => {
  // a long bar of 6 cubes sharing faces (one body)
  const bar = join(...Array.from({ length: 6 }, (_, i) => cube(i, 0, 0)));
  const r = splitTriangles(bar, { regions: 3 });
  assert.equal(r.kind, 'regions');
  assert.equal(r.groups.length, 3);
  assert.equal(r.groups.reduce((s, g) => s + g.length, 0), 72);
  // regions are spread along the bar, not mixed: each region's triangles sit in a narrow x range
  for (const g of r.groups) {
    const xs = g.map((t) => (bar[t * 9] + bar[t * 9 + 3] + bar[t * 9 + 6]) / 3);
    assert.ok(Math.max(...xs) - Math.min(...xs) <= 3.01);
  }
});

test('too few or too many triangles are not split', () => {
  assert.equal(splitTriangles(new Float32Array(9)), null);
  assert.equal(splitTriangles(new Float32Array(9 * 250001)), null);
});

test('pieces move away from the middle, and one at the middle is sent up', () => {
  const o = explodeOffsets([[3, 0, 0], [-3, 0, 0], [0, 0, 0]], [0, 0, 0], 4, 1);
  assert.ok(o[0][0] > 0 && o[1][0] < 0, 'right goes right, left goes left');
  assert.equal(Math.sign(o[0][0]), -Math.sign(o[1][0]));
  assert.ok(o[2][1] > 0, 'the centre piece rises');
  assert.ok(o.every((v) => v.every(Number.isFinite)));
});

import { placeItems } from '../src/renderer/holo-parts.js';

test('combined models are placed against what is already there', () => {
  const sizes = [{ w: 2, h: 2, d: 2 }, { w: 1, h: 1, d: 1 }, { w: 1, h: 1, d: 1 }];
  const out = placeItems(sizes, [null, { anchor: 'top', scale: 1, rotate: [0, 0, 0] }, { anchor: 'right', scale: 2, rotate: [0, 0, 0] }], 0);
  assert.deepEqual(out[0].position, [0, 0, 0]);
  assert.deepEqual(out[1].position, [0, 1.5, 0], 'on top: resting on the first one');
  assert.deepEqual(out[2].position, [2, 0.5, 0], 'to the right of everything so far (x), centred on the combined height (y)');
  assert.equal(out[2].scale, 2);
});

test('a quarter turn swaps the sides used for placing, and "inside" overlaps', () => {
  const sizes = [{ w: 2, h: 2, d: 2 }, { w: 2, h: 0.5, d: 0.5 }];
  const turned = placeItems(sizes, [null, { anchor: 'right', scale: 1, rotate: [0, 0, 90] }], 0);
  assert.equal(turned[1].position[0], 1.25, 'lying down it is 0.5 wide, not 2');
  const inside = placeItems(sizes, [null, { anchor: 'inside', scale: 0.5, rotate: [0, 0, 0] }]);
  assert.deepEqual(inside[1].position, [0, 0, 0]);
  assert.deepEqual(placeItems([sizes[0]], []).length, 1);
});
