/* global relay */
// One hologram. Drag the model to turn it, drag the glowing base to move it across the screen, scroll to resize, double-click to reset.
// Drop it on another hologram to combine them. Everything is drawn as light on a fully transparent window.
import * as THREE from './vendor/three/three.module.min.js';
import { STLLoader } from './vendor/three/STLLoader.js';

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
function holoMaterial(tint) {
  return new THREE.ShaderMaterial({
    uniforms: { ...uniforms, tint: { value: new THREE.Color(tint || 0x00d4ff).lerp(CYAN, 0.55) } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    vertexShader: 'varying vec3 vN; varying vec3 vV; varying float vY; void main() { vec4 wp = modelMatrix * vec4(position, 1.0); vY = wp.y; vN = normalize(normalMatrix * normal); vec4 mv = viewMatrix * wp; vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }',
    fragmentShader: 'uniform float time; uniform float reveal; uniform vec3 tint; varying vec3 vN; varying vec3 vV; varying float vY; void main() { if (vY > reveal) discard; float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.0); float scan = 0.72 + 0.28 * sin(vY * 90.0 - time * 3.0); float edge = smoothstep(reveal - 0.18, reveal, vY); float a = (0.10 + f * 0.9) * scan + edge * 0.9; float flick = 0.94 + 0.06 * sin(time * 37.0); gl_FragColor = vec4(tint * (0.55 + f) + vec3(edge), a * flick); }'
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
function buildItem(it) {
  const g = new THREE.Group();
  if (it.kind === 'stl') {
    const geo = new STLLoader().parse(it.bytes.buffer.slice(it.bytes.byteOffset, it.bytes.byteOffset + it.bytes.byteLength));
    if (!geo.attributes.normal) geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, makeMat(0xd7e3ea));
    mesh.rotation.set(...ORIENTS[upright]);
    mesh.userData.stl = true;
    g.add(mesh);
    if (!solid && geo.attributes.position.count < 240000) {
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo, 38), new THREE.LineBasicMaterial({ color: 0x59dcff, transparent: true, opacity: 0.32, blending: THREE.AdditiveBlending, depthWrite: false }));
      edges.rotation.copy(mesh.rotation);
      g.add(edges);
    }
  } else {
    for (const p of it.parts || []) {
      const mesh = new THREE.Mesh(GEOM[p.shape](p.size), p.glow && !solid ? holoMaterial(p.color) : makeMat(p.color));
      mesh.rotation.set(rad(p.rotation[0]), rad(p.rotation[1]), rad(p.rotation[2]));
      const holder = new THREE.Group();
      holder.add(mesh);
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
  wrap.userData.width = Math.max(size.x, size.z) * s; // it turns, so its front-to-back reach counts too
  wrap.userData.height = size.y * s;
  return wrap;
}

function layoutX(widths, gap = 0.3) {
  const total = widths.reduce((s, w) => s + w, 0) + gap * Math.max(0, widths.length - 1);
  let x = -total / 2;
  return widths.map((w) => { const c = x + w / 2; x += w + gap; return c; });
}

function rebuild() {
  scene.remove(holo);
  holo.traverse((o) => { o.geometry?.dispose?.(); (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m?.map?.dispose?.() || m?.dispose?.()); });
  holo = new THREE.Group();
  animated.length = 0;
  labels.length = 0;
  const wraps = items.map(buildItem);
  const xs = layoutX(wraps.map((w) => w.userData.width));
  wraps.forEach((w, i) => { w.position.x = xs[i]; holo.add(w); });
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

// ---------- pointer: turn the model, move the window by its base, scroll to resize ----------
const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
let over = false;
let dragging = null; // 'rotate' | 'move'
let last = null;

function pick(e) {
  const r = cv.getBoundingClientRect();
  ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -(((e.clientY - r.top) / r.height) * 2 - 1));
  ray.setFromCamera(ndc, camera);
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
  cv.style.cursor = p === 'base' ? 'move' : p === 'model' ? 'grab' : 'default';
});
addEventListener('mouseleave', () => { if (!dragging) { document.body.classList.remove('near'); } });
addEventListener('pointerdown', (e) => {
  const p = pick(e);
  if (p === 'base') { dragging = 'move'; relay.holoDrag('start'); }
  else if (p === 'model') { dragging = 'rotate'; last = e.clientX; cv.style.cursor = 'grabbing'; }
  if (dragging) { e.preventDefault(); document.body.setPointerCapture?.(e.pointerId); spinPause = true; }
});
addEventListener('pointermove', (e) => {
  if (dragging === 'rotate') { spin += (e.clientX - last) * 0.012; last = e.clientX; holo.rotation.y = spin; }
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
$('solid').onclick = () => { solid = !solid; $('solid').classList.toggle('on', solid); rebuild(); relay.holoSolid(solid); };
$('upright').onclick = () => { upright = (upright + 1) % 3; rebuild(); };
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
    try { rebuild(); } catch { $('err').textContent = 'Could not draw that model.'; }
  } else if (m === 'merge-hint') document.body.classList.toggle('merging', !!d);
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
  for (const a of animated) { a.o.rotation.x += rad(a.spin[0]) * dt; a.o.rotation.y += rad(a.spin[1]) * dt; a.o.rotation.z += rad(a.spin[2]) * dt; }
  baseGroup.children[0].rotation.z += dt * 0.25;
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
