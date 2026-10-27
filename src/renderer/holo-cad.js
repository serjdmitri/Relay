// A designed model, drawn: its shapes are added together and the holes cut out of them (CSG), in millimetres. While it is being edited the
// holes show as amber ghosts, the picked shape has an outline and handles on its faces, and every shape can be picked. See holo-cad-spec.js
// for the shapes themselves and for how they are changed.
import * as THREE from './vendor/three/three.module.min.js';
import { Brush, Evaluator, ADDITION, SUBTRACTION } from './vendor/three/three-bvh-csg.js';
import { SOLID, HOLE } from './holo-cad-spec.js';

const rad = (d) => (d * Math.PI) / 180;
const bases = new Map();

// One unit-sized shape, centred, that is then stretched to the size asked for (so a "cube" can be any box, a "cylinder" any ellipse).
function baseGeometry(type) {
  if (bases.has(type)) return bases.get(type);
  let g;
  if (type === 'cylinder' || type === 'tube') g = new THREE.CylinderGeometry(0.5, 0.5, 1, 64);
  else if (type === 'sphere') g = new THREE.SphereGeometry(0.5, 48, 32);
  else if (type === 'cone') g = new THREE.ConeGeometry(0.5, 1, 64);
  else if (type === 'pyramid') { g = new THREE.ConeGeometry(0.5, 1, 4); g.rotateY(Math.PI / 4); }
  else if (type === 'wedge') { g = new THREE.CylinderGeometry(0.5, 0.5, 1, 3); g.rotateX(-Math.PI / 2); } // a triangle, point up, along z
  else if (type === 'torus') { g = new THREE.TorusGeometry(0.35, 0.15, 24, 64); g.rotateX(Math.PI / 2); }
  else g = new THREE.BoxGeometry(1, 1, 1);
  bases.set(type, g);
  return g;
}

export function shapeGeometry(type, size) {
  const g = baseGeometry(type).clone();
  g.computeBoundingBox();
  const b = g.boundingBox;
  const s = b.getSize(new THREE.Vector3());
  const c = b.getCenter(new THREE.Vector3());
  g.translate(-c.x, -c.y, -c.z);
  g.applyMatrix4(new THREE.Matrix4().makeScale(size[0] / s.x, size[1] / s.y, size[2] / s.z)); // moves the normals properly too
  return g;
}

function place(o, shape) {
  o.position.set(shape.pos[0], shape.pos[1], shape.pos[2]);
  o.rotation.set(rad(shape.rot[0]), rad(shape.rot[1]), rad(shape.rot[2]));
  o.updateMatrixWorld(true);
  return o;
}

function brushOf(shape, size = shape.size, type = shape.type) {
  const b = new Brush(shapeGeometry(type === 'tube' ? 'cylinder' : type, size), new THREE.MeshBasicMaterial({ color: shape.color || SOLID }));
  return place(b, shape);
}

// The solids added together, then every hole cut out. Returns a mesh (geometry in mm, a material per colour) or null when nothing is solid.
export function evaluateCad(spec) {
  const evaluator = new Evaluator();
  evaluator.useGroups = true;
  const solids = [];
  const holes = [];
  for (const s of spec.shapes) {
    if (s.hole) holes.push(brushOf(s));
    else {
      solids.push(brushOf(s));
      if (s.type === 'tube') holes.push(brushOf(s, [s.size[0] * 0.6, s.size[1] + 2, s.size[2] * 0.6], 'cylinder')); // a tube is a cylinder with its middle taken out
    }
  }
  let r = null;
  for (const b of solids) r = r ? evaluator.evaluate(r, b, ADDITION) : b;
  if (!r) return null;
  for (const h of holes) r = evaluator.evaluate(r, h, SUBTRACTION);
  if (!r.geometry.attributes.position?.count) return solids[0] || null; // everything was cut away: show what it was
  return r;
}

const ghostMat = () => new THREE.MeshBasicMaterial({ color: 0xff9f43, transparent: true, opacity: 0.2, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
const lineMat = (color, opacity = 0.9) => new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthTest: false });
const pickMat = new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide });
const AXES = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)];

export class CadView {
  // makeMat(hex): the look of a solid (a hologram material, or a plain one) for a colour.
  constructor({ makeMat }) {
    this.makeMat = makeMat;
    this.group = new THREE.Group();
    this.mesh = null;
    this.extra = new THREE.Group(); // ghosts, outline, handles, pick shapes
    this.group.add(this.extra);
    this.proxies = [];
    this.handles = [];
    this.editing = false;
    this.selected = null;
    this.spec = null;
  }

  dispose(o) {
    o.traverse((x) => { x.geometry?.dispose?.(); });
  }

  // Draws the shapes. edges: crisp outlines of the model (the hologram look).
  update(spec, { editing = false, selected = null, edges = true } = {}) {
    this.spec = spec;
    this.editing = editing;
    this.selected = selected;
    if (this.mesh) { this.group.remove(this.mesh); this.dispose(this.mesh); this.mesh = null; }
    this.dispose(this.extra);
    this.extra.clear();
    this.proxies = [];
    this.handles = [];
    const r = evaluateCad(spec);
    if (r) {
      const mats = (Array.isArray(r.material) ? r.material : [r.material]).map((m) => this.makeMat(`#${m.color.getHexString()}`));
      const mesh = new THREE.Mesh(r.geometry, Array.isArray(r.material) ? mats : mats[0]);
      mesh.userData.color = spec.shapes.find((s) => !s.hole)?.color || SOLID;
      mesh.userData.cad = true;
      this.mesh = mesh;
      this.group.add(mesh);
      if (edges && r.geometry.attributes.position.count < 120000) {
        const e = new THREE.LineSegments(new THREE.EdgesGeometry(r.geometry, 28), new THREE.LineBasicMaterial({ color: 0x59dcff, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false }));
        this.extra.add(e);
        this.edgeLines = e;
      }
    }
    if (editing) {
      for (const s of spec.shapes) {
        const p = place(new THREE.Mesh(shapeGeometry(s.type, s.size), pickMat), s);
        p.userData.shapeId = s.id;
        this.extra.add(p);
        this.proxies.push(p);
        if (s.hole) {
          const gh = place(new THREE.Mesh(shapeGeometry(s.type, s.size), ghostMat()), s);
          const ge = place(new THREE.LineSegments(new THREE.EdgesGeometry(gh.geometry, 20), lineMat(0xffb15e, s.id === selected ? 1 : 0.55)), s);
          this.extra.add(gh, ge);
        }
      }
      const sel = spec.shapes.find((s) => s.id === selected);
      if (sel) this.outline(sel, spec);
    }
  }

  // The picked shape: an outline of its box, and a small square in the middle of each face to pull it bigger or smaller.
  outline(s, spec) {
    const holder = place(new THREE.Group(), s);
    const box = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(s.size[0], s.size[1], s.size[2])), lineMat(0xffffff, 0.95));
    holder.add(box);
    const biggest = Math.max(...spec.shapes.flatMap((x) => x.size));
    const hs = Math.max(1.4, biggest * 0.04);
    for (let a = 0; a < 3; a++) for (const sign of [1, -1]) {
      const h = new THREE.Mesh(new THREE.BoxGeometry(hs, hs, hs), new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false }));
      h.position.copy(AXES[a]).multiplyScalar((sign * s.size[a]) / 2);
      h.userData.handle = { axis: a, sign };
      h.renderOrder = 10;
      holder.add(h);
      this.handles.push(h);
    }
    this.extra.add(holder);
    this.holder = holder;
  }

  // What the ray hits: a handle of the picked shape first, else the nearest shape. { type: 'handle', axis, sign } | { type: 'shape', id } | null
  pick(ray) {
    if (!this.editing) return null;
    if (this.handles.length) {
      const h = ray.intersectObjects(this.handles, false)[0];
      if (h) return { type: 'handle', ...h.object.userData.handle };
    }
    const hit = ray.intersectObjects(this.proxies, false)[0];
    return hit ? { type: 'shape', id: hit.object.userData.shapeId } : null;
  }

  // Everything the pointer can hit (for the hologram's click-through test).
  hittable() {
    return [...(this.mesh ? [this.mesh] : []), ...this.proxies, ...this.handles];
  }
}

export { SOLID, HOLE };
