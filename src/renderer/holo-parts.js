// Splitting a model into pieces you can pull apart. Pure maths on triangle lists, no three.js, so it can be tested.
//
// A model made of separate bodies (a robot assembled from parts) splits along those bodies: triangles that touch share a piece.
// A model that is one solid skin (a skull, a model made from a photo) has nothing to split along, so it is cut into a few regions by
// where its triangles are (like slicing it into chunks). Relay says which it did.

const MAX_TRIS = 250000;
const MAX_PARTS = 12;

// positions: a Float32Array of 9 numbers per triangle (three corners, not shared). Returns { kind, groups: number[][] } where each group
// is a list of triangle numbers, or null when the model has too many triangles to split quickly.
export function splitTriangles(positions, { regions = 5 } = {}) {
  const n = Math.floor(positions.length / 9);
  if (n < 2 || n > MAX_TRIS) return null;
  // how far apart two corners can be and still be "the same point" (a ten-thousandth of the model's size)
  let minx = Infinity, miny = Infinity, minz = Infinity, maxx = -Infinity, maxy = -Infinity, maxz = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i], y = positions[i + 1], z = positions[i + 2];
    if (x < minx) minx = x; if (x > maxx) maxx = x;
    if (y < miny) miny = y; if (y > maxy) maxy = y;
    if (z < minz) minz = z; if (z > maxz) maxz = z;
  }
  const diag = Math.hypot(maxx - minx, maxy - miny, maxz - minz) || 1;
  const q = diag * 1e-4;
  // weld the corners and join triangles that share one (union-find over the welded points)
  const ids = new Map();
  const parent = [];
  const find = (a) => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
  const point = (i) => {
    const k = `${Math.round(positions[i] / q)},${Math.round(positions[i + 1] / q)},${Math.round(positions[i + 2] / q)}`;
    let id = ids.get(k);
    if (id === undefined) { id = parent.length; parent.push(id); ids.set(k, id); }
    return id;
  };
  const first = new Int32Array(n);
  for (let t = 0; t < n; t++) {
    const a = point(t * 9), b = point(t * 9 + 3), c = point(t * 9 + 6);
    first[t] = a;
    const ra = find(a), rb = find(b), rc = find(c);
    if (rb !== ra) parent[rb] = ra;
    const r2 = find(ra);
    if (rc !== r2) parent[rc] = r2;
  }
  const comps = new Map();
  for (let t = 0; t < n; t++) { const r = find(first[t]); (comps.get(r) || comps.set(r, []).get(r)).push(t); }
  const all = [...comps.values()].sort((a, b) => b.length - a.length);
  const big = all.filter((g) => g.length >= Math.max(12, n * 0.004)).slice(0, MAX_PARTS);
  if (big.length >= 2) {
    // small loose bits join the nearest real piece, so nothing is lost
    const centre = (g) => { let x = 0, y = 0, z = 0; for (const t of g) { x += positions[t * 9] + positions[t * 9 + 3] + positions[t * 9 + 6]; y += positions[t * 9 + 1] + positions[t * 9 + 4] + positions[t * 9 + 7]; z += positions[t * 9 + 2] + positions[t * 9 + 5] + positions[t * 9 + 8]; } const m = g.length * 3; return [x / m, y / m, z / m]; };
    const cs = big.map(centre);
    for (const g of all) {
      if (big.includes(g)) continue;
      const c = centre(g);
      let best = 0, bd = Infinity;
      cs.forEach((p, i) => { const d = (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2; if (d < bd) { bd = d; best = i; } });
      for (const t of g) big[best].push(t);
    }
    return { kind: 'components', groups: big };
  }
  return { kind: 'regions', groups: kmeans(positions, n, Math.max(2, Math.min(regions, 8))) };
}

// Triangles grouped by where they are: k seeds spread as far apart as possible, then each triangle joins the nearest seed (a few rounds).
function kmeans(positions, n, k) {
  const cx = new Float32Array(n), cy = new Float32Array(n), cz = new Float32Array(n);
  for (let t = 0; t < n; t++) {
    cx[t] = (positions[t * 9] + positions[t * 9 + 3] + positions[t * 9 + 6]) / 3;
    cy[t] = (positions[t * 9 + 1] + positions[t * 9 + 4] + positions[t * 9 + 7]) / 3;
    cz[t] = (positions[t * 9 + 2] + positions[t * 9 + 5] + positions[t * 9 + 8]) / 3;
  }
  // seeds: the first triangle, then each time the triangle farthest from every seed so far
  const seeds = [[cx[0], cy[0], cz[0]]];
  const dist = new Float64Array(n).fill(Infinity);
  while (seeds.length < k) {
    const s = seeds[seeds.length - 1];
    let far = 0, fd = -1;
    for (let t = 0; t < n; t++) { const d = (cx[t] - s[0]) ** 2 + (cy[t] - s[1]) ** 2 + (cz[t] - s[2]) ** 2; if (d < dist[t]) dist[t] = d; if (dist[t] > fd) { fd = dist[t]; far = t; } }
    seeds.push([cx[far], cy[far], cz[far]]);
  }
  const label = new Int32Array(n);
  for (let round = 0; round < 8; round++) {
    const sum = seeds.map(() => [0, 0, 0, 0]);
    for (let t = 0; t < n; t++) {
      let best = 0, bd = Infinity;
      for (let i = 0; i < k; i++) { const d = (cx[t] - seeds[i][0]) ** 2 + (cy[t] - seeds[i][1]) ** 2 + (cz[t] - seeds[i][2]) ** 2; if (d < bd) { bd = d; best = i; } }
      label[t] = best;
      const s = sum[best]; s[0] += cx[t]; s[1] += cy[t]; s[2] += cz[t]; s[3]++;
    }
    for (let i = 0; i < k; i++) if (sum[i][3]) seeds[i] = [sum[i][0] / sum[i][3], sum[i][1] / sum[i][3], sum[i][2] / sum[i][3]];
  }
  const groups = seeds.map(() => []);
  for (let t = 0; t < n; t++) groups[label[t]].push(t);
  return groups.filter((g) => g.length);
}

// Where a piece goes when the model is pulled apart: away from the middle of the whole model, by `amount` of its size.
// centres: each piece's middle [x, y, z]; whole: the model's middle. Pieces right at the middle are sent upward in turn.
export function explodeOffsets(centres, whole, size, amount = 0.9) {
  return centres.map((c, i) => {
    let dx = c[0] - whole[0], dy = c[1] - whole[1], dz = c[2] - whole[2];
    let len = Math.hypot(dx, dy, dz);
    if (len < size * 0.02) { const a = (i / Math.max(1, centres.length)) * Math.PI * 2; dx = Math.cos(a); dy = 0.6; dz = Math.sin(a); len = Math.hypot(dx, dy, dz); }
    const k = (size * amount) / len;
    return [dx * k * 0.6, dy * k * 0.6, dz * k * 0.6];
  });
}

// ---- combining: where each model of a combined hologram stands ----
// sizes: each model's size as { w, h, d } (already fitted to the stage, about 2 units); placements: how each one after the first joins:
// { anchor: top | bottom | left | right | front | back | center | inside, scale, rotate: [deg, deg, deg] }. Returns [{ position, rotationDeg, scale }].
// The first model stays at the middle. The others are placed against everything placed so far, so several on "right" line up.
export function placeItems(sizes, placements, gap = 0.12) {
  const out = [{ position: [0, 0, 0], rotationDeg: [0, 0, 0], scale: 1 }];
  const box = { min: [-sizes[0].w / 2, -sizes[0].h / 2, -sizes[0].d / 2], max: [sizes[0].w / 2, sizes[0].h / 2, sizes[0].d / 2] };
  for (let i = 1; i < sizes.length; i++) {
    const p = placements[i] || { anchor: 'right', scale: 1, rotate: [0, 0, 0] };
    if (p.free) { // put where the person dragged it: as it was left, in this same space
      const f = p.free;
      const sc = Math.min(6, Math.max(0.05, Number(f.scale) || 1));
      const pos = f.position.map((x) => Number(x) || 0);
      out.push({ position: pos, rotationDeg: (f.rotationDeg || [0, 0, 0]).map((x) => Number(x) || 0), scale: sc });
      const half = [sizes[i].w, sizes[i].h, sizes[i].d].map((v) => (v * sc) / 2);
      for (let k = 0; k < 3; k++) { box.min[k] = Math.min(box.min[k], pos[k] - half[k]); box.max[k] = Math.max(box.max[k], pos[k] + half[k]); }
      continue;
    }
    const s = Math.min(3, Math.max(0.15, Number(p.scale) || 1));
    const rot = (p.rotate || [0, 0, 0]).map((x) => Number(x) || 0);
    // a quarter turn about x or z swaps height with depth or width: use the turned size
    const turned = { w: sizes[i].w, h: sizes[i].h, d: sizes[i].d };
    if (Math.round(rot[0] / 90) % 2) { const t = turned.h; turned.h = turned.d; turned.d = t; }
    if (Math.round(rot[2] / 90) % 2) { const t = turned.w; turned.w = turned.h; turned.h = t; }
    if (Math.round(rot[1] / 90) % 2) { const t = turned.w; turned.w = turned.d; turned.d = t; }
    const w = turned.w * s, h = turned.h * s, d = turned.d * s;
    const cx = (box.min[0] + box.max[0]) / 2, cy = (box.min[1] + box.max[1]) / 2, cz = (box.min[2] + box.max[2]) / 2;
    let pos = [cx, cy, cz];
    switch (p.anchor) {
      case 'top': pos = [cx, box.max[1] + gap + h / 2, cz]; break;
      case 'bottom': pos = [cx, box.min[1] - gap - h / 2, cz]; break;
      case 'left': pos = [box.min[0] - gap - w / 2, cy, cz]; break;
      case 'front': pos = [cx, cy, box.max[2] + gap + d / 2]; break;
      case 'back': pos = [cx, cy, box.min[2] - gap - d / 2]; break;
      case 'center': case 'inside': pos = [cx, cy, cz]; break;
      default: pos = [box.max[0] + gap + w / 2, cy, cz]; // right
    }
    out.push({ position: pos, rotationDeg: rot, scale: s });
    for (let k = 0; k < 3; k++) {
      const half = [w, h, d][k] / 2;
      box.min[k] = Math.min(box.min[k], pos[k] - half);
      box.max[k] = Math.max(box.max[k], pos[k] + half);
    }
  }
  return out;
}
