// A 3D model built from simple shapes, written by the model (an atom, the solar system, a chair, a rocket). This only checks and
// tidies what it wrote: the viewer page does the drawing. Pure, so it can be tested.

const SHAPES = { sphere: 1, box: 3, cylinder: 3, cone: 2, torus: 2, capsule: 2, ring: 2 };
const MAX_PARTS = 80;

const num = (v, d = 0, lo = -1e4, hi = 1e4) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
const vec = (v, d = [0, 0, 0]) => (Array.isArray(v) && v.length >= 3 ? [num(v[0]), num(v[1]), num(v[2])] : d);
const color = (c) => (/^#[0-9a-f]{6}$/i.test(String(c)) ? String(c) : (/^#[0-9a-f]{3}$/i.test(String(c)) ? `#${[...String(c).slice(1)].map((x) => x + x).join('')}` : '#9fb4c0'));

// raw: the parts the model gave. Returns clean parts, at most 80, with sizes that make sense for each shape; unknown shapes are dropped.
function normalizeParts(raw) {
  const out = [];
  for (const p of Array.isArray(raw) ? raw : []) {
    const shape = String(p?.shape || '').toLowerCase();
    if (!SHAPES[shape]) continue;
    const need = SHAPES[shape];
    const s = (Array.isArray(p.size) ? p.size : [p.size]).map((x) => num(x, 1, 0.001, 1e4));
    while (s.length < need) s.push(s[s.length - 1] ?? 1);
    const part = { shape, size: s.slice(0, need), position: vec(p.position), rotation: vec(p.rotation), color: color(p.color), opacity: num(p.opacity, 1, 0.1, 1) };
    if (p.glow === true || p.emissive === true) part.glow = true;
    if (p.label) part.label = String(p.label).slice(0, 24);
    if (Array.isArray(p.spin)) part.spin = vec(p.spin, null) || undefined;
    if (p.orbit && typeof p.orbit === 'object') part.orbit = { radius: num(p.orbit.radius, 1, 0, 1e4), speed: num(p.orbit.speed, 20, -720, 720), center: vec(p.orbit.center), tilt: num(p.orbit.tilt, 0, -90, 90) };
    out.push(part);
    if (out.length >= MAX_PARTS) break;
  }
  return out;
}

module.exports = { normalizeParts, MAX_PARTS, SHAPES };
