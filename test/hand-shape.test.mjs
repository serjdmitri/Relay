import test from 'node:test';
import assert from 'node:assert/strict';
import shape from '../src/main/hands/shape.js';
const { recognizeStroke, shapeToModel } = shape;

const jitter = (v, a, i) => v + Math.sin(i * 12.9898) * a; // repeatable "hand wobble"
function circle(n = 60, r = 150, cx = 500, cy = 400, wob = 6, turns = 1.05) {
  return Array.from({ length: n }, (_, i) => { const t = (i / (n - 1)) * Math.PI * 2 * turns; return { x: jitter(cx + r * Math.cos(t), wob, i), y: jitter(cy + r * Math.sin(t), wob, i + 7) }; });
}
function poly(corners, per = 18, wob = 5, close = 0.93) {
  const pts = [];
  corners.forEach((a, k) => { const b = corners[(k + 1) % corners.length]; for (let i = 0; i < per; i++) { const t = i / per; pts.push({ x: jitter(a.x + (b.x - a.x) * t, wob, pts.length), y: jitter(a.y + (b.y - a.y) * t, wob, pts.length + 3) }); } });
  return pts.slice(0, Math.floor(pts.length * close) + 1); // the path stops short of where it began, as a hand does
}

test('a rough circle is a circle, however it is wobbled, and starts anywhere', () => {
  assert.equal(recognizeStroke(circle()).kind, 'circle');
  assert.equal(recognizeStroke(circle(40, 90, 200, 200, 9, 0.97)).kind, 'circle');
  const r = recognizeStroke(circle());
  assert.ok(Math.abs(r.w - 300) < 40 && Math.abs(r.cx - 500) < 15, `${r.w} ${r.cx}`);
});

test('a rough box and a rough triangle are told apart', () => {
  const box = recognizeStroke(poly([{ x: 300, y: 300 }, { x: 560, y: 300 }, { x: 560, y: 480 }, { x: 300, y: 480 }]));
  assert.equal(box.kind, 'box');
  assert.ok(Math.abs(box.w - 260) < 30 && Math.abs(box.h - 180) < 30);
  assert.equal(recognizeStroke(poly([{ x: 400, y: 250 }, { x: 560, y: 520 }, { x: 240, y: 520 }])).kind, 'triangle');
});

test('a straight stroke is a line with a direction; a scribble or a tiny stroke is nothing', () => {
  const line = recognizeStroke(Array.from({ length: 30 }, (_, i) => ({ x: 200 + i * 12, y: jitter(300 + i * 4, 3, i) })));
  assert.equal(line.kind, 'line');
  assert.ok(Math.abs(line.angle - Math.atan2(4, 12)) < 0.12);
  assert.equal(recognizeStroke(Array.from({ length: 30 }, (_, i) => ({ x: 400 + (i % 3), y: 400 + (i % 2) }))).kind, 'none');
  assert.equal(recognizeStroke([{ x: 1, y: 1 }]).kind, 'none');
  const scribble = Array.from({ length: 80 }, (_, i) => ({ x: 400 + Math.sin(i * 0.9) * 140, y: 400 + Math.cos(i * 2.3) * 120 }));
  assert.equal(recognizeStroke(scribble).kind, 'none');
  assert.equal(recognizeStroke(poly([{ x: 300, y: 300 }, { x: 560, y: 300 }, { x: 560, y: 480 }, { x: 300, y: 480 }], 18, 5, 0.5)).kind, 'none', 'half a box is not a box');
});

test('a recognised shape becomes the parts of a model, sized by how big it was drawn', () => {
  const sph = shapeToModel({ kind: 'circle', w: 300, h: 296 });
  assert.equal(sph.title, 'Sphere');
  assert.equal(sph.parts[0].shape, 'sphere');
  assert.ok(sph.scale > 1 && sph.scale < 1.3);
  const cube = shapeToModel({ kind: 'box', w: 200, h: 205 });
  assert.equal(cube.title, 'Cube');
  const slab = shapeToModel({ kind: 'box', w: 400, h: 100 });
  assert.equal(slab.title, 'Box');
  assert.deepEqual(slab.parts[0].size.map((v) => +v.toFixed(2)), [2, 0.5, 0.5]);
  assert.equal(shapeToModel({ kind: 'triangle', w: 200, h: 220 }).parts[0].shape, 'cone');
  assert.equal(shapeToModel({ kind: 'circle', w: 400, h: 150 }).parts[0].shape, 'capsule');
  assert.equal(shapeToModel({ kind: 'line', w: 300, h: 0, angle: 0 }).parts[0].shape, 'cylinder');
  assert.equal(shapeToModel({ kind: 'none' }), null);
  assert.equal(shapeToModel({ kind: 'circle', w: 6000, h: 6000 }).scale, 3, 'never bigger than the screen allows');
  assert.equal(shapeToModel({ kind: 'circle', w: 70, h: 70 }).scale, 0.4);
});
