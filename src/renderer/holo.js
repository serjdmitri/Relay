/* global relay */
// One hologram, drawn at one spot of a window as big as the display, so nothing is cut off. Drag the model to turn it every way,
// drag its name (or hold Option) to move it, scroll to resize, double-click to pull it apart. Drag a piece anywhere; drag one far out to
// take it out, or onto another hologram to combine. Everything is drawn as light on a fully transparent window.
import * as THREE from './vendor/three/three.module.min.js';
import { STLLoader } from './vendor/three/STLLoader.js';
import { GLTFLoader } from './vendor/three/GLTFLoader.js';
import { GLTFExporter } from './vendor/three/GLTFExporter.js';
import { splitTriangles, splitSurface, explodeOffsets, placeItems } from './holo-parts.js';
import { CadView } from './holo-cad.js';
import * as S from './holo-cad-spec.js';
import { toStl, to3mf, toStep, zUp, printCheck } from './holo-export.js';

const $ = (id) => document.getElementById(id);
const cv = $('cv');
const renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: true, alpha: true, premultipliedAlpha: true });
renderer.localClippingEnabled = true; // the cut bar also cuts the solid look and the outlines
renderer.setPixelRatio(Math.min(1.5, window.devicePixelRatio || 1)); // the window is the whole display, so the pixel count is kept in check
renderer.setClearColor(0x000000, 0);
const scene = new THREE.Scene();
const PPU = 138; // pixels to a unit at the middle of the scene: a model two units across is about 276 pixels
const FOV = 30;
const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 200);
const pos = { x: 300, y: 300 }; // where the middle of the hologram is, in this window's pixels
scene.add(new THREE.HemisphereLight(0xcfe9ff, 0x101820, 1.0));
const key = new THREE.DirectionalLight(0xffffff, 2.0); key.position.set(3, 5, 4); scene.add(key);

const CYAN = new THREE.Color(0x00d4ff);
// The cut bar: a plane through the model (everything on its positive side is cut away). clipN and clipD are in world units; the shader and three's own clipping both use them.
const clip = { on: false, axis: 1, t: 1, flip: false, box: null, nLocal: null };
const clipPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 1e6); // three keeps the side with distance >= 0, so this is the plane turned round
const clipPlanes = [clipPlane];
const uniforms = { time: { value: 0 }, reveal: { value: -2 }, originY: { value: 0 }, clipOn: { value: 0 }, clipN: { value: new THREE.Vector3(0, 1, 0) }, clipD: { value: 0 } };
let solid = false;
let items = [];
const touched = () => { lastTouch = performance.now(); };
function applyUi(u) {
  if (!u) return;
  ui = { controls: ['menu', 'side', 'bar'].includes(u.controls) ? u.controls : 'menu', spin: u.spin !== false, spinDelay: Math.max(0, Number(u.spinDelay) || 0), dragFormat: ['stl', '3mf', 'step'].includes(u.dragFormat) ? u.dragFormat : 'stl' };
  pointsPerInch = Math.min(400, Math.max(50, Number(u.pointsPerInch) || 125));
  for (const c of ['menu', 'side', 'bar']) document.body.classList.toggle(`ui-${c}`, ui.controls === c);
  document.body.classList.remove('menu-open');
}
const anchor = new THREE.Group(); // sits at the hologram's spot on the screen
scene.add(anchor);
let holo = new THREE.Group(); // everything that turns (about its middle)
anchor.add(holo);
let userScale = 1;
let pointsPerInch = 125; // this screen's points to an inch (set in Settings, used for life size)
let kFit = 1;
let modelR = 1.3; // the model's radius in units, once fitted
let ui = { controls: 'menu', spin: true, spinDelay: 10, dragFormat: 'stl' };
let lastTouch = -1e9; // when it was last touched: it does not turn by itself for a while after
let spinRate = 0;
applyUi(ui);
const orient = new THREE.Quaternion(); // how it is turned
let reveal0 = 0;

// ---------- the hologram material: fresnel glow, scanlines, a sweep that builds it from the bottom up ----------
// tint: a colour; map: a texture (a real model keeps its own colours, with the glow and scanlines over them); body: how solid it looks.
function holoMaterial(tint, map, body = 0) {
  return new THREE.ShaderMaterial({
    uniforms: { ...uniforms, tint: { value: new THREE.Color(tint || 0x00d4ff).lerp(CYAN, map ? 0.15 : 0.55) }, map: { value: map || null }, hasMap: { value: map ? 1 : 0 }, mapSrgb: { value: map && map.colorSpace === THREE.SRGBColorSpace ? 1 : 0 }, body: { value: body }, boost: { value: 0 } },
    // a real-looking model (body 1) is drawn solid with the hologram effects over it; the light-only kind is see-through and additive
    transparent: body < 1, depthWrite: body >= 1, blending: body >= 1 ? THREE.NormalBlending : THREE.AdditiveBlending, side: THREE.DoubleSide,
    vertexShader: 'varying vec3 vN; varying vec3 vV; varying float vY; varying vec2 vUv; varying vec3 vW; void main() { vUv = uv; vec4 wp = modelMatrix * vec4(position, 1.0); vY = wp.y; vW = wp.xyz; vN = normalize(normalMatrix * normal); vec4 mv = viewMatrix * wp; vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }',
    fragmentShader: 'uniform float time; uniform float reveal; uniform float originY; uniform vec3 tint; uniform sampler2D map; uniform float hasMap; uniform float mapSrgb; uniform float body; uniform float boost; uniform float clipOn; uniform vec3 clipN; uniform float clipD; varying vec3 vN; varying vec3 vV; varying float vY; varying vec2 vUv; varying vec3 vW; void main() { float ry = vY - originY; if (ry > reveal) discard; float cd = dot(clipN, vW) + clipD; if (clipOn > 0.5 && cd > 0.0) discard; float cutGlow = clipOn > 0.5 ? 1.0 - smoothstep(0.0, 0.05, abs(cd)) : 0.0; float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.0); float scan = 0.72 + 0.28 * sin(vY * 90.0 - time * 3.0); float edge = smoothstep(reveal - 0.18, reveal, ry); vec3 base = tint; if (hasMap > 0.5) { base = texture2D(map, vUv).rgb; if (mapSrgb > 0.5) base = pow(base, vec3(0.4545)); base *= 1.25; } if (body >= 1.0) { float flick1 = 0.97 + 0.03 * sin(time * 37.0); vec3 lit = base * (0.78 + 0.22 * scan) * (0.85 + 0.25 * (1.0 - f)); lit += vec3(0.0, 0.7, 1.0) * f * 0.55 + vec3(edge) + vec3(0.0, 0.35, 0.5) * boost + vec3(0.3, 0.9, 1.0) * cutGlow; gl_FragColor = vec4(lit * flick1, 1.0); return; }  float a = (0.10 + body + f * 0.9) * scan + edge * 0.9 + boost * 0.5 + cutGlow * 0.8; a = min(a, 1.0); float flick = 0.95 + 0.05 * sin(time * 37.0); gl_FragColor = vec4(base * (0.55 + f * 0.8) + vec3(0.0, 0.25, 0.35) * f + vec3(edge) + vec3(0.0, 0.4, 0.6) * boost + vec3(0.3, 0.9, 1.0) * cutGlow, a * flick); }'
  });
}
function solidMaterial(color) { return new THREE.MeshStandardMaterial({ color: color || 0xd7e3ea, roughness: 0.5, metalness: 0.15, side: THREE.DoubleSide, clippingPlanes: clipPlanes }); }

// ---------- building the models ----------
const GEOM = {
  sphere: (s) => new THREE.SphereGeometry(s[0], 48, 32), box: (s) => new THREE.BoxGeometry(s[0], s[1], s[2]), cylinder: (s) => new THREE.CylinderGeometry(s[0], s[1], s[2], 48),
  cone: (s) => new THREE.ConeGeometry(s[0], s[1], 48), torus: (s) => new THREE.TorusGeometry(s[0], s[1], 24, 64), capsule: (s) => new THREE.CapsuleGeometry(s[0], s[1], 8, 24),
  ring: (s) => new THREE.RingGeometry(Math.min(s[0], s[1]), Math.max(s[0], s[1]), 96)
};
const rad = (d) => (d * Math.PI) / 180;
let upright = 0; // which axis STL files treat as up: Z, Y or X
const ORIENTS = [[-Math.PI / 2, 0, 0], [0, 0, 0], [0, 0, Math.PI / 2]];
const animated = [];
const labels = [];

function label(text) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 64;
  const g = c.getContext('2d');
  g.font = '600 30px -apple-system, system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineJoin = 'round'; g.lineWidth = 7; g.strokeStyle = 'rgba(0,30,50,.85)'; g.strokeText(text, 128, 33);
  g.fillStyle = '#bff4ff'; g.fillText(text, 128, 33);
  return new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false, transparent: true }));
}

function makeMat(color) { return solid ? solidMaterial(color) : holoMaterial(color); }

// One item as a group, scaled so its biggest side is 2 units.
async function buildItem(it) {
  const g = new THREE.Group();
  const ud = { kind: it.kind, g, holders: [], meshes: [] }; // what the pull-apart needs to find later
  if (it.kind === 'glb') {
    // A real-looking model (from a photo): it keeps its own colours and shape; the hologram look is light over them.
    const gltf = await new Promise((resolve, reject) => new GLTFLoader().parse(it.bytes.buffer.slice(it.bytes.byteOffset, it.bytes.byteOffset + it.bytes.byteLength), '', resolve, reject));
    gltf.scene.traverse((o) => {
      if (!o.isMesh) return;
      const m = Array.isArray(o.material) ? o.material[0] : o.material;
      o.userData.orig = m;
      if (!solid) o.material = holoMaterial(m.color ? m.color.getHex() : 0xffffff, m.map || null, 1);
      else if (m.isMeshBasicMaterial || !m.isMeshStandardMaterial) o.material = new THREE.MeshStandardMaterial({ map: m.map || null, color: m.color || 0xffffff, roughness: 0.6 });
    });
    g.add(gltf.scene);
    ud.meshes = [];
    gltf.scene.traverse((o) => { if (o.isMesh) ud.meshes.push(o); });
  } else if (it.kind === 'cad') {
    // A designed model: shapes added together, holes cut out (see holo-cad.js). Its shapes can be edited here.
    const view = new CadView({ makeMat });
    view.update(it.cad, { editing: false, edges: !solid });
    g.add(view.group);
    ud.cadView = view;
    ud.meshes = view.mesh ? [view.mesh] : [];
    ud.edges = view.edgeLines || null;
  } else if (it.kind === 'stl') {
    const geo = new STLLoader().parse(it.bytes.buffer.slice(it.bytes.byteOffset, it.bytes.byteOffset + it.bytes.byteLength));
    if (!geo.attributes.normal) geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, makeMat(0xd7e3ea));
    mesh.rotation.set(...ORIENTS[upright]);
    mesh.userData.stl = true;
    g.add(mesh);
    ud.stlMesh = mesh;
    if (!solid && geo.attributes.position.count < 240000) {
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo, 38), new THREE.LineBasicMaterial({ color: 0x59dcff, transparent: true, opacity: 0.32, blending: THREE.AdditiveBlending, depthWrite: false }));
      edges.rotation.copy(mesh.rotation);
      g.add(edges);
      ud.edges = edges;
    }
  } else {
    for (const p of it.parts || []) {
      const mesh = new THREE.Mesh(GEOM[p.shape](p.size), p.glow && !solid ? holoMaterial(p.color) : makeMat(p.color));
      mesh.rotation.set(rad(p.rotation[0]), rad(p.rotation[1]), rad(p.rotation[2]));
      const holder = new THREE.Group();
      holder.add(mesh);
      ud.holders.push(holder);
      mesh.userData.color = p.color;
      if (p.label) { const l = label(p.label); holder.add(l); labels.push({ sprite: l, radius: p.shape === 'sphere' ? p.size[0] : Math.max(...p.size) / 2, group: g }); }
      if (p.orbit) { const pivot = new THREE.Group(); pivot.position.set(...p.orbit.center); pivot.rotation.x = rad(p.orbit.tilt); holder.position.set(p.orbit.radius, 0, 0); pivot.add(holder); g.add(pivot); animated.push({ o: pivot, spin: [0, p.orbit.speed, 0] }); if (p.spin) animated.push({ o: mesh, spin: p.spin }); }
      else { holder.position.set(...p.position); g.add(holder); if (p.spin) animated.push({ o: mesh, spin: p.spin }); }
    }
  }
  const box = new THREE.Box3().setFromObject(g);
  const size = box.getSize(new THREE.Vector3());
  const c = box.getCenter(new THREE.Vector3());
  const s = 2 / Math.max(size.x, size.y, size.z, 1e-6);
  const wrap = new THREE.Group();
  g.position.copy(c).multiplyScalar(-1);
  wrap.add(g);
  wrap.scale.setScalar(s);
  for (const l of labels) if (l.group === g) { l.sprite.scale.set(0.8 / s, 0.2 / s, 1); l.sprite.position.y = l.radius + 0.2 / s; }
  Object.assign(wrap.userData, ud, { s, size: { w: size.x * s, h: size.y * s, d: size.z * s }, width: Math.max(size.x, size.z) * s, height: size.y * s });
  return wrap;
}

let building = 0;
let innerGroup = null; // the models of a combined hologram, in the space where they are placed
let selItem = -1; // the model of a combined hologram that is picked (it can be dragged onto a surface of another)
let itemWraps = [];
const intros = []; // models flying in to join
async function rebuild() {
  const mine = ++building;
  animated.length = 0; // the parts that spin and the name tags belong to what is built next
  labels.length = 0;
  const wraps = await Promise.all(items.map(buildItem));
  if (mine !== building) return; // a newer one was asked for while this loaded
  holo.traverse((o) => { o.geometry?.dispose?.(); (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m?.map?.dispose?.() || m?.dispose?.()); });
  const inner = new THREE.Group(); // the models, put side by side; centred and turned in the pivot made below
  holo = inner;
  innerGroup = inner;
  selItem = -1;
  const sizes = wraps.map((w) => w.userData.size);
  const placed = placeItems(sizes, items.map((it) => it.placement || null));
  const now = performance.now();
  intros.length = 0;
  wraps.forEach((w, i) => {
    const p = placed[i];
    w.position.set(...p.position);
    w.rotation.set(rad(p.rotationDeg[0]), rad(p.rotationDeg[1]), rad(p.rotationDeg[2]));
    w.scale.multiplyScalar(p.scale);
    holo.add(w);
    // a model that has just joined flies in from the side it was dropped from, and settles
    if (items[i].from) intros.push({ w, t0: now, to: w.position.clone(), s1: w.scale.x, from: new THREE.Vector3(items[i].from[0] * 3.2, -items[i].from[1] * 2.2, 0).add(w.position) });
  });
  items.forEach((it) => { delete it.from; }); // flown in once; a later rebuild (solid, upright) must not do it again
  itemWraps = wraps;
  exploded = false; explodeT = 0; parts = []; selected = null; hovered = null;
  document.body.classList.remove('exploded');
  $('explode').classList.remove('on');
  relay.holoSizes(sizes.map((z) => ({ w: +z.w.toFixed(3), h: +z.h.toFixed(3), d: +z.d.toFixed(3) })));
  // It turns about its middle in every direction, so what has to fit is the sphere around it, not a width and a height.
  const box = new THREE.Box3().setFromObject(holo);
  const size = box.getSize(new THREE.Vector3());
  const centre = box.getCenter(new THREE.Vector3());
  const radius = Math.max(size.length() / 2, 1e-6);
  kFit = Math.min(1.25, 1.3 / radius);
  modelR = radius * kFit;
  const pivot = new THREE.Group();
  holo.position.copy(centre).multiplyScalar(-1);
  pivot.add(holo);
  pivot.quaternion.copy(orient);
  anchor.remove(...anchor.children);
  holo = pivot;
  anchor.add(holo);
  applyScale();
  reveal0 = performance.now();
  $('upright').hidden = !items.some((i) => i.kind === 'stl');
  $('edit').hidden = !items.some((i) => i.kind === 'cad');
  if (editing) leaveEdit(false);
  bumpModel();
}

// ---------- pulling it apart ----------
const EXPLODE_MS = 700;
let exploded = false;
let explodeT = 0; // 0 together, 1 fully apart
let parts = []; // { obj, meshes, item, base, off, name }
let selected = null;
let hovered = null;

const ease = (t) => 1 - Math.pow(1 - t, 3);

// One colour per triangle (r, g, b in 0..1), read from the texture at the triangle's UV middle, or from vertex colours, or the flat material colour.
function triangleColors(mesh) {
  const geo = mesh.geometry;
  const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
  const index = geo.index ? geo.index.array : null;
  const nt = index ? Math.floor(index.length / 3) : Math.floor(geo.attributes.position.count / 3);
  const out = new Float32Array(nt * 3);
  const corner = (t, k) => (index ? index[t * 3 + k] : t * 3 + k);
  const vc = geo.attributes.color;
  const uv = geo.attributes.uv;
  const img = mat?.map?.image;
  if (uv && img && (img.width || img.naturalWidth)) {
    try {
      const w0 = img.width || img.naturalWidth, h0 = img.height || img.naturalHeight;
      const k = Math.min(1, 512 / Math.max(w0, h0));
      const w = Math.max(1, Math.round(w0 * k)), h = Math.max(1, Math.round(h0 * k));
      const cv = document.createElement('canvas');
      cv.width = w; cv.height = h;
      const ctx = cv.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, w, h);
      const px = ctx.getImageData(0, 0, w, h).data;
      const flip = mat.map.flipY; // glTF textures are not flipped, three's default ones are
      for (let t = 0; t < nt; t++) {
        let u = 0, v = 0;
        for (let c = 0; c < 3; c++) { u += uv.getX(corner(t, c)); v += uv.getY(corner(t, c)); }
        u = (u / 3) % 1; v = (v / 3) % 1;
        if (u < 0) u += 1;
        if (v < 0) v += 1;
        const x = Math.min(w - 1, Math.floor(u * w)), y = Math.min(h - 1, Math.floor((flip ? 1 - v : v) * h));
        const o = (y * w + x) * 4;
        out[t * 3] = px[o] / 255; out[t * 3 + 1] = px[o + 1] / 255; out[t * 3 + 2] = px[o + 2] / 255;
      }
      return out;
    } catch { /* a tainted or closed image: fall through to the other sources */ }
  }
  if (vc) {
    for (let t = 0; t < nt; t++) {
      let r = 0, g = 0, b = 0;
      for (let c = 0; c < 3; c++) { const i = corner(t, c); r += vc.getX(i); g += vc.getY(i); b += vc.getZ(i); }
      out[t * 3] = r / 3; out[t * 3 + 1] = g / 3; out[t * 3 + 2] = b / 3;
    }
    return out;
  }
  return null; // flat colour: only creases will cut
}

// A solid model has nothing to pull apart along, so it is cut into regions; a model made of several bodies splits along them.
function splitMesh(mesh) {
  const geo = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry;
  const pos = geo.attributes.position.array;
  let res = splitTriangles(pos, { regions: 5 });
  // one solid skin (a model made from a photo): cut it along its creases and colours first, which gives wheels, doors and glass instead of slices
  if (!res || res.kind === 'regions') {
    const cut = splitSurface({ positions: mesh.geometry.attributes.position.array, index: mesh.geometry.index ? mesh.geometry.index.array : null, colors: triangleColors(mesh) });
    if (cut && cut.groups.length >= 3) res = cut;
  }
  if (!res) return null;
  const nor = geo.attributes.normal?.array;
  const uv = geo.attributes.uv?.array;
  const meshes = res.groups.map((grp) => {
    const P = new Float32Array(grp.length * 9);
    const N = nor ? new Float32Array(grp.length * 9) : null;
    const U = uv ? new Float32Array(grp.length * 6) : null;
    grp.forEach((t, i) => { P.set(pos.subarray(t * 9, t * 9 + 9), i * 9); if (N) N.set(nor.subarray(t * 9, t * 9 + 9), i * 9); if (U) U.set(uv.subarray(t * 6, t * 6 + 6), i * 6); });
    const g2 = new THREE.BufferGeometry();
    g2.setAttribute('position', new THREE.BufferAttribute(P, 3));
    if (N) g2.setAttribute('normal', new THREE.BufferAttribute(N, 3)); else g2.computeVertexNormals();
    if (U) g2.setAttribute('uv', new THREE.BufferAttribute(U, 2));
    const m2 = new THREE.Mesh(g2, (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material).clone());
    m2.position.copy(mesh.position); m2.rotation.copy(mesh.rotation); m2.scale.copy(mesh.scale);
    m2.userData = { ...mesh.userData, orig: mesh.userData.orig };
    return m2;
  });
  return { kind: res.kind, meshes };
}

let hintText = '';
let zonePx = 200; // how far from the middle a piece can be carried and still count as part of the hologram
function collectParts() {
  parts = [];
  hintText = '';
  itemWraps.forEach((wrap, ii) => {
    const ud = wrap.userData;
    if (ud.kind === 'shapes') { ud.holders.forEach((h, i) => parts.push({ obj: h, meshes: h.children.filter((c) => c.isMesh), item: ii, name: `Part ${i + 1}` })); return; }
    const meshes = ud.kind === 'stl' ? (ud.stlMesh ? [ud.stlMesh] : []) : ud.meshes;
    let pieces = [];
    if (meshes.length >= 2) pieces = meshes;
    else if (meshes.length === 1) {
      const sp = splitMesh(meshes[0]);
      if (sp) {
        const parent = meshes[0].parent;
        parent.remove(meshes[0]);
        sp.meshes.forEach((m) => parent.add(m));
        pieces = sp.meshes;
        hintText = sp.kind === 'regions' ? 'one solid piece, cut into regions' : sp.kind === 'surface' ? 'one solid piece, cut along its creases and colours' : '';
      }
    }
    if (ud.edges) ud.edges.visible = false;
    pieces.forEach((m, i) => parts.push({ obj: m, meshes: [m], item: ii, name: `Piece ${i + 1}` }));
  });
  for (const p of parts) p.base = p.obj.position.clone();
}

function computeOffsets() {
  holo.updateMatrixWorld(true);
  const centres = parts.map((p) => new THREE.Box3().setFromObject(p.obj).getCenter(new THREE.Vector3()));
  const whole = new THREE.Box3().setFromObject(holo);
  const wc = whole.getCenter(new THREE.Vector3());
  const ws = whole.getSize(new THREE.Vector3());
  const world = explodeOffsets(centres.map((c) => [c.x, c.y, c.z]), [wc.x, wc.y, wc.z], Math.max(ws.x, ws.y, ws.z), 0.9);
  zonePx = 60 + PPU * Math.max(...centres.map((c, i) => c.distanceTo(wc) + Math.hypot(...world[i])), 0.5);
  parts.forEach((p, i) => {
    const inv = new THREE.Matrix3().setFromMatrix4(new THREE.Matrix4().copy(p.obj.parent.matrixWorld).invert());
    p.off = new THREE.Vector3(...world[i]).applyMatrix3(inv); // the same push, in the piece's own space
  });
}

function setBoost(part, v) {
  for (const m of part.meshes) {
    const mat = m.material;
    if (mat.uniforms?.boost) mat.uniforms.boost.value = v;
    else if (mat.emissive) mat.emissive.setRGB(0, 0.3 * v, 0.45 * v);
  }
}
function setHover(p) { if (hovered && hovered !== selected) setBoost(hovered, 0); hovered = p; if (p && p !== selected) setBoost(p, 0.55); }
function select(p) { if (selected) setBoost(selected, 0); selected = p; if (p) setBoost(p, 1); }

function toggleExplode() {
  if (!exploded) {
    if (!parts.length) collectParts();
    if (parts.length < 2) { $('err').textContent = 'That one is too detailed to pull apart.'; setTimeout(() => { $('err').textContent = ''; }, 2500); return; }
    computeOffsets();
  } else { select(null); setHover(null); }
  exploded = !exploded;
  $('explode').classList.toggle('on', exploded);
  document.body.classList.toggle('exploded', exploded);
  $('hint2').textContent = exploded ? `Drag pieces around · far out takes one out · double-click puts it back${hintText ? ` · ${hintText}` : ''}` : '';
}

// What a piece looks like to a file: plain materials (the hologram shader cannot be saved), in the position it has when together.
function exportMaterial(m) {
  const orig = m.userData.orig;
  if (orig && !orig.isShaderMaterial) return orig;
  const c = m.userData.color || (m.material.uniforms ? m.material.uniforms.tint.value.getHex() : 0xd7e3ea);
  return new THREE.MeshStandardMaterial({ color: c, roughness: 0.55, metalness: 0.15 });
}
function relMatrix(o, top) { const m = new THREE.Matrix4(); for (let x = o; x && x !== top; x = x.parent) { x.updateMatrix(); m.premultiply(x.matrix); } return m; }
function exportGlb(list, g) {
  const root = new THREE.Group();
  for (const p of list) for (const mesh of p.meshes) {
    const c = new THREE.Mesh(mesh.geometry, exportMaterial(mesh));
    const savedPos = p.obj.position.clone();
    p.obj.position.copy(p.base); // measured where it sits when everything is together
    relMatrix(mesh, g).decompose(c.position, c.quaternion, c.scale);
    p.obj.position.copy(savedPos);
    root.add(c);
  }
  return new Promise((resolve, reject) => new GLTFExporter().parse(root, resolve, reject, { binary: true }));
}


// ---------- editing a designed model: add, remove, resize, move, cut holes ----------
let editing = false;
let editWrap = null;
let editIdx = -1;
let cadSpec = null;
let cadSel = null;
let hist = null;
let saveTimer = 0;
let asHole = false;
const view = () => editWrap?.userData.cadView;
const FIELD = { 'size.0': 'W', 'size.1': 'H', 'size.2': 'D', 'pos.0': 'X', 'pos.1': 'Y', 'pos.2': 'Z', 'rot.0': 'X', 'rot.1': 'Y', 'rot.2': 'Z' };

function redrawCad() {
  const v = view();
  if (!v) return;
  v.update(cadSpec, { editing: true, selected: cadSel, edges: !solid });
  editWrap.userData.meshes = v.mesh ? [v.mesh] : [];
  editWrap.userData.edges = v.edgeLines || null;
}
function scheduleSave() {
  items[editIdx].cad = cadSpec;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => relay.holoCad({ item: editIdx, cad: cadSpec }), 350);
}
// One edit made: drawn, remembered for undo, saved.
function commitCad(next, remember = true) {
  bumpModel();
  cadSpec = next;
  redrawCad();
  if (remember) hist.push(cadSpec);
  scheduleSave();
  buildPanels();
}
function enterEdit() {
  const i = itemWraps.findIndex((w) => w.userData.cadView);
  if (i < 0) return;
  if (exploded) toggleExplode();
  editing = true; editIdx = i; editWrap = itemWraps[i];
  cadSpec = S.clone(items[i].cad); cadSel = null; hist = new S.History(cadSpec);
  document.body.classList.add('editing');
  $('edit').classList.add('on');
  $('explode').hidden = true;
  $('hint2').textContent = 'Drag a shape to move it · drag its squares to resize · Shift-drag turns the view';
  redrawCad();
  buildPanels();
}
function leaveEdit(redraw = true) {
  if (!editing) return;
  clearTimeout(saveTimer);
  relay.holoCad({ item: editIdx, cad: cadSpec });
  items[editIdx].cad = cadSpec;
  const v = view();
  editing = false;
  document.body.classList.remove('editing');
  $('edit').classList.remove('on');
  $('explode').hidden = false;
  $('hint2').textContent = '';
  if (redraw && v) { v.update(cadSpec, { editing: false, edges: !solid }); editWrap.userData.meshes = v.mesh ? [v.mesh] : []; editWrap.userData.edges = v.edgeLines || null; parts = []; }
  editWrap = null; cadSel = null;
}

const num = (v) => (Math.round(v * 100) / 100).toString();
function buildPanels() {
  if (!editing) return;
  const sel = cadSpec.shapes.find((x) => x.id === cadSel);
  const add = Object.entries(S.TYPES).map(([t, d]) => `<div class="cadui" data-add="${t}">${asHole ? 'Hole: ' : '+ '}${d.label}</div>`).join('');
  $('cadL').innerHTML = `<div class="cadh">Add a shape</div>${add}<div class="cadui ${asHole ? 'on' : ''}" id="asHole">${asHole ? 'Adding holes' : 'Add as holes'}</div>
    <div class="cadh">Edit</div><div class="cadui ${hist.canUndo ? '' : 'off'}" id="undo">Undo</div><div class="cadui ${hist.canRedo ? '' : 'off'}" id="redo">Redo</div><div class="cadui" id="done">Done</div>`;
  const list = cadSpec.shapes.map((x) => `<div class="cadui shp ${x.hole ? 'hole' : ''} ${x.id === cadSel ? 'sel' : ''}" data-sel="${x.id}"><i></i>${x.name.replace(/</g, '&lt;')}</div>`).join('');
  const rows = (kind, vals, unit) => vals.map((v, i) => `<div class="row"><b>${FIELD[`${kind}.${i}`]}</b><span class="num cadui" data-f="${kind}.${i}">${num(v)}</span><span class="unit">${unit}</span></div>`).join('');
  $('cadR').innerHTML = `<div class="cadh">Shapes (click one)</div>${list}` + (sel ? `
    <div class="cadh">Size</div>${rows('size', sel.size, 'mm')}
    <div class="cadh">Place</div>${rows('pos', sel.pos, 'mm')}
    <div class="cadh">Turn</div>${rows('rot', sel.rot, '°')}
    <div class="cadui" id="holeT">${sel.hole ? 'Make it solid' : 'Make it a hole'}</div><div class="cadui" id="floor">Put it on the floor</div><div class="cadui" id="dup">Copy</div><div class="cadui" id="del">Delete</div>` : '<div class="unit" style="padding:6px 8px">Pick a shape to change its size,<br>place, turn, or to cut a hole.</div>');
  layoutCad();
}
function layoutCad() {
  const R = 150 * userScale + 40;
  const c = $('cad');
  c.style.left = `${pos.x}px`; c.style.top = `${pos.y}px`;
  $('cadL').style.left = 'auto'; $('cadL').style.right = `${R + 70}px`;
  $('cadR').style.left = `${R + 70}px`;
}
const sel1 = () => cadSpec.shapes.find((x) => x.id === cadSel);
$('cad').addEventListener('click', (e) => {
  const el = e.target.closest('.cadui');
  if (!el || !editing) return;
  if (el.dataset.add) { const r = S.addShape(cadSpec, el.dataset.add, asHole); if (r.id) { cadSel = r.id; commitCad(r.spec); } else $('err').textContent = 'That is as many shapes as it can hold.'; return; }
  if (el.dataset.sel) { cadSel = el.dataset.sel; redrawCad(); buildPanels(); return; }
  if (el.id === 'asHole') { asHole = !asHole; buildPanels(); }
  else if (el.id === 'undo' && hist.canUndo) { cadSpec = hist.undo(); if (!sel1()) cadSel = null; redrawCad(); scheduleSave(); buildPanels(); }
  else if (el.id === 'redo' && hist.canRedo) { cadSpec = hist.redo(); if (!sel1()) cadSel = null; redrawCad(); scheduleSave(); buildPanels(); }
  else if (el.id === 'done') leaveEdit();
  else if (el.id === 'holeT' && sel1()) commitCad(S.toggleHole(cadSpec, cadSel));
  else if (el.id === 'floor' && sel1()) { const s = sel1(); const h = S.axisAligned(s.rot) ? S.bounds({ shapes: [{ ...s, pos: [0, 0, 0] }] }) : null; if (h) commitCad(S.replaceShape(cadSpec, { ...s, pos: [s.pos[0], Math.round(-h.min[1] * 100) / 100, s.pos[2]] })); }
  else if (el.id === 'dup' && sel1()) { const r = S.duplicateShape(cadSpec, cadSel); if (r.id) { cadSel = r.id; commitCad(r.spec); } }
  else if (el.id === 'del' && sel1()) { const next = S.removeShape(cadSpec, cadSel); if (next === cadSpec) $('err').textContent = 'A model needs at least one solid shape.'; else { cadSel = null; commitCad(next); } }
});
// A number is changed by dragging it sideways (or with the wheel): there is no keyboard in a hologram.
let scrub = null;
$('cadR').addEventListener('pointerdown', (e) => {
  const n = e.target.closest('.num');
  if (!n || !sel1()) return;
  const [kind, i] = n.dataset.f.split('.');
  scrub = { f: n.dataset.f, el: n, x0: e.clientX, start: JSON.parse(JSON.stringify(sel1())), v0: sel1()[kind][+i], kind };
  dragging = 'num'; spinPause = true;
  e.preventDefault(); document.body.setPointerCapture?.(e.pointerId);
});
function scrubMove(e) {
  const fine = e.altKey ? 0.1 : 1;
  const per = scrub.kind === 'rot' ? 0.5 : 0.25; // value per pixel
  const stepSize = e.shiftKey ? (scrub.kind === 'rot' ? 15 : 5) : fine;
  const v = scrub.v0 + (e.clientX - scrub.x0) * per * (e.shiftKey ? 5 : 1);
  const next = S.setField(scrub.start, scrub.f, v, stepSize);
  cadSpec = S.replaceShape(cadSpec, next);
  const [kind, i] = scrub.f.split('.');
  scrub.el.textContent = num(next[kind][+i]);
  redrawCad();
}
$('cadR').addEventListener('wheel', (e) => {
  const n = e.target.closest('.num');
  if (!n || !sel1()) return;
  e.preventDefault();
  const [kind, i] = n.dataset.f.split('.');
  const step = (e.shiftKey ? 5 : 1) * (kind === 'rot' ? 5 : 1) * (e.deltaY < 0 ? 1 : -1);
  commitCad(S.replaceShape(cadSpec, S.setField(sel1(), n.dataset.f, sel1()[kind][+i] + step, 1)));
}, { passive: false });


// ---------- placing one model of a combined hologram by hand: it sticks to the surface of another where you drop it ----------
const itemOf = (obj) => { for (let o = obj; o; o = o.parent) { const i = itemWraps.indexOf(o); if (i >= 0) return i; } return -1; };
function glowItem(i, v) { if (i >= 0 && itemWraps[i]) { const meshes = []; itemWraps[i].traverse((o) => { if (o.isMesh) meshes.push(o); }); setBoost({ meshes }, v); } }
function pickItem(e) {
  setRay(e);
  const meshes = [];
  holo.traverse((o) => { if (o.isMesh) meshes.push(o); });
  const hit = ray.intersectObjects(meshes, false)[0];
  return hit ? itemOf(hit.object) : -1;
}
const _box = new THREE.Box3();
let itemDrag = null;
function itemStart(e, i) {
  const w = itemWraps[i];
  w.updateWorldMatrix(true, false);
  const c0 = w.getWorldPosition(new THREE.Vector3());
  camera.matrixWorld.extractBasis(_r, _u, _z);
  const pp = toScreen(c0.clone().add(_r)).x - toScreen(c0).x || 1;
  itemDrag = { i, c0, r: _r.clone(), u: _u.clone(), pp, x0: e.clientX, y0: e.clientY };
}
function itemMove(e) {
  const d = itemDrag, w = itemWraps[d.i];
  let target = null;
  if (!e.altKey) { // over another model: the dragged one rests against that surface
    setRay(e);
    const others = [];
    itemWraps.forEach((x, k) => { if (k !== d.i) x.traverse((o) => { if (o.isMesh) others.push(o); }); });
    const hit = ray.intersectObjects(others, false)[0];
    if (hit && hit.face) {
      const n = hit.face.normal.clone().transformDirection(hit.object.matrixWorld).normalize();
      _box.setFromObject(w);
      const half = _box.getSize(new THREE.Vector3()).multiplyScalar(0.5);
      target = hit.point.clone().addScaledVector(n, Math.abs(n.x) * half.x + Math.abs(n.y) * half.y + Math.abs(n.z) * half.z + 0.01);
    }
  }
  if (!target) target = d.c0.clone().addScaledVector(d.r, (e.clientX - d.x0) / d.pp).addScaledVector(d.u, -(e.clientY - d.y0) / d.pp);
  w.position.copy(innerGroup.worldToLocal(target));
}
function sendPlace(i) {
  const w = itemWraps[i];
  relay.holoPlace({ item: i, free: { position: w.position.toArray(), rotationDeg: [w.rotation.x, w.rotation.y, w.rotation.z].map((r) => (r * 180) / Math.PI), scale: w.scale.x / (w.userData.s || 1) } });
}
// The pointer on the model while editing: a handle resizes, a shape is picked and moved. (Shift-drag turns the view as usual.)
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _r = new THREE.Vector3(), _u = new THREE.Vector3(), _z = new THREE.Vector3();
const toScreen = (w) => { const p = w.clone().project(camera); return { x: (p.x + 1) / 2 * innerWidth, y: (1 - p.y) / 2 * innerHeight }; };
let cadDrag = null;
function editDown(e) {
  if (!editing || e.shiftKey) return false;
  setRay(e);
  const hit = view()?.pick(ray);
  if (!hit) { if (cadSel) { cadSel = null; redrawCad(); buildPanels(); } return false; }
  const g = view().group;
  g.updateWorldMatrix(true, false);
  if (hit.type === 'handle') {
    const s = JSON.parse(JSON.stringify(sel1()));
    const axisLocal = [0, 0, 0]; axisLocal[hit.axis] = 1;
    const d = S.rotateVec(axisLocal, s.rot); // the face's direction, in the model's own space
    const c = new THREE.Vector3(...s.pos);
    const sa = toScreen(g.localToWorld(c.clone())), sb = toScreen(g.localToWorld(c.clone().add(new THREE.Vector3(...d).multiplyScalar(10))));
    const len = Math.hypot(sb.x - sa.x, sb.y - sa.y) || 1e-6;
    cadDrag = { kind: 'resize', s, axis: hit.axis, sign: hit.sign, x0: e.clientX, y0: e.clientY, dx: (sb.x - sa.x) / len, dy: (sb.y - sa.y) / len, ppm: len / 10 };
  } else {
    if (cadSel !== hit.id) { cadSel = hit.id; redrawCad(); buildPanels(); }
    const s = JSON.parse(JSON.stringify(sel1()));
    camera.matrixWorld.extractBasis(_r, _u, _z);
    const c0 = g.localToWorld(new THREE.Vector3(...s.pos));
    const pp = toScreen(c0.clone().add(_r)).x - toScreen(c0).x || 1; // pixels in a world unit
    cadDrag = { kind: 'move', s, x0: e.clientX, y0: e.clientY, c0, r: _r.clone(), u: _u.clone(), pp, start: g.worldToLocal(c0.clone()) };
  }
  dragging = 'cad'; spinPause = true;
  e.preventDefault(); document.body.setPointerCapture?.(e.pointerId);
  return true;
}
function cadMove(e) {
  const d = cadDrag;
  const step = e.shiftKey ? 5 : 1;
  if (d.kind === 'resize') {
    const along = ((e.clientX - d.x0) * d.dx + (e.clientY - d.y0) * d.dy) / d.ppm;
    cadSpec = S.replaceShape(cadSpec, S.resizeFace(d.s, d.axis, d.sign, along, step));
  } else {
    const dx = (e.clientX - d.x0) / d.pp, dy = -(e.clientY - d.y0) / d.pp;
    const target = view().group.worldToLocal(d.c0.clone().addScaledVector(d.r, dx).addScaledVector(d.u, dy));
    const dl = target.sub(d.start);
    cadSpec = S.replaceShape(cadSpec, S.moveBy(d.s, [dl.x, dl.y, dl.z], step));
  }
  redrawCad();
}
function editUp() {
  if (cadDrag || scrub) { cadDrag = null; scrub = null; hist.push(cadSpec); scheduleSave(); buildPanels(); }
}

// The whole model as a GLB for the phone (plain materials, textures kept for photo models). A designed model goes out in its own millimetres.
async function exportWholeGlb() {
  const root = new THREE.Group();
  const cad = items.length === 1 && itemWraps[0]?.userData.cadView;
  if (cad) { if (editing) leaveEdit(); if (cad.mesh) root.add(new THREE.Mesh(cad.mesh.geometry, exportMaterial(cad.mesh))); }
  else {
    holo.updateWorldMatrix(true, true);
    const inv = new THREE.Matrix4().copy(holo.matrixWorld).invert();
    holo.traverse((o) => {
      if (!o.isMesh || !o.geometry || !o.visible || o.material?.visible === false) return;
      const c = new THREE.Mesh(o.geometry, exportMaterial(Array.isArray(o.material) ? { ...o, material: o.material[0], userData: o.userData } : o));
      new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld).decompose(c.position, c.quaternion, c.scale);
      root.add(c);
    });
  }
  if (!root.children.length) return null;
  const bytes = await new Promise((resolve, reject) => new GLTFExporter().parse(root, resolve, reject, { binary: true }));
  return { bytes: new Uint8Array(bytes), mm: !!cad };
}

// The model as plain triangles (9 numbers each): a designed one in its own millimetres, anything else as it is drawn.
function collectTriangles() {
  const out = [];
  const take = (mesh, m) => {
    const g = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry;
    const a = g.attributes.position;
    const v = new THREE.Vector3();
    for (let i = 0; i < a.count; i++) { v.fromBufferAttribute(a, i); if (m) v.applyMatrix4(m); out.push(v.x, v.y, v.z); }
  };
  const cad = items.length === 1 && itemWraps[0]?.userData.cadView;
  if (cad) { if (editing) leaveEdit(); if (cad.mesh) take(cad.mesh, null); return { tris: new Float32Array(out), mm: true }; }
  holo.updateWorldMatrix(true, true);
  const inv = new THREE.Matrix4().copy(holo.matrixWorld).invert();
  holo.traverse((o) => { if (o.isMesh && o.geometry && o.visible && o.material?.visible !== false) take(o, new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld)); });
  return { tris: new Float32Array(out), mm: false };
}

// Saves the model as a file (stl, 3mf or step), standing on the bed, z up; a designed model keeps its real size, anything else is 100 mm across.
// openWith: an app to open it in afterwards (a slicer or a CAD app).
async function saveModel(format = 'stl', openWith = '') {
  try {
    const { tris, mm } = collectTriangles();
    if (!tris.length) { $('err').textContent = 'There is nothing to save yet.'; return; }
    const z = zUp(tris, { scaleTo: mm ? 0 : 100 });
    const name = $('title').textContent || 'hologram';
    const bytes = format === '3mf' ? to3mf(z, name) : format === 'step' ? toStep(z, name) : toStl(z, name);
    const r = await relay.holoSave({ name, ext: format, bytes, openWith });
    $('err').textContent = r?.ok ? `Saved to ${r.where}${r.opened ? ` and opened in ${openWith}` : ''}` : (r?.error || 'Could not save it.');
  } catch (e) { $('err').textContent = /too detailed/.test(e.message) ? e.message : 'Could not save it.'; }
  setTimeout(() => { $('err').textContent = ''; }, 5000);
}

// The hologram as a file, ready to be dragged into an app (Fusion, a slicer, a folder, a message): it is written to a folder of Relay's as soon as the
// model is drawn or changed, and the drag-to-an-app button hands that file to the system's drag. The file type is a setting.
let modelVer = 0;
let staged = { ver: -1, path: '' };
let staging = null;
let stageTimer = 0;
function bumpModel() { modelVer++; clearTimeout(stageTimer); stageTimer = setTimeout(() => stageFile().catch(() => {}), 1200); }
function stageFile() {
  if (staged.ver === modelVer && staged.path) return Promise.resolve(staged.path);
  if (staging) return staging;
  const ver = modelVer;
  staging = (async () => {
    const { tris, mm } = collectTriangles();
    if (!tris.length) return '';
    const z = zUp(tris, { scaleTo: mm ? 0 : 100 });
    const name = $('title').textContent || 'hologram';
    const make = (fmt) => (fmt === '3mf' ? to3mf(z, name) : fmt === 'step' ? toStep(z, name) : toStl(z, name));
    let fmt = ui.dragFormat || 'stl', bytes;
    try { bytes = make(fmt); } catch { fmt = 'stl'; bytes = make('stl'); } // a model too detailed for STEP goes out as an STL
    const r = await relay.holoStage({ name, ext: fmt, bytes });
    staged = { ver, path: r?.ok ? r.path : '' };
    return staged.path;
  })().catch(() => '').finally(() => { staging = null; });
  return staging;
}
$('dragout').addEventListener('mouseenter', () => stageFile());
$('dragout').addEventListener('dragstart', (e) => {
  e.preventDefault(); // the system's own drag takes over (main starts it with the file)
  if (staged.path) relay.holoStartDrag();
  else { $('err').textContent = 'Getting the file ready: try again in a moment.'; stageFile(); setTimeout(() => { $('err').textContent = ''; }, 3000); }
});

// The save button: pick a file type, or send it to an app that is installed (a slicer to print it, Fusion to edit it).
const saveMenu = document.createElement('div');
saveMenu.id = 'savemenu';
document.body.append(saveMenu);
async function openSaveMenu() {
  const apps = await relay.holoSlicers().catch(() => []);
  const row = (label, act) => `<div class="cadui" data-act="${act}">${label}</div>`;
  saveMenu.innerHTML = `<div class="cadh">Save as</div>${row('STL (3D printing)', 'fmt:stl')}${row('3MF (slicers, keeps millimetres)', 'fmt:3mf')}${row('STEP (CAD: Fusion, FreeCAD)', 'fmt:step')}` + (apps.length ? `<div class="cadh">Send to</div>${apps.map((a) => row(a.name, `app:${a.name}:${a.format}`)).join('')}` : '');
  const r = $('save').getBoundingClientRect();
  saveMenu.style.left = `${Math.max(8, Math.min(innerWidth - 260, r.left - 60))}px`;
  saveMenu.style.top = `${Math.min(innerHeight - 220, r.bottom + 8)}px`;
  saveMenu.classList.add('open');
}
saveMenu.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  saveMenu.classList.remove('open');
  const [kind, a, b] = el.dataset.act.split(':');
  if (kind === 'fmt') saveModel(a); else saveModel(b, a);
});

let extracting = false;
// Takes a piece out of this hologram (it becomes its own, or joins the one it was let go over). The rest stays where it is, pulled apart.
async function takeOut(part, at) {
  if (extracting) return;
  extracting = true;
  try {
    const g = itemWraps[part.item].userData.g;
    const same = parts.filter((p) => p.item === part.item);
    const rest = same.filter((p) => p !== part);
    const [partBytes, restBytes] = await Promise.all([exportGlb([part], g), rest.length ? exportGlb(rest, g) : null]);
    parts = parts.filter((p) => p !== part);
    part.obj.removeFromParent();
    if (selected === part) selected = null;
    if (hovered === part) hovered = null;
    relay.holoExtract({ item: part.item, name: part.name, part: new Uint8Array(partBytes), rest: restBytes ? new Uint8Array(restBytes) : null, x: at.x, y: at.y });
  } catch { $('err').textContent = 'Could not take that piece out.'; }
  extracting = false;
}

// ---------- pointer: turn the model every way, move the hologram by its name, scroll to resize, carry pieces ----------
const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
let over = false;
let dragging = null; // 'rotate' | 'move' | 'piece'
let last = null;
let carried = null; // { part, outside, lastSent }

function setRay(e) {
  ndc.set((e.clientX / innerWidth) * 2 - 1, -((e.clientY / innerHeight) * 2 - 1));
  ray.setFromCamera(ndc, camera);
}
function pickPart(e) {
  if (!exploded) return null;
  setRay(e);
  const hit = ray.intersectObjects(parts.flatMap((p) => p.meshes), false)[0];
  return hit ? parts.find((p) => p.meshes.includes(hit.object)) : null;
}
function pick(e) {
  const ui = document.elementFromPoint(e.clientX, e.clientY);
  if (ui && ui.closest('#move, #title')) return 'move';
  if (ui && ui.closest('.btn, .cadui, .num, .notex')) return 'ui';
  setRay(e);
  const meshes = [];
  holo.traverse((o) => { if (o.isMesh) meshes.push(o); });
  if (ray.intersectObjects(meshes, false).length) return 'model';
  return null;
}
function setOver(on) { if (on !== over) { over = on; relay.holoHit(on); } }
const nearStage = (e) => { const r = Math.max(70, modelR * PPU * userScale + 8); return Math.abs(e.clientX - pos.x) < r + 120 && e.clientY > pos.y - r - (clip.on ? 110 : 40) && e.clientY < pos.y + r + (document.body.classList.contains('hand') ? 240 : 170); };
// What a control does, shown above it while the pointer is on it (the window never takes focus, so the browser's own tooltips never appear).
const tip = $('tip');
function showTip(e) {
  const el = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-tip]');
  if (!el || dragging) { tip.classList.remove('show'); return; }
  const dyn = el.id === 'explode' && exploded ? 'Put it back together (or double-click)' : el.id === 'pin' && el.classList.contains('on') ? 'Kept: click to let it go when I say close' : el.id === 'solid' && el.classList.contains('on') ? 'Back to hologram' : '';
  tip.textContent = dyn || el.dataset.tip;
  const r = el.getBoundingClientRect();
  tip.classList.add('show');
  const w = tip.offsetWidth;
  tip.style.left = `${Math.max(8, Math.min(innerWidth - w - 8, r.left + r.width / 2 - w / 2))}px`;
  tip.style.top = `${r.top - 34}px`;
}
addEventListener('mousemove', (e) => {
  showTip(e);
  const p = pick(e);
  document.body.classList.toggle('near', nearStage(e) || !!p || !!dragging);
  if (dragging) return;
  setOver(!!p);
  const part = p === 'model' ? pickPart(e) : null;
  setHover(part);
  cv.style.cursor = p === 'move' ? 'move' : part ? 'pointer' : p === 'model' ? (measuring ? 'crosshair' : 'grab') : 'default';
});
addEventListener('mouseleave', () => { tip.classList.remove('show'); if (!dragging) { document.body.classList.remove('near'); setHover(null); } });
addEventListener('pointerdown', (e) => {
  touched();
  if (!e.target.closest('#ctl')) document.body.classList.remove('menu-open');
  if (!e.target.closest('#savemenu, #save')) saveMenu.classList.remove('open');
  if (measuring && pick(e) === 'model') { measureClick(e); e.preventDefault(); return; }
  if (annotating && pick(e) === 'model') { annotateClick(e); e.preventDefault(); return; }
  if (editDown(e)) return;
  const p = pick(e);
  if (p === 'move' || (p === 'model' && e.altKey)) { dragging = 'move'; relay.holoDrag('start'); }
  else if (p === 'model') {
    const part = pickPart(e);
    const multi = !exploded && !editing && items.length > 1 && !e.altKey;
    const pi = multi ? pickItem(e) : -1;
    if (multi && pi >= 0 && pi === selItem && !e.shiftKey) { itemStart(e, pi); dragging = 'item'; $('hint2').textContent = ''; }
    else if (multi && pi >= 0 && pi !== selItem) { glowItem(selItem, 0); selItem = pi; glowItem(pi, 0.8); $('hint2').textContent = 'Drag the lit model onto another to place it there · Shift+scroll resizes it'; document.body.classList.add('hinting'); dragging = 'rotate'; last = { x: e.clientX, y: e.clientY }; cv.style.cursor = 'grabbing'; }
    else if (part && !e.shiftKey && explodeT > 0.9) { select(part); dragging = 'piece'; carried = { part, outside: false, sent: 0 }; last = { x: e.clientX, y: e.clientY }; cv.style.cursor = 'grabbing'; }
    else { if (selected) select(null); dragging = 'rotate'; last = { x: e.clientX, y: e.clientY }; cv.style.cursor = 'grabbing'; }
  }
  if (dragging) { e.preventDefault(); document.body.setPointerCapture?.(e.pointerId); spinPause = true; }
});
const qDrag = new THREE.Quaternion();
const axisX = new THREE.Vector3(1, 0, 0);
const axisY = new THREE.Vector3(0, 1, 0);
const axisZ = new THREE.Vector3(0, 0, 1);
const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();
addEventListener('pointermove', (e) => {
  if (dragging === 'cad' && cadDrag) return cadMove(e);
  if (dragging === 'item' && itemDrag) return itemMove(e);
  if (dragging === 'num' && scrub) return scrubMove(e);
  if (dragging === 'rotate') {
    // up, down, sideways and diagonal alike: the model turns the way the pointer pushes it, about the screen's own axes
    const dx = e.clientX - last.x, dy = e.clientY - last.y;
    last = { x: e.clientX, y: e.clientY };
    qDrag.setFromAxisAngle(axisY, dx * 0.011).multiply(new THREE.Quaternion().setFromAxisAngle(axisX, dy * 0.011));
    holo.quaternion.premultiply(qDrag).normalize();
    orient.copy(holo.quaternion);
  } else if (dragging === 'piece' && carried) {
    const dx = e.clientX - last.x, dy = e.clientY - last.y;
    last = { x: e.clientX, y: e.clientY };
    const part = carried.part;
    // the piece goes where the pointer goes, in the plane of the screen, whatever way the hologram is turned
    holo.updateMatrixWorld(true);
    part.obj.getWorldPosition(tmpA);
    tmpB.copy(tmpA).add(new THREE.Vector3(dx / PPU, -dy / PPU, 0));
    const lp = part.obj.parent.worldToLocal(tmpB.clone());
    part.off.add(lp.sub(part.obj.position));
    part.obj.position.copy(part.base).add(part.off);
    const c = new THREE.Box3().setFromObject(part.obj).getCenter(new THREE.Vector3()).project(camera);
    const px = (c.x + 1) / 2 * innerWidth, py = (1 - c.y) / 2 * innerHeight;
    carried.at = { x: px, y: py };
    carried.outside = Math.hypot(px - pos.x, py - pos.y) > zonePx;
    const now = performance.now();
    if (now - carried.sent > 40) { carried.sent = now; relay.holoPiece({ phase: 'move', x: px, y: py, outside: carried.outside }).then((r) => { if (carried) { carried.over = !!r?.over; $('merge').textContent = r?.over ? 'Release to combine' : 'Release to take it out'; document.body.classList.toggle('merging', !!r?.over || carried.outside); } }).catch(() => {}); }
  }
});
async function endDrag() {
  if (!dragging) return;
  const d = dragging;
  if (d === 'cad' || d === 'num') { editUp(); dragging = null; spinPause = false; return; }
  if (d === 'item') { if (itemDrag) sendPlace(itemDrag.i); itemDrag = null; dragging = null; spinPause = false; return; }
  dragging = null;
  spinPause = false;
  if (d === 'move') { relay.holoDrag('end'); return; }
  if (d === 'piece' && carried) {
    const c = carried;
    carried = null;
    document.body.classList.remove('merging');
    $('merge').textContent = 'Release to combine';
    const r = await relay.holoPiece({ phase: 'drop', x: c.at?.x ?? pos.x, y: c.at?.y ?? pos.y, outside: c.outside }).catch(() => null);
    if (r?.take) takeOut(c.part, c.at || pos);
    else relay.holoPiece({ phase: 'cancel' });
  }
}
addEventListener('pointerup', endDrag);
addEventListener('pointercancel', endDrag);
addEventListener('blur', endDrag);
addEventListener('wheel', (e) => {
  e.preventDefault();
  touched();
  if (e.shiftKey && selItem >= 0 && itemWraps[selItem]) { itemWraps[selItem].scale.multiplyScalar(Math.exp(-(e.deltaY || e.deltaX) * 0.002)); clearTimeout(placeTimer); const k = selItem; placeTimer = setTimeout(() => sendPlace(k), 300); return; } userScale = Math.min(4, Math.max(0.3, userScale * Math.exp(-e.deltaY * (e.ctrlKey ? 0.011 : 0.0015)))); applyScale(); relay.holoScale(userScale); }, { passive: false }); // a pinch on the trackpad arrives as a wheel with ctrl held: smaller steps, so it is stronger
addEventListener('dblclick', (e) => { if (editing) return; if (!pick(e) || pick(e) === 'ui' || pick(e) === 'move') return; toggleExplode(); });
let spinPause = false;
// Files dropped on the hologram (the window takes drags only while the mouse button is held over it).
addEventListener('dragover', (e) => { e.preventDefault(); document.body.classList.add('dropping'); });
addEventListener('dragleave', () => document.body.classList.remove('dropping'));
addEventListener('drop', (e) => { e.preventDefault(); document.body.classList.remove('dropping'); touched(); if (e.dataTransfer?.files?.length) relay.holoDropFiles(e.dataTransfer.files); });
let placeTimer = 0;
let handScaleTimer = 0;

// The model's size, and the box that holds the name and the controls round it, follow the zoom.
function applyScale() {
  holo.scale.setScalar(kFit * userScale);
  const R = 150 * userScale + 40;
  const st = $('stage');
  st.style.left = `${pos.x - 230}px`; st.style.top = `${pos.y - R}px`; st.style.height = `${2 * R}px`;
  st.style.setProperty('--mr', `${Math.max(70, modelR * PPU * userScale + 8)}px`);
  if (editing) layoutCad();
}
let anchorY = 0;
function setPos(x, y) {
  pos.x = x; pos.y = y;
  anchorY = -(y - innerHeight / 2) / PPU;
  anchor.position.set((x - innerWidth / 2) / PPU, anchorY, 0);
  applyScale();
}

// ---------- controls ----------
$('close').onclick = () => relay.holoClose();
$('pin').onclick = () => { const on = !$('pin').classList.contains('on'); $('pin').classList.toggle('on', on); relay.holoPin(on); };
$('solid').onclick = () => { solid = !solid; $('solid').classList.toggle('on', solid); rebuild().catch(() => {}); relay.holoSolid(solid); };
$('more').onclick = () => document.body.classList.toggle('menu-open');
$('items').addEventListener('click', () => document.body.classList.remove('menu-open'));
$('explode').onclick = toggleExplode;
$('edit').onclick = () => (editing ? leaveEdit() : enterEdit());
$('save').onclick = () => (saveMenu.classList.contains('open') ? saveMenu.classList.remove('open') : openSaveMenu());
// Ask Relay about the whole model, or the piece that is picked out: it is sent a picture of the hologram with that piece lit.
function askInfo() {
  const r = Math.min(Math.max(190 * userScale + 40, exploded ? zonePx + 60 : 0), Math.min(innerWidth, innerHeight) / 2);
  const x = Math.max(0, Math.round(pos.x - r)), y = Math.max(0, Math.round(pos.y - r));
  return { region: { x, y, width: Math.round(Math.min(2 * r, innerWidth - x)), height: Math.round(Math.min(2 * r + 70, innerHeight - y)) }, part: selected ? selected.name : null, regions: hintText.includes('regions') };
}
window.__holoAsk = askInfo; // main asks for this when your hand opens the mic over a hologram
$('ask').onclick = () => relay.holoAsk(askInfo());
$('reset').onclick = () => { orient.identity(); holo.quaternion.identity(); userScale = 1; applyScale(); relay.holoScale(1); };
$('upright').onclick = () => { upright = (upright + 1) % 3; rebuild().catch(() => {}); };
$('prev').onclick = () => relay.holoOption(-1);
$('next').onclick = () => relay.holoOption(1);

function setOptions(o) {
  const many = o && o.count > 1;
  for (const id of ['prev', 'next', 'opt']) $(id).hidden = !many;
  if (many) $('opt').textContent = `${o.index + 1} / ${o.count}`;
}

relay.onHolo((m, d) => {
  if (m === 'init' || m === 'items') {
    if (m === 'init') { applyUi(d.ui); document.body.classList.toggle('hand', !!d.handMode); solid = !!d.solid; userScale = d.scale || 1; if (d.pos) setPos(d.pos.x, d.pos.y); applyScale(); $('pin').classList.toggle('on', !!d.pinned); $('solid').classList.toggle('on', solid); }
    items = d.items;
    if (Array.isArray(d.annotations)) { notes = d.annotations; drawNotes(); }
    $('title').textContent = d.title || '';
    $('credit').textContent = items.map((i) => i.credit).filter(Boolean).join('  ·  ');
    $('err').textContent = '';
    setOptions(d.options);
    rebuild().catch(() => { $('err').textContent = 'Could not draw that model.'; });
  } else if (m === 'merge-hint') { document.body.classList.toggle('merging', !!d); $('merge').textContent = d === 'fit' ? 'Fitting…' : 'Release to combine'; }
  else if (m === 'ui') applyUi(d);
  else if (m === 'pos') { setPos(d.x, d.y); touched(); }
  else if (m === 'hand-mode') { document.body.classList.toggle('hand', !!d); applyScale(); }
  else if (m === 'hand-explode') { touched(); if (!editing && !!d !== exploded) toggleExplode(); }
  else if (m === 'hand-twist') { touched(); qDrag.setFromAxisAngle(axisZ, -d); holo.quaternion.premultiply(qDrag).normalize(); orient.copy(holo.quaternion); }
  else if (m === 'export-glb') exportWholeGlb().then((r) => relay.holoGlb(r)).catch(() => relay.holoGlb(null));
  else if (m === 'save') saveModel(d?.format || 'stl', d?.openWith || '');
  else if (m === 'hand-scale') { touched(); userScale = Math.min(3, Math.max(0.4, userScale * d)); applyScale(); clearTimeout(handScaleTimer); handScaleTimer = setTimeout(() => relay.holoScale(userScale), 250); }
  else if (m === 'pinned') $('pin').classList.toggle('on', !!d);
  else if (m === 'annotations') { notes = Array.isArray(d) ? d : []; drawNotes(); }
  else if (m === 'real-size') relay.holoRealSize(realSize(d?.mm || 0));
  else if (m === 'error') $('err').textContent = d;
});

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.position.set(0, 0, h / (2 * PPU * Math.tan(rad(FOV / 2)))); // far enough that a unit is PPU pixels at the middle of the scene
  camera.updateProjectionMatrix();
  setPos(pos.x, pos.y);
}
addEventListener('resize', resize);
resize();

// ---------- measuring: click two points on the model, see the distance in millimetres ----------
// A designed model is in real millimetres. Anything else has no known size: like the files it is saved as, its biggest side is taken as 100 mm.
let measuring = false;
const mpts = []; // the points, in the model's own frame (so they turn with it)
const mkG = new THREE.Group(); // dots and the line: never part of the model, a pick or a saved file
mkG.visible = false;
scene.add(mkG); // in the scene itself: a rebuild clears everything in the anchor
const mDot = () => new THREE.Mesh(new THREE.SphereGeometry(0.045, 16, 12), new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false }));
const mDots = [mDot(), mDot()];
mDots.forEach((d) => { d.renderOrder = 20; d.frustumCulled = false; d.raycast = () => {}; d.visible = false; mkG.add(d); });
const mLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineBasicMaterial({ color: 0x9fe8ff, depthTest: false }));
mLine.renderOrder = 19; mLine.frustumCulled = false; mLine.raycast = () => {}; mLine.visible = false; mkG.add(mLine);
let mmNote = false;
function mmBetween(a, b) {
  // millimetres between two points of the model's frame
  const cad = items.length === 1 && itemWraps[0]?.userData.cadView?.mesh;
  const local = a.distanceTo(b);
  if (cad) { cad.updateWorldMatrix(true, false); const s = new THREE.Vector3().setFromMatrixScale(cad.matrixWorld).x || 1; return { mm: (local * holo.scale.x) / s, exact: true }; }
  measureClip();
  const big = Math.max(...clip.box.getSize(new THREE.Vector3()).toArray()) || 1;
  return { mm: (local / big) * 100, exact: false };
}
function measureClick(e) {
  setRay(e);
  const meshes = [];
  holo.traverse((o) => { if (o.isMesh) meshes.push(o); });
  const hit = ray.intersectObjects(meshes, false)[0];
  if (!hit) return null;
  if (mpts.length >= 2) mpts.length = 0; // a third click starts again
  mpts.push(holo.worldToLocal(hit.point.clone()));
  touched();
  if (!mmNote) { mmNote = true; if (!(items.length === 1 && itemWraps[0]?.userData.cadView)) { $('err').textContent = 'Sizes take its biggest side as 100 mm (the same as the files it saves as).'; setTimeout(() => { $('err').textContent = ''; }, 5000); } }
  return measureState();
}
function measureState() { return mpts.length === 2 ? { n: 2, ...mmBetween(mpts[0], mpts[1]), world: +(mpts[0].distanceTo(mpts[1]) * holo.scale.x).toFixed(4) } : { n: mpts.length }; }
function setMeasure(on) {
  measuring = !!on;
  $('measure').classList.toggle('on', measuring);
  if (!measuring) { mpts.length = 0; }
  mkG.visible = measuring;
  if (!measuring) $('mlabel').style.display = 'none';
  document.body.classList.remove('menu-open');
}
$('measure').onclick = () => setMeasure(!measuring);

// ---------- notes pinned to spots on the model ----------
// A note is { id, text, item, p (the spot, in the model's own space, so it turns and grows with it), n (which way the surface faces) }. Click "Add a note",
// then a spot: Relay asks what the note should say and the answer is kept with the hologram (and comes back when it does).
let notes = [];
let annotating = false;
const notesEl = $('notes');
function drawNotes() {
  notesEl.textContent = '';
  for (const n of notes) {
    const d = document.createElement('div');
    d.className = 'note';
    d.dataset.id = n.id;
    const t = document.createElement('span'); t.className = 'txt'; t.textContent = n.text;
    const x = document.createElement('span'); x.className = 'notex'; x.textContent = '×'; x.title = 'Remove this note';
    x.onclick = (e) => { e.stopPropagation(); notes = notes.filter((m) => m.id !== n.id); drawNotes(); relay.holoAnnotations(notes); };
    d.append(t, x);
    notesEl.append(d);
  }
}
const noteV = new THREE.Vector3(), noteN = new THREE.Vector3(), noteQ = new THREE.Quaternion();
function placeNotes() {
  if (!notes.length) return;
  holo.updateMatrixWorld(true);
  noteQ.copy(holo.getWorldQuaternion(noteQ));
  for (const el of notesEl.children) {
    const n = notes.find((m) => m.id === el.dataset.id);
    if (!n) continue;
    noteV.set(...n.p).applyMatrix4(holo.matrixWorld);
    const toCam = camera.position.clone().sub(noteV).normalize();
    const facing = n.n ? noteN.set(...n.n).applyQuaternion(noteQ).dot(toCam) : 1;
    noteV.project(camera);
    el.style.left = `${(noteV.x + 1) / 2 * innerWidth}px`;
    el.style.top = `${(1 - noteV.y) / 2 * innerHeight}px`;
    el.classList.toggle('back', facing < -0.1 && !exploded); // on the far side of the model: hidden until it turns round
  }
}
function annotateClick(e) {
  setRay(e);
  const meshes = [];
  holo.traverse((o) => { if (o.isMesh) meshes.push(o); });
  const hit = ray.intersectObjects(meshes, false)[0];
  if (!hit) return null;
  const p = holo.worldToLocal(hit.point.clone());
  const nrm = hit.face ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld).applyQuaternion(holo.getWorldQuaternion(new THREE.Quaternion()).invert()) : null;
  const item = Math.max(0, itemWraps.findIndex((w) => { let o = hit.object; while (o) { if (o === w) return true; o = o.parent; } return false; }));
  const spot = { item, p: p.toArray().map((v) => +v.toFixed(5)), ...(nrm ? { n: nrm.toArray().map((v) => +v.toFixed(5)) } : {}) };
  setAnnotate(false);
  relay.holoAnnotate(spot); // Relay listens for what the note says; the text comes back in a 'annotations' message
  return spot;
}
function setAnnotate(on) {
  annotating = !!on;
  $('annotate').classList.toggle('on', annotating);
  document.body.classList.toggle('annotating', annotating);
  if (annotating) { $('hint2').textContent = 'Click a spot on the model to pin a note there'; if (measuring) setMeasure(false); }
  else if ($('hint2').textContent.startsWith('Click a spot')) $('hint2').textContent = '';
  document.body.classList.remove('menu-open');
}
$('annotate').onclick = () => setAnnotate(!annotating);

// Life size: the model drawn so that a millimetre of it is a millimetre of your screen. The screen's points per inch is a setting (calibrated against
// a credit card in Settings > General > Holograms); a point is a CSS pixel. A designed model knows its size in millimetres; any other needs to be told
// how long its longest side is (mm). Returns { ok, mm } or { ok: false, reason }.
function realSize(mmLongest = 0) {
  const ptsPerMm = pointsPerInch / 25.4;
  const cad = items.length === 1 && itemWraps[0]?.userData.cadView?.mesh;
  let k; // pixels one millimetre of the model takes up now
  let mm;
  if (cad) {
    cad.updateWorldMatrix(true, false);
    const s = new THREE.Vector3().setFromMatrixScale(cad.matrixWorld).x || 1; // scene units to a millimetre
    k = s * PPU;
    const box = new THREE.Box3().setFromObject(cad);
    mm = Math.max(...box.getSize(new THREE.Vector3()).toArray()) / s;
  } else if (mmLongest > 0) {
    const longest = Math.max(...new THREE.Box3().setFromObject(holo).getSize(new THREE.Vector3()).toArray());
    if (!(longest > 0)) return { ok: false, reason: 'The model has no size yet.' };
    k = (longest * PPU) / mmLongest;
    mm = mmLongest;
  } else return { ok: false, reason: 'need-size' };
  const want = userScale * ptsPerMm / k;
  const px = mm * ptsPerMm;
  if (want > 4 || want < 0.3) { userScale = Math.min(4, Math.max(0.3, want)); applyScale(); relay.holoScale(userScale); return { ok: false, reason: px > Math.min(innerWidth, innerHeight) ? 'It is bigger than your screen at life size, so it is as large as it goes.' : 'It is too small to show clearly at life size.', mm }; }
  userScale = want;
  applyScale();
  relay.holoScale(userScale);
  return { ok: true, mm: Math.round(mm * 10) / 10 };
}
$('realsize').onclick = () => {
  const r = realSize(0);
  $('err').textContent = r.ok ? `Life size: ${r.mm} mm long, on your screen.` : r.reason === 'need-size' ? 'Say how big it really is, for example “show it life size, it is 30 cm long”.' : r.reason;
  setTimeout(() => { $('err').textContent = ''; }, 6000);
  document.body.classList.remove('menu-open');
};

// Print check: the model as a printer would see it (z up, on the bed, millimetres), said in a few lines.
function runPrintCheck() {
  const { tris, mm } = collectTriangles();
  const r = tris.length ? printCheck(zUp(tris, { scaleTo: mm ? 0 : 100 })) : null;
  if (!r) { $('err').textContent = 'There is nothing to check yet.'; setTimeout(() => { $('err').textContent = ''; }, 4000); return null; }
  $('err').textContent = `${r.sizeMm.join(' × ')} mm${mm ? '' : ' (a guess: 100 mm across)'}${r.volumeCm3 !== null ? `, ${r.volumeCm3} cm³` : ''}. ${r.notes.join(' ')}`;
  setTimeout(() => { $('err').textContent = ''; }, 12000);
  return r;
}
$('printcheck').onclick = () => runPrintCheck();
const mw = new THREE.Vector3();
function updateMeasure() {
  if (!measuring) return;
  holo.updateMatrixWorld(true);
  const ws = mpts.map((p) => holo.localToWorld(p.clone()));
  mDots.forEach((d, i) => { d.visible = !!ws[i]; if (ws[i]) d.position.copy(ws[i]); });
  mLine.visible = ws.length === 2;
  const lab = $('mlabel');
  if (ws.length === 2) {
    mLine.geometry.setFromPoints(ws);
    const r = mmBetween(mpts[0], mpts[1]);
    const mid = ws[0].clone().add(ws[1]).multiplyScalar(0.5);
    mid.project(camera);
    lab.textContent = `${r.exact ? '' : '≈ '}${r.mm < 10 ? r.mm.toFixed(2) : r.mm < 100 ? r.mm.toFixed(1) : Math.round(r.mm)} mm`;
    lab.style.left = `${(mid.x + 1) / 2 * innerWidth}px`; lab.style.top = `${(1 - mid.y) / 2 * innerHeight}px`; lab.style.display = 'block';
  } else lab.style.display = 'none';
}

// ---------- the cut bar: slide a plane through the model to see inside it ----------
const cutVis = new THREE.Group(); // a faint sheet that shows where the cut is (in the anchor, so it is never part of the model or of a saved file)
{
  const sq = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: 0x25c8ff, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
  const ln = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(1, 1)), new THREE.LineBasicMaterial({ color: 0x9fe8ff, transparent: true, opacity: 0.9, depthTest: false }));
  sq.raycast = () => {}; ln.raycast = () => {};
  cutVis.add(sq, ln);
  cutVis.visible = false;
  scene.add(cutVis); // in the scene itself: a rebuild clears everything in the anchor
}
const tmpN = new THREE.Vector3();
const tmpP = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();
const AXIS_V = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)];
// The model's box in its own frame (what turns), measured when the bar is opened.
function measureClip() {
  holo.updateMatrixWorld(true);
  const inv = holo.matrixWorld.clone().invert();
  const box = new THREE.Box3();
  holo.traverse((o) => { if (o.isMesh && o.geometry) { o.geometry.computeBoundingBox(); const b = o.geometry.boundingBox.clone().applyMatrix4(inv.clone().multiply(o.matrixWorld)); box.union(b); } });
  clip.box = box.isEmpty() ? new THREE.Box3(new THREE.Vector3(-1, -1, -1), new THREE.Vector3(1, 1, 1)) : box;
}
// The cut is fixed in the model's own frame: when the cut is made (or its direction chosen) the screen's X, Y or Z becomes a direction in the model, and from then on
// turning the model turns the section with it, like a real piece cut through. (A model's own axes are arbitrary, so the direction is picked on screen.)
function lockClipAxis() {
  holo.updateMatrixWorld(true);
  const q = holo.getWorldQuaternion(new THREE.Quaternion()).invert();
  clip.nLocal = AXIS_V[clip.axis].clone().applyQuaternion(q).normalize();
}
function updateClip() {
  if (!clip.on) { uniforms.clipOn.value = 0; clipPlane.set(tmpN.set(0, -1, 0), 1e6); cutVis.visible = false; return; }
  holo.updateMatrixWorld(true);
  const wb = new THREE.Box3().setFromObject(holo);
  if (wb.isEmpty()) return;
  if (!clip.nLocal) lockClipAxis();
  if (!clip.box) measureClip();
  const sign = clip.flip ? -1 : 1;
  const nl = clip.nLocal;
  const bc = clip.box.getCenter(new THREE.Vector3());
  const bs = clip.box.getSize(new THREE.Vector3());
  const half = (Math.abs(nl.x) * bs.x + Math.abs(nl.y) * bs.y + Math.abs(nl.z) * bs.z) / 2; // how far the model reaches along the cut direction, from its middle
  const pl = bc.clone().addScaledVector(nl, sign * clip.t * half * 1.02); // a point on the plane, in the model's frame
  const pw = pl.applyMatrix4(holo.matrixWorld);
  tmpN.copy(nl).transformDirection(holo.matrixWorld).multiplyScalar(sign);
  uniforms.clipN.value.copy(tmpN);
  uniforms.clipD.value = -tmpN.dot(pw);
  uniforms.clipOn.value = 1;
  clipPlane.set(tmpN.clone().negate(), tmpN.dot(pw));
  const sz = wb.getSize(new THREE.Vector3()).length() * 0.62;
  cutVis.visible = true;
  cutVis.position.copy(pw);
  cutVis.quaternion.copy(tmpQ.setFromUnitVectors(new THREE.Vector3(0, 0, 1), tmpN));
  cutVis.scale.set(sz, sz, 1);
  // the solid look, outlines and anything else that is not the hologram shader is cut by three's own planes
  holo.traverse((o) => {
    if (!(o.isMesh || o.isLineSegments) || !o.material) return;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      if (m.isShaderMaterial || m.clippingPlanes === clipPlanes) continue;
      m.clippingPlanes = clipPlanes;
      if (o.isMesh) m.side = THREE.DoubleSide;
      m.needsUpdate = true;
    }
  });
}
function setCut(on) {
  clip.on = !!on;
  if (clip.on) { clip.box = null; clip.nLocal = null; clip.t = Number($('cutr').value) / 100; }
  document.body.classList.toggle('cutting', clip.on);
  $('cut').classList.toggle('on', clip.on);
  touched();
  updateClip();
}
$('cut').onclick = () => { setCut(!clip.on); document.body.classList.remove('menu-open'); };
$('cutx').onclick = () => setCut(false);
$('cutflip').onclick = () => { clip.flip = !clip.flip; $('cutflip').classList.toggle('on', clip.flip); touched(); };
$('cutr').addEventListener('input', () => { clip.t = Number($('cutr').value) / 100; touched(); });
for (const b of document.querySelectorAll('#cutax b')) b.onclick = () => { clip.axis = Number(b.dataset.ax); for (const x of document.querySelectorAll('#cutax b')) x.classList.toggle('on', x === b); clip.box = null; clip.nLocal = null; touched(); };

let prev = performance.now();
const qSpin = new THREE.Quaternion();
function frame(now) {
  const dt = Math.min(0.05, (now - prev) / 1000); prev = now;
  uniforms.time.value = now / 1000;
  const t = Math.min(1, (now - reveal0) / 1100);
  const span = 1.3 * kFit * userScale;
  uniforms.originY.value = anchor.position.y - span;
  uniforms.reveal.value = -0.2 + (1 - Math.pow(1 - t, 3)) * (2 * span + 0.6); // the build sweep, from the bottom up
  const spinning = ui.spin && !spinPause && !exploded && !carried && !editing && !clip.on && now - lastTouch > ui.spinDelay * 1000;
  spinRate += ((spinning ? 0.35 : 0) - spinRate) * Math.min(1, dt * 2.2); // eases in and out instead of jerking
  if (spinRate > 0.003) { qSpin.setFromAxisAngle(axisY, dt * spinRate); holo.quaternion.premultiply(qSpin).normalize(); orient.copy(holo.quaternion); }
  anchor.position.y = anchorY + Math.sin(now / 900) * 0.03;
  if (parts.length) {
    const goal = exploded ? 1 : 0;
    explodeT += Math.sign(goal - explodeT) * Math.min(Math.abs(goal - explodeT), (dt * 1000) / EXPLODE_MS);
    for (const p of parts) if (p.off) p.obj.position.copy(p.base).addScaledVector(p.off, ease(explodeT));
  }
  for (let i = intros.length - 1; i >= 0; i--) { // a model flying in to join: it arrives on a curve and settles
    const it = intros[i];
    const t = Math.min(1, (now - it.t0) / 900);
    const e = ease(t);
    it.w.position.lerpVectors(it.from, it.to, e);
    it.w.scale.setScalar(it.s1 * (0.55 + 0.45 * e));
    if (t >= 1) intros.splice(i, 1);
  }
  if (clip.on) updateClip();
  updateMeasure();
  placeNotes();
  for (const a of animated) { a.o.rotation.x += rad(a.spin[0]) * dt; a.o.rotation.y += rad(a.spin[1]) * dt; a.o.rotation.z += rad(a.spin[2]) * dt; }
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
// A hook for the real-window tests: where each piece is on screen, and the state of the pull-apart. Nothing here changes anything.
window.__holoTest = {
  state: () => ({ exploded, explodeT, parts: parts.length, selected: selected ? parts.indexOf(selected) : -1, items: items.length, pos: { ...pos }, zonePx, q: holo.quaternion.toArray() }),
  where: (i) => { const p = parts[i]; if (!p) return null; const c = new THREE.Box3().setFromObject(p.obj).getCenter(new THREE.Vector3()).project(camera); return { x: (c.x + 1) / 2 * innerWidth, y: (1 - c.y) / 2 * innerHeight }; },
  fps: () => fps,
  scale: () => userScale,
  measureAt: (x, y) => { if (!measuring) setMeasure(true); return measureClick({ clientX: x, clientY: y }); },
  measureOff: () => setMeasure(false),
  measureState: () => measureState(),
  bounds: () => { const b = new THREE.Box3().setFromObject(holo); const p = (v) => { const w = v.clone().project(camera); return { x: (w.x + 1) / 2 * innerWidth, y: (1 - w.y) / 2 * innerHeight }; }; const c = b.getCenter(new THREE.Vector3()); return { l: p(new THREE.Vector3(b.min.x, c.y, c.z)), r: p(new THREE.Vector3(b.max.x, c.y, c.z)), c: p(c), size: b.getSize(new THREE.Vector3()).toArray() }; },
  stage: async () => { staged = { ver: -1, path: '' }; return stageFile(); },
  info: () => { const kinds = {}; let meshes = 0; holo.traverse((o) => { if (o.isMesh) { meshes++; for (const m of [].concat(o.material)) { const k = m.isShaderMaterial ? (m.uniforms.clipOn ? 'shader+clip' : 'shader') : m.type; kinds[k] = (kinds[k] || 0) + 1; } } }); return { meshes, kinds, box: clip.box && [clip.box.min.toArray(), clip.box.max.toArray()], items: items.map((i) => i.kind) }; },
  cut: (on, axis = 1, t = 0, flip = false) => { clip.axis = axis; clip.flip = flip; $('cutr').value = String(Math.round(t * 100)); setCut(on); clip.t = t; updateClip(); return { on: clip.on, d: uniforms.clipD.value, n: uniforms.clipN.value.toArray() }; },
  clipState: () => ({ n: uniforms.clipN.value.toArray(), d: uniforms.clipD.value, on: uniforms.clipOn.value }),
  save: (fmt) => saveModel(fmt),
  printCheck: () => runPrintCheck(),
  notes: () => notes.map((n) => ({ ...n })),
  annotateAt: (x, y) => { if (!annotating) setAnnotate(true); return annotateClick({ clientX: x, clientY: y }); },
  noteBoxes: () => [...notesEl.children].map((el) => { const r = el.getBoundingClientRect(); return { id: el.dataset.id, x: Math.round(r.left), y: Math.round(r.top), hidden: el.classList.contains('back') }; }),
  yaw: (deg) => { orient.setFromAxisAngle(axisY, (deg * Math.PI) / 180); holo.quaternion.copy(orient); return true; },
  stlBytes: () => { const { tris } = collectTriangles(); return tris.length ? { bytes: toStl(zUp(tris), 'x').length, tris: tris.length / 9 } : 0; },
  mode: () => (exploded || editing ? 'parts' : items.length > 1 ? 'items' : 'whole'),
  itemAt: (i) => (itemWraps[i] ? toScreen(itemWraps[i].getWorldPosition(new THREE.Vector3())) : null),
  sel: () => selItem,
  front: () => { orient.identity(); holo.quaternion.identity(); return true; },
  cad: () => ({ editing, sel: cadSel, spec: editing ? cadSpec : (items.find((i) => i.kind === 'cad')?.cad || null), canUndo: hist?.canUndo }),
  shapeAt: (id) => { const sh = cadSpec?.shapes.find((x) => x.id === id); if (!sh) return null; const p = toScreen(view().group.localToWorld(new THREE.Vector3(...sh.pos))); return p; },
  handleAt: (axis, sign) => { const h = view()?.handles.find((x) => x.userData.handle.axis === axis && x.userData.handle.sign === sign); if (!h) return null; return toScreen(h.getWorldPosition(new THREE.Vector3())); },
  carried: () => (carried ? { at: carried.at, outside: carried.outside, over: carried.over, part: parts.indexOf(carried.part) } : null)
};
let fps = 0; let fpsN = 0; let fpsT = performance.now();
const _frame = frame;
requestAnimationFrame(function counted(now) { fpsN++; if (now - fpsT > 1000) { fps = fpsN; fpsN = 0; fpsT = now; } requestAnimationFrame(counted); });
requestAnimationFrame(_frame);
