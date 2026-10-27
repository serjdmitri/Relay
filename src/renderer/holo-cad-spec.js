// The editing of a designed model's shapes, as plain functions (no three.js here, so it is tested on its own). A model is
// { shapes: [{ id, name, type, size: [w, h, d], pos: [x, y, z], rot: [rx, ry, rz], hole, color }] } in millimetres, y up, pos = the middle.

export const TYPES = {
  box: { label: 'Cube', size: [20, 20, 20] },
  cylinder: { label: 'Cylinder', size: [20, 20, 20] },
  sphere: { label: 'Sphere', size: [20, 20, 20] },
  cone: { label: 'Cone', size: [20, 20, 20] },
  wedge: { label: 'Roof', size: [20, 20, 20] },
  pyramid: { label: 'Pyramid', size: [20, 20, 20] },
  torus: { label: 'Ring', size: [30, 10, 30] },
  tube: { label: 'Tube', size: [20, 20, 20] }
};
export const SOLID = '#8ec7e6';
export const HOLE = '#ff9f43';
export const MIN = 0.5;
export const MAX = 5000;
export const MAX_SHAPES = 40;

const r2 = (v) => Math.round(v * 100) / 100;
export const clampSize = (v) => Math.min(MAX, Math.max(MIN, v));
export const snap = (v, step) => (step > 0 ? Math.round(v / step) * step : v);
export const clone = (spec) => ({ shapes: spec.shapes.map((s) => ({ ...s, size: s.size.slice(), pos: s.pos.slice(), rot: s.rot.slice() })) });

// Quarter turns swap which side is which; other angles are not handled by the handles (the numbers still work).
export function axisAligned(rot) {
  return rot.every((a) => { const m = ((a % 90) + 90) % 90; return m < 1e-6 || 90 - m < 1e-6; });
}

const rr = (d) => (d * Math.PI) / 180;
// A vector turned by degrees about x, then y, then z of the shape's own frame (three.js' "XYZ" order: the matrix is Rx * Ry * Rz).
export function rotateVec(v, rot) {
  let [x, y, z] = v;
  const [a, b, c] = rot.map(rr);
  [x, y] = [x * Math.cos(c) - y * Math.sin(c), x * Math.sin(c) + y * Math.cos(c)]; // about z
  [x, z] = [x * Math.cos(b) + z * Math.sin(b), -x * Math.sin(b) + z * Math.cos(b)]; // about y
  [y, z] = [y * Math.cos(a) - z * Math.sin(a), y * Math.sin(a) + z * Math.cos(a)]; // about x
  return [x, y, z];
}

// Dragging a face of a shape along an axis by delta mm: that face moves, the opposite face stays where it is.
export function resizeFace(shape, axis, sign, delta, step = 1) {
  const s = { ...shape, size: shape.size.slice(), pos: shape.pos.slice() };
  const before = s.size[axis];
  const after = clampSize(snap(before + sign * delta, step) || before);
  const grown = after - before;
  s.size[axis] = r2(after);
  const dir = rotateVec([axis === 0 ? 1 : 0, axis === 1 ? 1 : 0, axis === 2 ? 1 : 0], shape.rot || [0, 0, 0]); // the face's own direction, which is not the world's once the shape is turned
  s.pos = s.pos.map((v, i) => r2(v + dir[i] * sign * grown / 2));
  return s;
}

export function moveBy(shape, d, step = 1) {
  return { ...shape, pos: shape.pos.map((v, i) => r2(snap(v + d[i], step))) };
}

export function setField(shape, field, value, step = 0) {
  const s = { ...shape, size: shape.size.slice(), pos: shape.pos.slice(), rot: shape.rot.slice() };
  const [kind, i] = field.split('.');
  const v = step ? snap(value, step) : value;
  if (kind === 'size') s.size[+i] = r2(clampSize(v));
  else if (kind === 'pos') s.pos[+i] = r2(v);
  else if (kind === 'rot') s.rot[+i] = r2(v);
  return s;
}

// The bounding box of the solid shapes (as if not turned, except quarter turns): { min, max } or null.
export function bounds(spec) {
  const list = spec.shapes.filter((s) => !s.hole);
  if (!list.length) return null;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const s of list) {
    const z = s.size.slice();
    const q = (a) => Math.round((((a % 360) + 360) % 360) / 90) % 2 === 1;
    if (q(s.rot[0])) [z[1], z[2]] = [z[2], z[1]];
    if (q(s.rot[1])) [z[0], z[2]] = [z[2], z[0]];
    if (q(s.rot[2])) [z[0], z[1]] = [z[1], z[0]];
    for (let i = 0; i < 3; i++) { min[i] = Math.min(min[i], s.pos[i] - z[i] / 2); max[i] = Math.max(max[i], s.pos[i] + z[i] / 2); }
  }
  return { min, max };
}

function nextId(spec) {
  let n = spec.shapes.length + 1;
  while (spec.shapes.some((s) => s.id === `s${n}`)) n++;
  return `s${n}`;
}

function uniqueName(spec, base) {
  if (!spec.shapes.some((s) => s.name === base)) return base;
  for (let i = 2; i < 200; i++) if (!spec.shapes.some((s) => s.name === `${base} ${i}`)) return `${base} ${i}`;
  return base;
}

// A new shape of a type: the first at the middle of the floor, the next beside what is there (so it is not hidden inside it); the person drags it into place.
export function addShape(spec, type, hole = false) {
  if (spec.shapes.length >= MAX_SHAPES) return { spec, id: null };
  const t = TYPES[type] || TYPES.box;
  const size = t.size.slice();
  const b = bounds(spec);
  const pos = b ? [r2(b.max[0] + size[0] / 2 + 6), r2(size[1] / 2), r2((b.min[2] + b.max[2]) / 2)] : [0, r2(size[1] / 2), 0];
  const next = clone(spec);
  const shape = { id: nextId(spec), name: uniqueName(spec, hole ? `${t.label} hole` : t.label), type: TYPES[type] ? type : 'box', size, pos, rot: [0, 0, 0], hole, color: hole ? HOLE : SOLID };
  next.shapes.push(shape);
  return { spec: next, id: shape.id };
}

export function duplicateShape(spec, id) {
  const s = spec.shapes.find((x) => x.id === id);
  if (!s || spec.shapes.length >= MAX_SHAPES) return { spec, id: null };
  const next = clone(spec);
  const copy = { ...s, id: nextId(spec), name: uniqueName(spec, s.name.replace(/ \d+$/, '')), size: s.size.slice(), pos: s.pos.map((v, i) => r2(v + (i === 0 ? s.size[0] * 0.6 : 0))), rot: s.rot.slice() };
  next.shapes.push(copy);
  return { spec: next, id: copy.id };
}

// Taking a shape away. The last solid one stays (a model needs something to be solid).
export function removeShape(spec, id) {
  const rest = spec.shapes.filter((s) => s.id !== id);
  if (rest.length === spec.shapes.length || !rest.some((s) => !s.hole)) return spec;
  return { shapes: rest.map((s) => ({ ...s })) };
}

export function replaceShape(spec, shape) {
  return { shapes: spec.shapes.map((s) => (s.id === shape.id ? shape : s)) };
}

export function toggleHole(spec, id) {
  const s = spec.shapes.find((x) => x.id === id);
  if (!s) return spec;
  const turned = { ...s, hole: !s.hole, color: s.color === (s.hole ? HOLE : SOLID) ? (s.hole ? SOLID : HOLE) : s.color };
  const next = replaceShape(spec, turned);
  return next.shapes.some((x) => !x.hole) ? next : spec;
}

// An undo history: edits push, undo and redo walk it.
export class History {
  constructor(spec, limit = 60) { this.stack = [JSON.stringify(spec)]; this.at = 0; this.limit = limit; }
  push(spec) {
    const j = JSON.stringify(spec);
    if (j === this.stack[this.at]) return;
    this.stack = this.stack.slice(0, this.at + 1);
    this.stack.push(j);
    if (this.stack.length > this.limit) this.stack.shift();
    this.at = this.stack.length - 1;
  }
  undo() { if (this.at > 0) this.at--; return JSON.parse(this.stack[this.at]); }
  redo() { if (this.at < this.stack.length - 1) this.at++; return JSON.parse(this.stack[this.at]); }
  get canUndo() { return this.at > 0; }
  get canRedo() { return this.at < this.stack.length - 1; }
}
