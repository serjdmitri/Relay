/* global relay */
// One hologram. Drag the model to turn it, drag the glowing base to move it across the screen, scroll to resize, double-click to reset.
// Drop it on another hologram to combine them. Everything is drawn as light on a fully transparent window.
import * as THREE from './vendor/three/three.module.min.js';
import { STLLoader } from './vendor/three/STLLoader.js';
import { GLTFLoader } from './vendor/three/GLTFLoader.js';
import { GLTFExporter } from './vendor/three/GLTFExporter.js';
import { splitTriangles, explodeOffsets, placeItems } from './holo-parts.js';

const $ = (id) => document.getElementById(id);
const cv = $('cv');
const renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: true, alpha: true, premultipliedAlpha: true });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
renderer.setClearColor(0x000000, 0);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
camera.position.set(0, 0.35, 6.4);
camera.lookAt(0, -0.1, 0);
scene.add(new THREE.HemisphereLight(0xcfe9ff, 0x101820, 1.0));
const key = new THREE.DirectionalLight(0xffffff, 2.0); key.position.set(3, 5, 4); scene.add(key);

const CYAN = new THREE.Color(0x00d4ff);
const uniforms = { time: { value: 0 }, reveal: { value: -2 } };
let solid = false;
let items = [];
let holo = new THREE.Group(); // everything that turns
scene.add(holo);
let userScale = 1;
let spin = 0;
let reveal0 = 0;

// ---------- the hologram material: fresnel glow, scanlines, a sweep that builds it from the bottom up ----------
// tint: a colour; map: a texture (a real model keeps its own colours, with the glow and scanlines over them); body: how solid it looks.
function holoMaterial(tint, map, body = 0) {
  return new THREE.ShaderMaterial({
    uniforms: { ...uniforms, tint: { value: new THREE.Color(tint || 0x00d4ff).lerp(CYAN, map ? 0.15 : 0.55) }, map: { value: map || null }, hasMap: { value: map ? 1 : 0 }, body: { value: body }, boost: { value: 0 } },
    // a real-looking model (body 1) is drawn solid with the hologram effects over it; the light-only kind is see-through and additive
    transparent: body < 1, depthWrite: body >= 1, blending: body >= 1 ? THREE.NormalBlending : THREE.AdditiveBlending, side: THREE.DoubleSide,
    vertexShader: 'varying vec3 vN; varying vec3 vV; varying float vY; varying vec2 vUv; void main() { vUv = uv; vec4 wp = modelMatrix * vec4(position, 1.0); vY = wp.y; vN = normalize(normalMatrix * normal); vec4 mv = viewMatrix * wp; vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }',
    fragmentShader: 'uniform float time; uniform float reveal; uniform vec3 tint; uniform sampler2D map; uniform float hasMap; uniform float body; uniform float boost; varying vec3 vN; varying vec3 vV; varying float vY; varying vec2 vUv; void main() { if (vY > reveal) discard; float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.0); float scan = 0.72 + 0.28 * sin(vY * 90.0 - time * 3.0); float edge = smoothstep(reveal - 0.18, reveal, vY); vec3 base = tint; if (hasMap > 0.5) { base = texture2D(map, vUv).rgb * 1.25; } if (body >= 1.0) { float flick1 = 0.97 + 0.03 * sin(time * 37.0); vec3 lit = base * (0.78 + 0.22 * scan) * (0.85 + 0.25 * (1.0 - f)); lit += vec3(0.0, 0.7, 1.0) * f * 0.55 + vec3(edge) + vec3(0.0, 0.35, 0.5) * boost; gl_FragColor = vec4(lit * flick1, 1.0); return; }  float a = (0.10 + body + f * 0.9) * scan + edge * 0.9 + boost * 0.5; a = min(a, 1.0); float flick = 0.95 + 0.05 * sin(time * 37.0); gl_FragColor = vec4(base * (0.55 + f * 0.8) + vec3(0.0, 0.25, 0.35) * f + vec3(edge) + vec3(0.0, 0.4, 0.6) * boost, a * flick); }'
  });
}
function solidMaterial(color) { return new THREE.MeshStandardMaterial({ color: color || 0xd7e3ea, roughness: 0.5, metalness: 0.15 }); }

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
  Object.assign(wrap.userData, ud, { size: { w: size.x * s, h: size.y * s, d: size.z * s }, width: Math.max(size.x, size.z) * s, height: size.y * s });
  return wrap;
}

let building = 0;
let itemWraps = [];
const intros = []; // models flying in to join
async function rebuild() {
  const mine = ++building;
  animated.length = 0; // the parts that spin and the name tags belong to what is built next
  labels.length = 0;
  const wraps = await Promise.all(items.map(buildItem));
  if (mine !== building) return; // a newer one was asked for while this loaded
  scene.remove(holo);
  holo.traverse((o) => { o.geometry?.dispose?.(); (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m?.map?.dispose?.() || m?.dispose?.()); });
  holo = new THREE.Group();
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
  // The whole group turns about its middle, so it has to fit while turning: its reach from the middle, sideways and front to back,
  // must stay inside the view, and it must not be taller than the stand allows. It then stands on the base.
  const box = new THREE.Box3().setFromObject(holo);
  const size = box.getSize(new THREE.Vector3());
  const reach = Math.hypot(Math.max(Math.abs(box.min.x), Math.abs(box.max.x)), Math.max(Math.abs(box.min.z), Math.abs(box.max.z)));
  const k = Math.min(1, 1.45 / Math.max(reach, 1e-6), 2.2 / Math.max(size.y, 1e-6));
  const pivot = new THREE.Group();
  holo.position.y = -box.min.y;
  pivot.add(holo);
  pivot.scale.setScalar(k);
  pivot.position.y = -1.05;
  pivot.userData.height = size.y * k;
  holo = pivot;
  scene.add(holo);
  holo.rotation.y = spin;
  reveal0 = performance.now();
  $('upright').hidden = !items.some((i) => i.kind === 'stl');
}

// ---------- the base: the projector the hologram stands on ----------
const baseGroup = new THREE.Group();
baseGroup.position.y = -1.08;
function ringLine(r, op) { const g = new THREE.RingGeometry(r, r + 0.012, 128); const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0x38d8ff, transparent: true, opacity: op, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })); m.rotation.x = -Math.PI / 2; return m; }
baseGroup.add(ringLine(1.45, 0.9), ringLine(1.25, 0.45), ringLine(0.85, 0.25));
const glowTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d'); const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64); gr.addColorStop(0, 'rgba(0,212,255,.55)'); gr.addColorStop(1, 'rgba(0,212,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 128, 128); return new THREE.CanvasTexture(c); })();
const glowDisc = new THREE.Mesh(new THREE.CircleGeometry(1.55, 64), new THREE.MeshBasicMaterial({ map: glowTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
glowDisc.rotation.x = -Math.PI / 2; glowDisc.position.y = -0.005;
baseGroup.add(glowDisc);
const baseHit = new THREE.Mesh(new THREE.CircleGeometry(1.6, 32), new THREE.MeshBasicMaterial({ visible: false }));
baseHit.rotation.x = -Math.PI / 2; baseHit.position.y = 0.01;
baseGroup.add(baseHit);
scene.add(baseGroup);

// ---------- pulling it apart ----------
const EXPLODE_MS = 700;
let exploded = false;
let explodeT = 0; // 0 together, 1 fully apart
let parts = []; // { obj, meshes, item, base, off, name }
let selected = null;
let hovered = null;

const ease = (t) => 1 - Math.pow(1 - t, 3);

// A solid model has nothing to pull apart along, so it is cut into regions; a model made of several bodies splits along them.
function splitMesh(mesh) {
  const geo = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry;
  const pos = geo.attributes.position.array;
  const res = splitTriangles(pos, { regions: 5 });
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
    const m2 = new THREE.Mesh(g2, mesh.material.clone());
    m2.position.copy(mesh.position); m2.rotation.copy(mesh.rotation); m2.scale.copy(mesh.scale);
    m2.userData = { ...mesh.userData, orig: mesh.userData.orig };
    return m2;
  });
  return { kind: res.kind, meshes };
}

let hintText = '';
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
        hintText = sp.kind === 'regions' ? 'one solid piece, cut into regions' : '';
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
  $('hint2').textContent = exploded ? `Click a piece, then drag it out${hintText ? ` · ${hintText}` : ''}` : '';
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

let extracting = false;
async function extractSelected() {
  if (!selected || extracting) return;
  extracting = true;
  const part = selected;
  try {
    const g = itemWraps[part.item].userData.g;
    const same = parts.filter((p) => p.item === part.item);
    const rest = same.filter((p) => p !== part);
    const [partBytes, restBytes] = await Promise.all([exportGlb([part], g), rest.length ? exportGlb(rest, g) : null]);
    relay.holoExtract({ item: part.item, name: part.name, part: new Uint8Array(partBytes), rest: restBytes ? new Uint8Array(restBytes) : null });
  } catch { $('err').textContent = 'Could not take that piece out.'; }
  extracting = false;
}

// ---------- pointer: turn the model, move the window by its base, scroll to resize, pick pieces ----------
const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
let over = false;
let dragging = null; // 'rotate' | 'move' | 'arm' (a selected piece that will come out when dragged)
let last = null;
let downAt = null;

function setRay(e) {
  const r = cv.getBoundingClientRect();
  ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -(((e.clientY - r.top) / r.height) * 2 - 1));
  ray.setFromCamera(ndc, camera);
}
function pickPart(e) {
  if (!exploded) return null;
  setRay(e);
  const hit = ray.intersectObjects(parts.flatMap((p) => p.meshes), false)[0];
  return hit ? parts.find((p) => p.meshes.includes(hit.object)) : null;
}
function pick(e) {
  setRay(e);
  if (ray.intersectObject(baseHit).length) return 'base';
  const meshes = [];
  holo.traverse((o) => { if (o.isMesh) meshes.push(o); });
  if (ray.intersectObjects(meshes, false).length) return 'model';
  const ui = document.elementFromPoint(e.clientX, e.clientY);
  if (ui && ui.closest('.btn')) return 'ui';
  return null;
}
function setOver(on) { if (on !== over) { over = on; relay.holoHit(on); } }
addEventListener('mousemove', (e) => {
  const near = e.clientY > innerHeight * 0.45 || !!pick(e);
  document.body.classList.toggle('near', near || !!dragging);
  if (dragging) return;
  const p = pick(e);
  setOver(!!p);
  const part = p === 'model' ? pickPart(e) : null;
  setHover(part);
  cv.style.cursor = p === 'base' ? 'move' : part ? 'pointer' : p === 'model' ? 'grab' : 'default';
});
addEventListener('mouseleave', () => { if (!dragging) { document.body.classList.remove('near'); setHover(null); } });
addEventListener('pointerdown', (e) => {
  const p = pick(e);
  if (p === 'base') { dragging = 'move'; relay.holoDrag('start'); }
  else if (p === 'model') {
    const part = pickPart(e);
    if (part && part === selected) { dragging = 'arm'; downAt = { x: e.clientX, y: e.clientY }; }
    else { if (part) select(part); else if (selected) select(null); dragging = 'rotate'; last = e.clientX; cv.style.cursor = 'grabbing'; }
  }
  if (dragging) { e.preventDefault(); document.body.setPointerCapture?.(e.pointerId); spinPause = true; }
});
addEventListener('pointermove', (e) => {
  if (dragging === 'rotate') { spin += (e.clientX - last) * 0.012; last = e.clientX; holo.rotation.y = spin; }
  else if (dragging === 'arm' && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 12) {
    dragging = 'move'; // it comes out: the new hologram follows the pointer until it is let go
    extractSelected();
  }
});
function endDrag() { if (!dragging) return; if (dragging === 'move') relay.holoDrag('end'); dragging = null; spinPause = false; }
addEventListener('pointerup', endDrag);
addEventListener('pointercancel', endDrag);
addEventListener('blur', endDrag);
addEventListener('wheel', (e) => { e.preventDefault(); userScale = Math.min(3, Math.max(0.4, userScale * Math.exp(-e.deltaY * 0.0015))); applyScale(); relay.holoScale(userScale); }, { passive: false });
addEventListener('dblclick', () => { userScale = 1; spin = 0; applyScale(); relay.holoScale(1); });
let spinPause = false;
function applyScale() { camera.position.z = 6.4 / userScale; camera.lookAt(0, -0.1, 0); }

// ---------- controls ----------
$('close').onclick = () => relay.holoClose();
$('pin').onclick = () => { const on = !$('pin').classList.contains('on'); $('pin').classList.toggle('on', on); relay.holoPin(on); };
$('solid').onclick = () => { solid = !solid; $('solid').classList.toggle('on', solid); rebuild().catch(() => {}); relay.holoSolid(solid); };
$('explode').onclick = toggleExplode;
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
    if (m === 'init') { solid = !!d.solid; userScale = d.scale || 1; applyScale(); $('pin').classList.toggle('on', !!d.pinned); $('solid').classList.toggle('on', solid); }
    items = d.items;
    $('title').textContent = d.title || '';
    $('credit').textContent = items.map((i) => i.credit).filter(Boolean).join('  ·  ');
    $('err').textContent = '';
    setOptions(d.options);
    rebuild().catch(() => { $('err').textContent = 'Could not draw that model.'; });
  } else if (m === 'merge-hint') { document.body.classList.toggle('merging', !!d); $('merge').textContent = d === 'fit' ? 'Fitting…' : 'Release to combine'; }
  else if (m === 'pinned') $('pin').classList.toggle('on', !!d);
  else if (m === 'error') $('err').textContent = d;
});

function resize() { const w = cv.clientWidth, h = cv.clientHeight; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }
addEventListener('resize', resize);
resize();

let prev = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - prev) / 1000); prev = now;
  uniforms.time.value = now / 1000;
  const t = Math.min(1, (now - reveal0) / 1100);
  uniforms.reveal.value = -1.2 + (1 - Math.pow(1 - t, 3)) * 4.4; // the build sweep
  if (!spinPause) { spin += dt * 0.35; holo.rotation.y = spin; }
  holo.position.y = -1.05 + Math.sin(now / 900) * 0.025;
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
  for (const a of animated) { a.o.rotation.x += rad(a.spin[0]) * dt; a.o.rotation.y += rad(a.spin[1]) * dt; a.o.rotation.z += rad(a.spin[2]) * dt; }
  baseGroup.children[0].rotation.z += dt * 0.25;
  renderer.render(scene, camera);
  // A hook for the real-window tests: where each piece is on screen, and the state of the pull-apart. Nothing here changes anything.
window.__holoTest = {
  state: () => ({ exploded, explodeT, parts: parts.length, selected: selected ? parts.indexOf(selected) : -1, items: items.length }),
  where: (i) => { const p = parts[i]; if (!p) return null; const c = new THREE.Box3().setFromObject(p.obj).getCenter(new THREE.Vector3()).project(camera); const r = cv.getBoundingClientRect(); return { x: (c.x + 1) / 2 * r.width + r.left, y: (1 - c.y) / 2 * r.height + r.top }; }
};
requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
