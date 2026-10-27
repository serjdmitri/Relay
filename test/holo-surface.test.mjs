import test from 'node:test';
import assert from 'node:assert/strict';
import { splitSurface } from '../src/renderer/holo-parts.js';

// A crude "car": a long box with four round wheels fixed to its sides, as ONE welded skin.
function box(cx, cy, cz, sx, sy, sz, out) {
  const v = [[-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1], [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]].map(([a, b, c]) => [cx + a * sx, cy + b * sy, cz + c * sz]);
  const f = [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [3, 7, 6, 2], [0, 4, 7, 3], [1, 2, 6, 5]];
  for (const [a, b, c, d] of f) { out.push(...v[a], ...v[b], ...v[c], ...v[a], ...v[c], ...v[d]); }
}
function wheel(cx, cy, cz, r, w, out, n = 24) {
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2;
    const p = (a, z) => [cx + Math.cos(a) * r, cy + Math.sin(a) * r, cz + z];
    const A = p(a0, -w), B = p(a1, -w), C = p(a1, w), D = p(a0, w);
    out.push(...A, ...B, ...C, ...A, ...C, ...D); // tread
    out.push(cx, cy, cz + w, ...D, ...C); // outer face
    out.push(cx, cy, cz - w, ...B, ...A); // inner face
  }
}

test('a skin made of a body and four wheels is cut into the body and the wheels, not into slices', () => {
  const out = [];
  box(0, 0, 0, 4, 1, 1.6, out);
  for (const [x, z] of [[-2.4, 1.9], [2.4, 1.9], [-2.4, -1.9], [2.4, -1.9]]) wheel(x, -1, z, 0.9, 0.3, out);
  const positions = new Float32Array(out);
  const r = splitSurface({ positions, index: null, colors: null }, { maxParts: 8 });
  assert.ok(r, 'it found pieces');
  assert.equal(r.kind, 'surface');
  assert.ok(r.groups.length >= 2 && r.groups.length <= 8, `${r.groups.length} pieces`);
  const n = positions.length / 9;
  assert.equal(r.groups.reduce((s, g) => s + g.length, 0), n, 'every triangle is in exactly one piece');
});
