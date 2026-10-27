// The holograms on your Mac, on your phone: pick one, turn it with a finger, pinch to zoom, save it as STL, 3MF or STEP.
import * as THREE from '/vendor/three.module.min.js';
import { GLTFLoader } from '/vendor/GLTFLoader.js';
import { toStl, to3mf, toStep, zUp } from '/holo-export.js';

const $ = (id) => document.getElementById(id);
const token = localStorage.getItem('relay-remote-token') || '';
const api = (path) => fetch(path, { headers: { authorization: `Bearer ${token}` } });
if (!token) location.href = '/';

const id = new URLSearchParams(location.search).get('id');

async function showList() {
  $('list').hidden = false;
  const r = await api('/api/holos');
  if (r.status === 401) { location.href = '/'; return; }
  const { holos } = await r.json();
  $('empty').hidden = holos.length > 0;
  $('tiles').replaceChildren(...holos.map((h) => {
    const li = document.createElement('li');
    const t = document.createElement('span'); t.textContent = h.title;
    const s = document.createElement('small'); s.textContent = h.designed ? 'designed · editable on the Mac' : (h.pinned ? 'kept' : '');
    li.append(t, s);
    li.onclick = () => { location.href = `/holo.html?id=${encodeURIComponent(h.id)}`; };
    return li;
  }));
}

async function showModel() {
  $('view').hidden = false;
  $('vmsg').textContent = 'Getting it from your Mac…';
  const r = await api(`/api/holos/${encodeURIComponent(id)}/model`);
  if (!r.ok) { $('vmsg').textContent = r.status === 404 ? 'That hologram is gone from your Mac.' : 'Could not get it.'; return; }
  const mm = r.headers.get('x-relay-mm') === '1';
  const title = decodeURIComponent(r.headers.get('x-relay-title') || 'hologram');
  $('vtitle').textContent = title;
  const buf = await r.arrayBuffer();
  const gltf = await new Promise((res, rej) => new GLTFLoader().parse(buf, '', res, rej));
  const model = gltf.scene;

  const cv = $('gl');
  const renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(2, devicePixelRatio || 1));
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 100);
  scene.add(new THREE.HemisphereLight(0xdff4ff, 0x35506a, 2.4));
  const key = new THREE.DirectionalLight(0xffffff, 2.2); key.position.set(3, 5, 4); scene.add(key);
  const fill = new THREE.DirectionalLight(0x9fd6e8, 1.2); fill.position.set(-4, -3, -4); scene.add(fill);
  model.traverse((o) => { if (o.isMesh && o.geometry && !o.geometry.attributes.normal) o.geometry.computeVertexNormals(); if (o.isMesh && o.material) { for (const m of [].concat(o.material)) { m.side = THREE.DoubleSide; if (!m.map && m.color && m.color.getHex() === 0xffffff) m.color.set(0x9fd6e8); } } });
  const box = new THREE.Box3().setFromObject(model);
  const c = box.getCenter(new THREE.Vector3());
  const radius = box.getSize(new THREE.Vector3()).length() / 2 || 1;
  const pivot = new THREE.Group();
  model.position.sub(c);
  pivot.add(model);
  pivot.scale.setScalar(1.2 / radius);
  scene.add(pivot);
  let zoom = 5;
  const fit = () => { const w = cv.clientWidth, h = cv.clientHeight; renderer.setSize(w, h, false); camera.aspect = w / h; camera.position.set(0, 0, zoom); camera.updateProjectionMatrix(); };
  addEventListener('resize', fit); fit();

  // one finger turns it, two fingers pinch to zoom; it turns by itself until touched
  const pts = new Map();
  let last = 0, pinch0 = 0, zoom0 = 5, touchedAt = -1e9;
  const qx = new THREE.Vector3(1, 0, 0), qy = new THREE.Vector3(0, 1, 0);
  cv.addEventListener('pointerdown', (e) => { cv.setPointerCapture(e.pointerId); pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); touchedAt = performance.now(); if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch0 = Math.hypot(a.x - b.x, a.y - b.y); zoom0 = zoom; } });
  cv.addEventListener('pointermove', (e) => {
    const p = pts.get(e.pointerId); if (!p) return;
    touchedAt = performance.now();
    if (pts.size === 1) {
      const q = new THREE.Quaternion().setFromAxisAngle(qy, (e.clientX - p.x) * 0.011).multiply(new THREE.Quaternion().setFromAxisAngle(qx, (e.clientY - p.y) * 0.011));
      pivot.quaternion.premultiply(q).normalize();
    }
    p.x = e.clientX; p.y = e.clientY;
    if (pts.size === 2) { const [a, b] = [...pts.values()]; zoom = Math.min(14, Math.max(2.2, zoom0 * (pinch0 / Math.max(10, Math.hypot(a.x - b.x, a.y - b.y))))); camera.position.z = zoom; }
  });
  const up = (e) => { pts.delete(e.pointerId); };
  cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
  const spin = new THREE.Quaternion();
  const loop = (now) => {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (now - touchedAt > 6000) { spin.setFromAxisAngle(qy, dt * 0.4); pivot.quaternion.premultiply(spin).normalize(); }
    renderer.render(scene, camera);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  $('vmsg').textContent = '';

  // the model as plain triangles, standing on the bed with z up (designed models keep their real millimetres; others are 100 mm across)
  const rawTriangles = () => {
    const out = [];
    const v = new THREE.Vector3();
    gltf.scene.updateWorldMatrix(true, true);
    const keep = gltf.scene.position.clone();
    const m0 = new THREE.Matrix4().copy(gltf.scene.matrixWorld);
    const inv = new THREE.Matrix4().copy(m0).invert();
    gltf.scene.traverse((o) => {
      if (!o.isMesh || !o.geometry) return;
      const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry;
      const a = g.attributes.position;
      const m = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld);
      for (let i = 0; i < a.count; i++) { v.fromBufferAttribute(a, i).applyMatrix4(m); out.push(v.x, v.y, v.z); }
    });
    gltf.scene.position.copy(keep);
    return new Float32Array(out);
  };

  document.querySelectorAll('#vbar button').forEach((b) => {
    b.onclick = async () => {
      try {
        const fmt = b.dataset.fmt;
        const z = zUp(rawTriangles(), { scaleTo: mm ? 0 : 100 });
        const bytes = fmt === '3mf' ? to3mf(z, title) : fmt === 'step' ? toStep(z, title) : toStl(z, title);
        const name = `${title.replace(/[^\w .-]/g, '').trim() || 'hologram'}.${fmt}`;
        const file = new File([bytes], name, { type: 'application/octet-stream' });
        if (navigator.canShare?.({ files: [file] })) { // the share sheet (Save to Files, a slicer app...); if it is refused, the file is downloaded instead
          try { await navigator.share({ files: [file], title }); $('vmsg').textContent = 'Shared.'; return; } catch (err) { if (err && err.name === 'AbortError') return; }
        }
        const a = document.createElement('a');
        a.href = URL.createObjectURL(file); a.download = name; document.body.append(a); a.click(); a.remove();
        $('vmsg').textContent = `Saved ${name}: look in Downloads (Files app).`;
      } catch (e) { console.error(e); $('vmsg').textContent = /too detailed/.test(e.message) ? e.message : 'Could not make that file.'; }
    };
  });
}

(id ? showModel() : showList()).catch(() => { $('vmsg') && ($('vmsg').textContent = 'Could not reach your Mac.'); });
