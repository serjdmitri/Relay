// Checks the vendored CSG works in a real Electron page: a cube with a hole through it and a cone on top. Run: <electron> scripts/smoke-csg.js
const { app, BrowserWindow } = require('electron');
const path = require('path');
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true } });
  const html = `<script type="module">
    import * as THREE from '${path.join(__dirname, '../src/renderer/vendor/three/three.module.min.js')}';
    import { Brush, Evaluator, SUBTRACTION, ADDITION } from '${path.join(__dirname, '../src/renderer/vendor/three/three-bvh-csg.js')}';
    try {
      const box = new Brush(new THREE.BoxGeometry(40, 40, 40)); box.updateMatrixWorld();
      const hole = new Brush(new THREE.CylinderGeometry(8, 8, 60, 32)); hole.updateMatrixWorld();
      const cone = new Brush(new THREE.ConeGeometry(15, 25, 32)); cone.position.y = 32.5; cone.updateMatrixWorld();
      const ev = new Evaluator();
      let r = ev.evaluate(box, cone, ADDITION); r = ev.evaluate(r, hole, SUBTRACTION);
      window.__res = { tris: r.geometry.attributes.position.count / 3, hasNormal: !!r.geometry.attributes.normal, boxTris: 12 };
    } catch (e) { window.__res = { error: String(e.stack || e) }; }
  </script>`;
  const f = path.join(require('os').tmpdir(), 'relay-csg-smoke.html');
  require('fs').writeFileSync(f, html);
  await win.loadFile(f);
  await new Promise((r) => setTimeout(r, 1500));
  console.log('RESULT', JSON.stringify(await win.webContents.executeJavaScript('window.__res')));
  app.exit(0);
});
