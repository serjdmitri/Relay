// Turns a rough shape drawn in the air into a clean one: a circle, a box, a triangle or a line. Pure maths on a list of points (the hand's path, in
// screen pixels), so it can be tested without a camera. The path is wobbly and never quite closes, so everything here is about tolerance.

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

function pathLength(p) { let s = 0; for (let i = 1; i < p.length; i++) s += dist(p[i - 1], p[i]); return s; }

// Drops points closer than min to the one before (a hand that hovers sends many nearly equal points).
function thin(p, min) {
  const out = [p[0]];
  for (const q of p.slice(1)) if (dist(out[out.length - 1], q) >= min) out.push(q);
  return out;
}

// Ramer-Douglas-Peucker: the corners of a path, keeping every point that sticks out more than eps from the line between its neighbours.
function simplify(p, eps) {
  if (p.length < 3) return p;
  const a = p[0], b = p[p.length - 1];
  const len = dist(a, b) || 1e-9;
  let max = 0, at = 0;
  for (let i = 1; i < p.length - 1; i++) {
    const d = Math.abs((b.x - a.x) * (a.y - p[i].y) - (a.x - p[i].x) * (b.y - a.y)) / len;
    if (d > max) { max = d; at = i; }
  }
  if (max <= eps) return [a, b];
  return [...simplify(p.slice(0, at + 1), eps).slice(0, -1), ...simplify(p.slice(at), eps)];
}

// The corners of a path that comes back to where it began: it is split at the point farthest from the start, because the simplifier needs two different ends.
function simplifyClosed(p, eps) {
  let at = 0, far = -1;
  p.forEach((q, i) => { const d = dist(q, p[0]); if (d > far) { far = d; at = i; } });
  const a = simplify(p.slice(0, at + 1), eps);
  const b = simplify([...p.slice(at), p[0]], eps);
  return [...a.slice(0, -1), ...b.slice(0, -1)];
}

// Returns { kind: 'circle' | 'box' | 'triangle' | 'line' | 'none', cx, cy, w, h, angle, confidence }. cx, cy, w and h are the shape's middle and size in
// the same units as the points; angle (radians) is the direction of a line.
function recognizeStroke(points) {
  const none = (why) => ({ kind: 'none', why, confidence: 0 });
  if (!Array.isArray(points) || points.length < 8) return none('too short');
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
  for (const p of points) { minx = Math.min(minx, p.x); maxx = Math.max(maxx, p.x); miny = Math.min(miny, p.y); maxy = Math.max(maxy, p.y); }
  const w = maxx - minx, h = maxy - miny, diag = Math.hypot(w, h);
  if (diag < 60) return none('too small'); // a few centimetres of hand wobble is not a drawing
  const len = pathLength(points);
  const ends = dist(points[0], points[points.length - 1]);
  const base = { cx: (minx + maxx) / 2, cy: (miny + maxy) / 2, w, h };

  // a line: the ends are about as far apart as the path is long
  if (ends / len > 0.88) return { kind: 'line', ...base, angle: Math.atan2(points.at(-1).y - points[0].y, points.at(-1).x - points[0].x), confidence: +(ends / len).toFixed(2) };

  // anything else has to come back near where it started
  if (ends / len > 0.28) return none('not closed');

  // how round: the distance from the middle of the path stays about the same all the way round
  const c = { x: points.reduce((s, p) => s + p.x, 0) / points.length, y: points.reduce((s, p) => s + p.y, 0) / points.length };
  const r = points.map((p) => dist(p, c));
  const mean = r.reduce((s, v) => s + v, 0) / r.length;
  const sd = Math.sqrt(r.reduce((s, v) => s + (v - mean) ** 2, 0) / r.length);
  const roundness = sd / (mean || 1e-9);

  // corners: a box or a triangle is a path that stays close to a polygon of 4 or 3 corners (a circle drifts up to a tenth of its size away from any)
  const thinned = thin(points, Math.max(2, diag * 0.01));
  const edgeDist = (p, a, b) => { const l2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2 || 1e-9; const t = Math.max(0, Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / l2)); return Math.hypot(p.x - (a.x + t * (b.x - a.x)), p.y - (a.y + t * (b.y - a.y))); };
  const fit = (poly) => Math.max(...thinned.map((p) => Math.min(...poly.map((a, i) => edgeDist(p, a, poly[(i + 1) % poly.length])))));
  for (const e of [0.05, 0.07, 0.09, 0.12, 0.15]) {
    const corners = simplifyClosed(thinned, Math.max(8, diag * e));
    // two corners that landed next to each other (where the path starts and ends) are one
    while (corners.length > 3 && dist(corners[0], corners.at(-1)) < diag * 0.12) corners.pop();
    const n = corners.length;
    if (n !== 3 && n !== 4) continue;
    if (fit(corners) > diag * 0.06) continue;
    if (n === 3) return { kind: 'triangle', ...base, corners, confidence: 0.7 };
    // a box has its corners all turning the same way
    const turns = corners.map((p, i) => { const a = corners[(i + 3) % 4], b = corners[(i + 1) % 4]; return (p.x - a.x) * (b.y - p.y) - (p.y - a.y) * (b.x - p.x); });
    if (turns.every((t) => t > 0) || turns.every((t) => t < 0)) return { kind: 'box', ...base, corners, confidence: 0.7 };
  }
  if (roundness < 0.2) return { kind: 'circle', ...base, confidence: +(1 - roundness).toFixed(2) };
  return none('unclear');
}

// The parts of a hologram for a recognised shape: one model about two units across (the hologram page fits it to size). Returns { title, parts, scale }.
function shapeToModel(r, { pxPerScale = 260 } = {}) {
  const color = '#59dcff';
  const part = (shape, size, rotation = [0, 0, 0]) => ({ shape, size, position: [0, 0, 0], rotation, color, glow: true });
  const big = Math.max(r.w, r.h, 1);
  const scale = Math.min(3, Math.max(0.4, big / pxPerScale));
  const k = (v) => +(Math.max(0.08, v / big) * 2).toFixed(3); // a length, as a share of the longest side, in a model two units across
  if (r.kind === 'circle') {
    const aspect = Math.max(r.w, r.h) / Math.max(1, Math.min(r.w, r.h));
    if (aspect > 1.5) { // an oval: a capsule lying along its longer side
      const thick = k(Math.min(r.w, r.h)) / 2;
      return { title: 'Capsule', scale, parts: [part('capsule', [+thick.toFixed(3), +Math.max(0.1, 2 - 2 * thick).toFixed(3)], r.w >= r.h ? [0, 0, 90] : [0, 0, 0])] };
    }
    return { title: 'Sphere', scale, parts: [part('sphere', [1])] };
  }
  if (r.kind === 'box') {
    const d = Math.min(r.w, r.h);
    return { title: Math.abs(r.w - r.h) / big < 0.15 ? 'Cube' : 'Box', scale, parts: [part('box', [k(r.w), k(r.h), k(d)])] };
  }
  if (r.kind === 'triangle') return { title: 'Cone', scale, parts: [part('cone', [+(k(r.w) / 2).toFixed(3), k(r.h)])] };
  if (r.kind === 'line') {
    const deg = (-r.angle * 180) / Math.PI; // the screen's y goes down
    return { title: 'Rod', scale, parts: [part('cylinder', [0.1, 0.1, 2], [0, 0, +(deg + 90).toFixed(1)])] };
  }
  return null;
}

module.exports = { recognizeStroke, shapeToModel };
