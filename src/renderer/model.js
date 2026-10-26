/* global relay */
// The 3D viewer page. A real model (an STL file, sent by Relay as bytes) or a model built from shapes. Text goes in with textContent.
import * as THREE from './vendor/three/three.module.min.js';
import { OrbitControls } from './vendor/three/OrbitControls.js';
import { STLLoader } from './vendor/three/STLLoader.js';

const $ = (id) => document.getElementById(id);
const cv = $('cv');
const renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
renderer.setClearColor(0x000000, 0);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(40, 1, 0.01, 1000);
scene.add(new THREE.HemisphereLight(0xcfe9ff, 0x101820, 1.1));
const key = new THREE.DirectionalLight(0xffffff, 2.2); key.position.set(3, 5, 4); scene.add(key);
const rim = new THREE.DirectionalLight(0x4cc2ff, 1.4); rim.position.set(-4, 2, -3); scene.add(rim);
const controls = new OrbitControls(camera, cv);
controls.enableDamping = true;
controls.autoRotate = true;
controls.autoRotateSpeed = 1.6;
let content = null; // everything of the current model
let animated = []; // parts that spin or orbit
let labels = []; // name tags: sized after the model is scaled to fit, so they read the same for any model
let home = null; // the camera's starting place, for the double-click reset
let raf = 0;
let hovering = false;

function resize() {
  const w = cv.clientWidth, h = cv.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);

function clear() {
  if (content) {
    scene.remove(content);
    content.traverse((o) => { o.geometry?.dispose?.(); (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m?.map?.dispose?.() || m?.dispose?.()); });
  }
  content = new THREE.Group();
  scene.add(content);
  animated = [];
  labels = [];
}

// Scales and centres what is in the group so it fills the view, then puts the camera back.
function fit() {
  const box = new THREE.Box3().setFromObject(content);
  const size = box.getSize(new THREE.Vector3());
  const centre = box.getCenter(new THREE.Vector3());
  const s = 2.2 / Math.max(size.x, size.y, size.z || 1, 1e-6);
  content.scale.setScalar(s);
  content.position.copy(centre).multiplyScalar(-s);
  camera.position.set(0, 0.6, 4.2);
  controls.target.set(0, 0, 0);
  controls.update();
  for (const l of labels) { l.sprite.scale.set(0.8 / s, 0.2 / s, 1); l.sprite.position.y = l.radius + 0.2 / s; }
  home = { p: camera.position.clone(), t: controls.target.clone() };
}

function label(text) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const g = c.getContext('2d');
  g.font = '600 30px -apple-system, system-ui, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineJoin = 'round'; g.lineWidth = 7; g.strokeStyle = 'rgba(0,0,0,.85)'; g.strokeText(text, 128, 33); // an outline, not a box, so it reads on anything
  g.fillStyle = '#e6fbff'; g.fillText(text, 128, 33);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false, transparent: true }));
  sp.scale.set(0.9, 0.225, 1);
  sp.renderOrder = 10;
  return sp;
}

const GEOM = {
  sphere: (s) => new THREE.SphereGeometry(s[0], 48, 32),
  box: (s) => new THREE.BoxGeometry(s[0], s[1], s[2]),
  cylinder: (s) => new THREE.CylinderGeometry(s[0], s[1], s[2], 48),
  cone: (s) => new THREE.ConeGeometry(s[0], s[1], 48),
  torus: (s) => new THREE.TorusGeometry(s[0], s[1], 24, 64),
  capsule: (s) => new THREE.CapsuleGeometry(s[0], s[1], 8, 24),
  ring: (s) => new THREE.RingGeometry(Math.min(s[0], s[1]), Math.max(s[0], s[1]), 96)
};

function buildShapes(parts) {
  clear();
  stlMesh = null;
  for (const p of parts) {
    const mat = new THREE.MeshStandardMaterial({ color: p.color, roughness: 0.45, metalness: 0.1, transparent: p.opacity < 1, opacity: p.opacity, side: p.shape === 'ring' ? THREE.DoubleSide : THREE.FrontSide, ...(p.glow ? { emissive: new THREE.Color(p.color), emissiveIntensity: 0.9 } : {}) });
    const mesh = new THREE.Mesh(GEOM[p.shape](p.size), mat);
    const rad = (d) => (d * Math.PI) / 180;
    mesh.rotation.set(rad(p.rotation[0]), rad(p.rotation[1]), rad(p.rotation[2]));
    const holder = new THREE.Group();
    holder.add(mesh);
    if (p.label) { const l = label(p.label); holder.add(l); labels.push({ sprite: l, radius: p.shape === 'sphere' ? p.size[0] : Math.max(...p.size) / 2 }); }
    if (p.orbit) {
      const pivot = new THREE.Group();
      pivot.position.set(...p.orbit.center);
      pivot.rotation.x = rad(p.orbit.tilt);
      holder.position.set(p.orbit.radius, 0, 0);
      pivot.add(holder);
      content.add(pivot);
      animated.push({ o: pivot, spin: [0, p.orbit.speed, 0] });
      if (p.spin) animated.push({ o: mesh, spin: p.spin });
    } else {
      holder.position.set(...p.position);
      content.add(holder);
      if (p.spin) animated.push({ o: mesh, spin: p.spin });
    }
  }
  fit();
}

// STL files do not say which way is up: Z is the usual guess, and the button cycles Z, Y, then X for the ones that lie on their side.
let stlMesh = null;
let orient = 0;
const ORIENTS = [[-Math.PI / 2, 0, 0], [0, 0, 0], [0, 0, Math.PI / 2]];
function applyOrient() {
  stlMesh.rotation.set(...ORIENTS[orient]);
  content.scale.setScalar(1);
  content.position.set(0, 0, 0);
  fit();
}
$('up').onclick = () => { if (stlMesh) { orient = (orient + 1) % 3; applyOrient(); } };

function buildStl(bytes) {
  clear();
  const geo = new STLLoader().parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  if (!geo.attributes.normal) geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0xd7e3ea, roughness: 0.5, metalness: 0.15 }));
  content.add(mesh);
  stlMesh = mesh;
  orient = 0;
  applyOrient();
}

function frame(now) {
  const dt = 1 / 60;
  for (const a of animated) { a.o.rotation.x += (a.spin[0] * Math.PI / 180) * dt; a.o.rotation.y += (a.spin[1] * Math.PI / 180) * dt; a.o.rotation.z += (a.spin[2] * Math.PI / 180) * dt; }
  controls.update();
  renderer.render(scene, camera);
  raf = requestAnimationFrame(frame);
}
controls.addEventListener('start', () => { controls.autoRotate = false; });
cv.addEventListener('dblclick', () => { if (home) { camera.position.copy(home.p); controls.target.copy(home.t); controls.autoRotate = true; } });
$('x').onclick = () => relay.modelClose();
$('win').addEventListener('mouseenter', () => relay.modelHover(true));
$('win').addEventListener('mouseleave', () => relay.modelHover(false));

relay.onModel((m, d) => {
  if (m === 'show') {
    document.body.classList.remove('hide');
    $('title').textContent = d.title || '';
    $('sub').textContent = d.subtitle || '';
    $('credit').textContent = d.credit || '';
    $('load').textContent = '';
    $('up').style.display = d.kind === 'stl' ? 'block' : 'none';
    try {
      if (d.kind === 'stl') buildStl(d.bytes); else buildShapes(d.parts || []);
    } catch (e) { $('load').textContent = 'Could not draw that model.'; }
    controls.autoRotate = true;
    resize();
    document.body.classList.add('show');
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(frame);
  } else {
    document.body.classList.add('hide');
    setTimeout(() => { document.body.classList.remove('show'); cancelAnimationFrame(raf); }, 340);
  }
});
