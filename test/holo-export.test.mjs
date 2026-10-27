import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { toStl, to3mf, toStep, zUp, crc32, indexed, STEP_MAX_TRIS } from '../src/renderer/holo-export.js';

// a 10 mm cube standing on the floor (y up), as 12 triangles
function cube(s = 10) {
  const v = [[0, 0, 0], [s, 0, 0], [s, 0, s], [0, 0, s], [0, s, 0], [s, s, 0], [s, s, s], [0, s, s]];
  const q = [[0, 1, 2, 3], [4, 7, 6, 5], [0, 4, 5, 1], [1, 5, 6, 2], [2, 6, 7, 3], [3, 7, 4, 0]];
  const t = [];
  for (const [a, b, c, d] of q) for (const tri of [[a, b, c], [a, c, d]]) for (const i of tri) t.push(...v[i]);
  return new Float32Array(t);
}

test('y up becomes z up, the model sits on the bed (lowest point at 0), and can be scaled to a size', () => {
  const z = zUp(cube(10));
  let minZ = Infinity, maxZ = -Infinity;
  for (let i = 2; i < z.length; i += 3) { minZ = Math.min(minZ, z[i]); maxZ = Math.max(maxZ, z[i]); }
  assert.equal(minZ, 0);
  assert.equal(maxZ, 10, 'the cube is still 10 tall');
  const big = zUp(cube(10), { scaleTo: 100 });
  assert.equal(Math.max(...big.filter((_, i) => i % 3 === 2)), 100);
});

test('STL is the right size and its normals point outwards', () => {
  const t = zUp(cube());
  const b = toStl(t, 'Cube');
  assert.equal(b.length, 84 + 12 * 50);
  const dv = new DataView(b.buffer);
  assert.equal(dv.getUint32(80, true), 12);
  const nz = dv.getFloat32(84 + 8, true); // the first face is the bottom: its normal points down
  assert.ok(Math.abs(Math.abs(nz) - 1) < 1e-5);
});

test('3MF is a valid zip with the three parts, in millimetres, sharing corners', () => {
  const bytes = to3mf(zUp(cube(25)), 'My cube');
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'relay-3mf-')), 'x.3mf');
  fs.writeFileSync(f, bytes);
  const out = execFileSync('unzip', ['-t', f]).toString();
  assert.match(out, /No errors detected/);
  const list = execFileSync('unzip', ['-Z1', f]).toString().split('\n').filter(Boolean);
  assert.deepEqual(list.sort(), ['3D/3dmodel.model', '[Content_Types].xml', '_rels/.rels']);
  const model = execFileSync('unzip', ['-p', f, '3D/3dmodel.model']).toString();
  assert.match(model, /unit="millimeter"/);
  assert.equal((model.match(/<vertex /g) || []).length, 8, 'eight corners, not thirty-six');
  assert.equal((model.match(/<triangle /g) || []).length, 12);
  assert.match(model, /x="12.5"/, "centred on the bed, in mm");
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926, 'the standard check value');
});

test('STEP has the header, one solid with a face per triangle, and is refused when too detailed', () => {
  const s = new TextDecoder().decode(toStep(zUp(cube(10)), 'Cube'));
  assert.match(s, /^ISO-10303-21;/);
  assert.match(s, /END-ISO-10303-21;\n$/);
  assert.equal((s.match(/=ADVANCED_FACE\(/g) || []).length, 12);
  assert.equal((s.match(/=CARTESIAN_POINT\('',\(/g) || []).length, 8 + 1, 'eight corners and the origin');
  assert.equal((s.match(/=EDGE_CURVE\(/g) || []).length, 18, 'a cube of triangles has 18 edges, each shared by two faces');
  assert.equal((s.match(/=MANIFOLD_SOLID_BREP\(/g) || []).length, 1);
  // every #n it refers to exists
  const defined = new Set([...s.matchAll(/^#(\d+)=/gm)].map((m) => m[1]));
  for (const m of s.matchAll(/#(\d+)/g)) assert.ok(defined.has(m[1]), `#${m[1]} is defined`);
  assert.throws(() => toStep(new Float32Array((STEP_MAX_TRIS + 1) * 9)), /too detailed for STEP/);
  assert.deepEqual(indexed(cube()).idx.length, 36);
});
