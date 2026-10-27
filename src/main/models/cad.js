// Designed models: a list of simple shapes (cube, cylinder, sphere, cone, roof, pyramid, torus, tube) that are added together and cut
// away (a shape marked as a hole is subtracted), like Tinkercad. This file only checks and shapes the list (the model that designs one
// is not trusted to give exact numbers); the page combines the shapes. Sizes and positions are in millimetres, y is up, and the middle
// of each shape is its position. No Electron in here, so it can be tested.

const TYPES = {
  box: { label: 'Cube', size: [20, 20, 20] },
  cylinder: { label: 'Cylinder', size: [20, 20, 20] },
  sphere: { label: 'Sphere', size: [20, 20, 20] },
  cone: { label: 'Cone', size: [20, 20, 20] },
  wedge: { label: 'Roof', size: [20, 20, 20] },
  pyramid: { label: 'Pyramid', size: [20, 20, 20] },
  torus: { label: 'Ring', size: [30, 10, 30] },
  tube: { label: 'Tube', size: [20, 20, 20] }
};

const ALIASES = {
  cube: 'box', block: 'box', rectangle: 'box', brick: 'box', square: 'box', prism: 'box', cuboid: 'box', slab: 'box', plate: 'box',
  cylinder: 'cylinder', rod: 'cylinder', pipe: 'tube', can: 'cylinder', disc: 'cylinder', disk: 'cylinder', peg: 'cylinder', pin: 'cylinder',
  ball: 'sphere', orb: 'sphere', globe: 'sphere',
  roof: 'wedge', triangle: 'wedge', ramp: 'wedge', wedge: 'wedge', 'triangular prism': 'wedge',
  pyramid: 'pyramid', ring: 'torus', donut: 'torus', doughnut: 'torus', torus: 'torus', tube: 'tube', hollow: 'tube'
};

const COLORS = {
  red: '#d9534f', blue: '#4a90d9', yellow: '#f0c040', white: '#e8eef2', gray: '#8a929a', grey: '#8a929a', black: '#2b2f33', orange: '#f08a3c', green: '#4caf6a', purple: '#8e63c9', pink: '#e87fa8', brown: '#8a6040', cyan: '#3fd0e8', silver: '#b8c2c9', gold: '#d4af37'
};
const SOLID = '#8ec7e6';
const HOLE = '#ff9f43';
const MAX_SHAPES = 40;
const MIN = 0.5;
const MAX = 5000;
const SIDES = { top: [1, 1], bottom: [1, -1], right: [0, 1], left: [0, -1], front: [2, 1], back: [2, -1] };

const num = (v, d) => (Number.isFinite(+v) ? +v : d);
const clamp = (v) => Math.min(MAX, Math.max(MIN, v));
const r2 = (v) => Math.round(v * 100) / 100;

function typeOf(raw) {
  const t = String(raw || 'box').toLowerCase().trim();
  if (TYPES[t]) return t;
  if (ALIASES[t]) return ALIASES[t];
  const hit = Object.keys(ALIASES).find((k) => t.includes(k));
  return hit ? ALIASES[hit] : 'box';
}

function colorOf(c, fallback) {
  if (typeof c !== 'string') return fallback;
  const t = c.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(t)) return t;
  if (/^#[0-9a-f]{3}$/.test(t)) return `#${t[1]}${t[1]}${t[2]}${t[2]}${t[3]}${t[3]}`;
  return COLORS[t] || fallback;
}

// A size given in any of the ways a model might: one number, three numbers, { width, height, depth }, { radius }, { diameter }.
function sizeOf(raw, def) {
  if (raw === undefined || raw === null) return def.slice();
  if (typeof raw === 'number') return [clamp(raw), clamp(raw), clamp(raw)];
  if (Array.isArray(raw)) {
    if (raw.length === 1) return [clamp(num(raw[0], def[0])), clamp(num(raw[0], def[0])), clamp(num(raw[0], def[0]))];
    return [clamp(num(raw[0], def[0])), clamp(num(raw[1], def[1])), clamp(num(raw[2], def[2]))];
  }
  if (typeof raw === 'object') {
    const d = raw.diameter !== undefined ? num(raw.diameter, null) : raw.radius !== undefined ? num(raw.radius, null) * 2 : null;
    const w = num(raw.width ?? raw.w ?? raw.x ?? d, def[0]);
    const h = num(raw.height ?? raw.h ?? raw.y, def[1]);
    const dd = num(raw.depth ?? raw.d ?? raw.z ?? d ?? raw.width ?? raw.w, def[2]);
    return [clamp(w), clamp(h), clamp(dd)];
  }
  return def.slice();
}

function vec(raw, def) {
  if (Array.isArray(raw)) return [num(raw[0], def[0]), num(raw[1], def[1]), num(raw[2], def[2])];
  if (raw && typeof raw === 'object') return [num(raw.x, def[0]), num(raw.y, def[1]), num(raw.z, def[2])];
  return def.slice();
}

// The size along each axis once turned in quarter turns (a cube lying on its side swaps two sides). Other angles: the size as it is.
function turned(size, rot) {
  const s = size.slice();
  const q = (a) => Math.round(((a % 360) + 360) % 360 / 90) % 2 === 1 && Math.abs(((a % 360) + 360) % 360 % 90) < 1e-6;
  if (q(rot[0])) [s[1], s[2]] = [s[2], s[1]];
  if (q(rot[1])) [s[0], s[2]] = [s[2], s[0]];
  if (q(rot[2])) [s[0], s[1]] = [s[1], s[0]];
  return s;
}

function find(shapes, name) {
  const t = String(name || '').toLowerCase().trim();
  if (!t) return null;
  return shapes.find((s) => s.name.toLowerCase() === t) || shapes.find((s) => s.id === t) || shapes.find((s) => s.name.toLowerCase().includes(t) || t.includes(s.name.toLowerCase())) || null;
}

function uniqueName(shapes, base) {
  if (!shapes.some((s) => s.name.toLowerCase() === base.toLowerCase())) return base;
  for (let i = 2; i < 200; i++) if (!shapes.some((s) => s.name.toLowerCase() === `${base} ${i}`.toLowerCase())) return `${base} ${i}`;
  return `${base} ${Date.now() % 1000}`;
}

function nextId(shapes) {
  let n = shapes.length + 1;
  while (shapes.some((s) => s.id === `s${n}`)) n++;
  return `s${n}`;
}

// One shape, from what the model (or an edit) gave: checked, sized, and put where it was said to go ("on top of the Cube", "through the Cube").
function makeShape(raw, shapes) {
  const type = typeOf(raw.type ?? raw.shape ?? raw.kind);
  const def = TYPES[type].size;
  const hole = raw.hole === true || /^(hole|subtract|cut|remove|negative)$/i.test(String(raw.op || raw.mode || '')) || raw.solid === false;
  let size = sizeOf(raw.size ?? raw.dimensions ?? raw.dims, def);
  if (raw.size === undefined && (raw.width !== undefined || raw.diameter !== undefined || raw.radius !== undefined || raw.height !== undefined)) size = sizeOf(raw, def);
  if (type === 'sphere' && raw.height === undefined && (raw.radius !== undefined || raw.diameter !== undefined) && raw.size === undefined) size[1] = size[0]; // a ball given only a radius is round
  const rot = vec(raw.rotation ?? raw.rot, [0, 0, 0]);
  const given = raw.position ?? raw.pos;
  const pos = given === undefined || given === null ? [0, NaN, 0] : vec(given, [0, 0, 0]);
  const s = { id: nextId(shapes), name: uniqueName(shapes, String(raw.name || TYPES[type].label).slice(0, 32)), type, size, pos, rot, hole, color: colorOf(raw.color, hole ? HOLE : SOLID) };

  const through = raw.through && (typeof raw.through === 'string' ? { of: raw.through } : raw.through);
  const on = raw.on && (typeof raw.on === 'string' ? { of: raw.on } : raw.on);
  if (through && find(shapes, through.of)) {
    // a hole that goes right through another shape, along an axis, a little longer than it so it opens on both sides
    const ref = find(shapes, through.of);
    const axis = ['x', 'y', 'z'].includes(String(through.axis || 'y').toLowerCase()) ? String(through.axis || 'y').toLowerCase() : 'y';
    const ai = { x: 0, y: 1, z: 2 }[axis];
    const extent = turned(ref.size, ref.rot)[ai];
    const cross = Math.min(...[0, 1, 2].filter((i) => i !== ai).map((i) => turned(ref.size, ref.rot)[i]));
    const dia = raw.diameter !== undefined || raw.radius !== undefined || raw.size !== undefined || raw.width !== undefined ? Math.max(size[0], size[2]) : Math.max(MIN, cross / 3);
    s.size = [clamp(dia), clamp(extent + 4), clamp(dia)];
    s.rot = ai === 0 ? [0, 0, 90] : ai === 2 ? [90, 0, 0] : [0, 0, 0];
    const off = Array.isArray(through.offset) ? through.offset : [0, 0];
    const p = ref.pos.slice();
    const others = [0, 1, 2].filter((i) => i !== ai);
    p[others[0]] += num(off[0], 0);
    p[others[1]] += num(off[1], 0);
    s.pos = p;
    s.hole = raw.hole !== false;
    if (!raw.color) s.color = s.hole ? HOLE : SOLID;
  } else if (on && find(shapes, on.of)) {
    const ref = find(shapes, on.of);
    const [axis, sign] = SIDES[String(on.side || 'top').toLowerCase()] || SIDES.top;
    const rs = turned(ref.size, ref.rot);
    const ms = turned(s.size, s.rot);
    const p = ref.pos.slice();
    p[axis] += sign * (rs[axis] / 2 + ms[axis] / 2);
    const off = Array.isArray(on.offset) ? on.offset : [0, 0];
    const others = [0, 1, 2].filter((i) => i !== axis);
    p[others[0]] += num(off[0], 0);
    p[others[1]] += num(off[1], 0);
    s.pos = p;
  }
  if (!Number.isFinite(s.pos[1])) s.pos[1] = turned(s.size, s.rot)[1] / 2; // not placed: it stands on the floor
  s.pos = s.pos.map((v) => r2(num(v, 0)));
  s.size = s.size.map((v) => r2(v));
  s.rot = s.rot.map((v) => r2(num(v, 0)));
  return s;
}

// raw: { shapes: [...] } (or just the list). Returns { shapes }.
function normalizeCad(raw) {
  const list = Array.isArray(raw) ? raw : Array.isArray(raw?.shapes) ? raw.shapes : [];
  const shapes = [];
  for (const r of list.slice(0, MAX_SHAPES)) if (r && typeof r === 'object') shapes.push(makeShape(r, shapes));
  if (!shapes.some((s) => !s.hole)) throw new Error('A design needs at least one solid shape (a hole needs something to cut).');
  return { shapes };
}

// Changes to a design, by the names of its shapes: add, remove, set (size, scale, position, move, rotation, hole, color, type, name), clear.
function applyEdits(cad, ops) {
  let shapes = (cad?.shapes || []).map((s) => ({ ...s, size: s.size.slice(), pos: s.pos.slice(), rot: s.rot.slice() }));
  const names = () => shapes.map((s) => s.name).join(', ') || 'nothing';
  for (const op of Array.isArray(ops) ? ops : []) {
    const kind = String(op?.op || '').toLowerCase();
    if (kind === 'clear') { shapes = []; continue; }
    if (kind === 'add') { if (shapes.length >= MAX_SHAPES) throw new Error(`There are already ${MAX_SHAPES} shapes.`); shapes.push(makeShape(op.shape || op, shapes)); continue; }
    const s = find(shapes, op.name);
    if (!s) throw new Error(`There is no shape called "${op.name}". The shapes are: ${names()}.`);
    if (kind === 'remove') { shapes = shapes.filter((x) => x !== s); continue; }
    if (kind === 'set') {
      if (op.type !== undefined) { s.type = typeOf(op.type); }
      if (op.size !== undefined || op.width !== undefined || op.height !== undefined || op.depth !== undefined || op.diameter !== undefined || op.radius !== undefined) {
        const given = op.size !== undefined ? op.size : { width: op.width ?? op.diameter ?? (op.radius !== undefined ? op.radius * 2 : undefined), height: op.height, depth: op.depth ?? op.diameter ?? (op.radius !== undefined ? op.radius * 2 : undefined) };
        const next = sizeOf(given, s.size);
        s.size = next;
      }
      if (op.scale !== undefined) { const k = Array.isArray(op.scale) ? op.scale : [op.scale, op.scale, op.scale]; s.size = s.size.map((v, i) => clamp(v * num(k[i], 1))); }
      if (op.position !== undefined) s.pos = vec(op.position, s.pos);
      if (op.move !== undefined) { const d = vec(op.move, [0, 0, 0]); s.pos = s.pos.map((v, i) => v + d[i]); }
      if (op.rotation !== undefined) s.rot = vec(op.rotation, s.rot);
      if (op.hole !== undefined) { s.hole = !!op.hole; if (op.color === undefined) s.color = s.hole ? HOLE : SOLID; }
      if (op.color !== undefined) s.color = colorOf(op.color, s.color);
      if (op.name) s.name = uniqueName(shapes.filter((x) => x !== s), String(op.name).slice(0, 32));
      s.pos = s.pos.map((v) => r2(v));
      s.size = s.size.map((v) => r2(v));
      s.rot = s.rot.map((v) => r2(v));
      continue;
    }
    throw new Error(`Unknown change "${op?.op}". Use add, remove, set or clear.`);
  }
  if (!shapes.some((s) => !s.hole)) throw new Error('That would leave no solid shape.');
  return { shapes };
}

// A plain description of a design, for the model (and the person) to read: names, sizes and where each one is.
function describeCad(cad) {
  const f = (v) => v.map((x) => +x.toFixed(1)).join(' x ');
  return (cad?.shapes || []).map((s) => `${s.name}: ${TYPES[s.type]?.label || s.type}${s.hole ? ' (hole)' : ''}, ${f(s.size)} mm (wide, tall, deep), middle at ${s.pos.map((x) => +x.toFixed(1)).join(', ')}${s.rot.some((x) => x) ? `, turned ${s.rot.join(', ')} degrees` : ''}`).join('\n') || 'No shapes.';
}

// What the page sends back after the user edited by hand: the same list, kept as it is (ids and names too), only checked and clamped.
function sanitizeCad(raw) {
  const out = [];
  for (const r of (Array.isArray(raw?.shapes) ? raw.shapes : []).slice(0, MAX_SHAPES)) {
    if (!r || typeof r !== 'object') continue;
    const type = TYPES[r.type] ? r.type : 'box';
    const hole = !!r.hole;
    const id = /^s\d{1,3}$/.test(String(r.id)) && !out.some((x) => x.id === r.id) ? r.id : nextId(out);
    out.push({
      id, name: uniqueName(out, String(r.name || TYPES[type].label).slice(0, 32)), type, hole,
      size: sizeOf(r.size, TYPES[type].size).map(r2), pos: vec(r.pos, [0, 0, 0]).map((v) => r2(Math.max(-MAX, Math.min(MAX, v)))), rot: vec(r.rot, [0, 0, 0]).map((v) => r2(v)),
      color: colorOf(r.color, hole ? HOLE : SOLID)
    });
  }
  if (!out.some((x) => !x.hole)) throw new Error('A design needs at least one solid shape.');
  return { shapes: out };
}

module.exports = { sanitizeCad, TYPES, MAX_SHAPES, normalizeCad, applyEdits, describeCad, typeOf, SOLID, HOLE };
