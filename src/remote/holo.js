// The holograms on your Mac, on your phone: pick one, turn it with a finger, pinch to zoom, save it as STL, 3MF or STEP.
import * as THREE from '/vendor/three.module.min.js';
import { GLTFLoader } from '/vendor/GLTFLoader.js';
import { toStl, to3mf, toStep, zUp } from '/holo-export.js';
import * as C from '/holo-cad-spec.js';

const $ = (id) => document.getElementById(id);
const token = localStorage.getItem('relay-remote-token') || '';
const api = (path) => fetch(path, { headers: { authorization: `Bearer ${token}` } });
const post = (path, body) => fetch(path, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'x-relay-remote': '1' }, body: JSON.stringify(body) });
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
  const enc = encodeURIComponent(id);
  const fetchModel = async () => {
    const r = await api(`/api/holos/${enc}/model`);
    if (!r.ok) throw Object.assign(new Error('model'), { status: r.status });
    return { mm: r.headers.get('x-relay-mm') === '1', title: decodeURIComponent(r.headers.get('x-relay-title') || 'hologram'), buf: await r.arrayBuffer() };
  };
  let m0;
  try { m0 = await fetchModel(); } catch (e) { $('vmsg').textContent = e.status === 404 ? 'That hologram is gone from your Mac.' : 'Could not get it.'; return; }
  let { mm, title } = m0;
  $('vtitle').textContent = title;

  const cv = $('gl');
  const renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: true, alpha: true });
  renderer.localClippingEnabled = true; // the cut bar
  renderer.setPixelRatio(Math.min(2, devicePixelRatio || 1));
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 100);
  scene.add(new THREE.HemisphereLight(0xdff4ff, 0x35506a, 2.4));
  const key = new THREE.DirectionalLight(0xffffff, 2.2); key.position.set(3, 5, 4); scene.add(key);
  const fill = new THREE.DirectionalLight(0x9fd6e8, 1.2); fill.position.set(-4, -3, -4); scene.add(fill);

  // the cut bar: everything on one side of a plane is cut away (the plane moves with the model when you turn it)
  const clip = { on: false, axis: 1, t: 1, flip: false };
  const clipPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 1e6);
  const clipPlanes = [clipPlane];
  const sheet = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: 0x25c8ff, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false }));
  sheet.visible = false; scene.add(sheet);

  const pivot = new THREE.Group();
  scene.add(pivot);
  let gltf = null, model = null, localBox = new THREE.Box3(), unit = 1;
  // Puts a model in the pivot (the old one goes); the turn it had is kept, so a change made from here does not spin it back.
  const place = async (buf) => {
    const g = await new Promise((res, rej) => new GLTFLoader().parse(buf, '', res, rej));
    const mdl = g.scene;
    mdl.traverse((o) => { if (o.isMesh && o.geometry && !o.geometry.attributes.normal) o.geometry.computeVertexNormals(); if (o.isMesh && o.material) { for (const m of [].concat(o.material)) { m.side = THREE.DoubleSide; m.clippingPlanes = clipPlanes; if (!m.map && m.color && m.color.getHex() === 0xffffff) m.color.set(0x9fd6e8); } } });
    const box = new THREE.Box3().setFromObject(mdl);
    const c = box.getCenter(new THREE.Vector3());
    const radius = box.getSize(new THREE.Vector3()).length() / 2 || 1;
    mdl.position.sub(c);
    if (model) { pivot.remove(model); model.traverse((o) => o.geometry?.dispose?.()); }
    pivot.add(mdl);
    pivot.scale.setScalar(1.2 / radius);
    unit = 1.2 / radius;
    gltf = g; model = mdl;
    localBox = new THREE.Box3().setFromObject(mdl); // in the pivot's own frame (it is not turned or scaled yet in its own units)
  };
  await place(m0.buf);
  let zoom = 5;
  const fit = () => { const w = cv.clientWidth, h = cv.clientHeight; renderer.setSize(w, h, false); camera.aspect = w / h; camera.position.set(0, 0, zoom); camera.updateProjectionMatrix(); };
  addEventListener('resize', fit); fit();

  const AX = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)];
  const tn = new THREE.Vector3(), tp = new THREE.Vector3();
  const updateClip = () => {
    if (!clip.on) { clipPlane.set(tn.set(0, -1, 0), 1e6); sheet.visible = false; return; }
    // the screen's planes: X left to right, Y up and down, Z front to back, whatever way the model is turned
    pivot.updateMatrixWorld(true);
    const wb = new THREE.Box3().setFromObject(pivot);
    if (wb.isEmpty()) return;
    const sign = clip.flip ? -1 : 1;
    const half = (wb.max.getComponent(clip.axis) - wb.min.getComponent(clip.axis)) / 2;
    tp.copy(wb.getCenter(new THREE.Vector3())).addScaledVector(AX[clip.axis], sign * clip.t * half * 1.02);
    const pw = tp.clone();
    tn.copy(AX[clip.axis]).multiplyScalar(sign);
    clipPlane.set(tn.clone().negate(), tn.dot(pw));
    const sz = wb.getSize(new THREE.Vector3()).length() * 0.62;
    sheet.visible = true; sheet.position.copy(pw); sheet.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), tn); sheet.scale.set(sz, sz, 1);
  };

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
    if (now - touchedAt > 6000 && !editingNow() && !clip.on) { spin.setFromAxisAngle(qy, dt * 0.4); pivot.quaternion.premultiply(spin).normalize(); }
    updateClip();
    renderer.render(scene, camera);
    requestAnimationFrame(loop);
  };
  let panelOpen = false;
  const editingNow = () => panelOpen; // while you edit, it holds still
  requestAnimationFrame(loop);
  $('vmsg').textContent = '';

  // ---- cut ----
  const setPanel = (which) => {
    $('pcut').hidden = which !== 'cut';
    $('pedit').hidden = which !== 'edit';
    $('tcut').classList.toggle('on', which === 'cut');
    $('tedit').classList.toggle('on', which === 'edit');
    clip.on = which === 'cut';
    panelOpen = which === 'edit';
    setTimeout(fit, 0);
  };
  $('tcut').onclick = () => setPanel($('pcut').hidden ? 'cut' : null);
  $('tedit').onclick = () => { const open = $('pedit').hidden; setPanel(open ? 'edit' : null); if (open) openEdit(); };
  $('cutr').addEventListener('input', () => { clip.t = Number($('cutr').value) / 100; touchedAt = performance.now(); });
  $('cutflip').onclick = () => { clip.flip = !clip.flip; $('cutflip').classList.toggle('on', clip.flip); };
  document.querySelectorAll('#cutax button').forEach((b) => { b.onclick = () => { clip.axis = Number(b.dataset.ax); document.querySelectorAll('#cutax button').forEach((x) => x.classList.toggle('on', x === b)); }; });

  // ---- edit: tell Relay, or change the shapes of a designed model ----
  let spec = null, hist = null, sel = null, saveT = 0, busy = false;
  const reload = async () => {
    if (busy) return; busy = true;
    try { const m = await fetchModel(); mm = m.mm; await place(m.buf); } catch { $('vmsg').textContent = 'Could not refresh it.'; }
    busy = false;
  };
  const send = () => { clearTimeout(saveT); saveT = setTimeout(async () => { const r = await post(`/api/holos/${enc}/cad`, { cad: spec }); if (!r.ok) { $('vmsg').textContent = 'Could not change that.'; return; } $('vmsg').textContent = ''; await reload(); }, 350); };
  const commit = (next) => { spec = next; hist.push(next); if (sel && !spec.shapes.some((s) => s.id === sel)) sel = spec.shapes[0]?.id || null; draw(); send(); };
  const num = (v) => Math.round(v * 100) / 100;
  const draw = () => {
    const cur = spec.shapes.find((s) => s.id === sel);
    $('chips').replaceChildren(...spec.shapes.map((s) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = `${s.hole ? '◌ ' : ''}${s.name}`; b.classList.toggle('on', s.id === sel); b.onclick = () => { sel = s.id; draw(); }; return b; }));
    const fields = [['size.0', 'W'], ['size.1', 'H'], ['size.2', 'D'], ['pos.0', 'X'], ['pos.1', 'Y'], ['pos.2', 'Z']];
    $('fields').replaceChildren(...(cur ? fields.map(([f, l]) => {
      const lab = document.createElement('label'); lab.textContent = `${l} mm`;
      const inp = document.createElement('input'); inp.type = 'number'; inp.inputMode = 'decimal'; inp.step = 'any';
      const [k, i] = f.split('.'); inp.value = String(num(cur[k][+i]));
      inp.onchange = () => { const v = parseFloat(inp.value); if (Number.isFinite(v)) commit(C.replaceShape(spec, C.setField(cur, f, v))); };
      lab.append(inp); return lab;
    }) : []));
    $('cHole').textContent = cur?.hole ? 'Make solid' : 'Make hole';
    $('cHole').classList.toggle('on', !!cur?.hole);
    $('cUndo').disabled = !hist.canUndo;
  };
  const openEdit = async () => {
    if (spec) return;
    const r = await api(`/api/holos/${enc}/cad`);
    if (!r.ok) return; // not a designed model: only "tell Relay" is offered
    spec = (await r.json()).cad; hist = new C.History(spec); sel = spec.shapes[0]?.id || null;
    $('cadbox').hidden = false;
    $('addrow').replaceChildren(...Object.entries(C.TYPES).map(([t, v]) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = `+ ${v.label}`; b.onclick = () => { const a = C.addShape(spec, t, false); if (a.id) { sel = a.id; commit(a.spec); } else $('vmsg').textContent = 'That is as many shapes as it can hold.'; }; return b; }));
    draw();
  };
  $('cHole').onclick = () => { if (sel) commit(C.toggleHole(spec, sel)); };
  $('cCopy').onclick = () => { if (sel) { const r = C.duplicateShape(spec, sel); if (r.id) { sel = r.id; commit(r.spec); } } };
  $('cDel').onclick = () => { if (sel) commit(C.removeShape(spec, sel)); };
  $('cUndo').onclick = () => { if (hist.canUndo) { spec = hist.undo(); if (!spec.shapes.some((s) => s.id === sel)) sel = spec.shapes[0]?.id || null; draw(); send(); } };
  $('tell').onsubmit = async (e) => {
    e.preventDefault();
    const text = $('tellin').value.trim();
    if (!text) return;
    $('tellin').value = '';
    $('vmsg').textContent = 'Telling Relay…';
    const r = await post(`/api/holos/${enc}/ask`, { text });
    if (!r.ok) { $('vmsg').textContent = r.status === 404 ? 'That hologram is gone from your Mac.' : 'Could not send that.'; return; }
    // Relay works on the Mac; when it is done the model here is fetched again
    for (let i = 0; i < 80; i++) {
      await new Promise((res) => setTimeout(res, 1500));
      const st = await api('/api/state').then((x) => x.json()).catch(() => null);
      if (st && ['idle', 'done'].includes(st.state)) break;
    }
    spec = null; $('cadbox').hidden = true;
    await reload();
    if (!$('pedit').hidden) openEdit();
    $('vmsg').textContent = '';
  };

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
  window.__phoneHolo = { clip, spec: () => spec, pivot, setPanel };
}

(id ? showModel() : showList()).catch(() => { $('vmsg') && ($('vmsg').textContent = 'Could not reach your Mac.'); });
