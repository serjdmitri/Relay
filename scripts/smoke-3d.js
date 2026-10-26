// Runs the real 3D viewer in real Electron: one real model from Wikimedia Commons, one built from shapes, and saves what each window
// drew. Run: node_modules/.bin/electron scripts/smoke-3d.js [outDir] [query]  (or with any Electron runtime)
const { app, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');
const { ModelPanel } = require('../src/main/models/panel');
const { findStl, downloadStl } = require('../src/main/models/lookup');
const { normalizeParts } = require('../src/main/models/shapes');

const out = process.argv[2] || path.join(__dirname, '../shots');
const query = process.argv[3] || 'skull';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
process.on('uncaughtException', (e) => console.log('UNCAUGHT', e.message));
ipcMain.handle('model:close', () => {});
ipcMain.handle('model:hover', () => {});

app.whenReady().then(async () => {
  const panel = new ModelPanel({ preload: path.join(__dirname, '../src/main/preload.js') });
  const result = {};
  try {
    const m = await findStl(query);
    result.found = m ? `${m.title} (${Math.round(m.size / 1024)} KB)` : null;
    if (m) {
      const t = Date.now();
      const bytes = await downloadStl(m.url);
      result.downloadMs = Date.now() - t;
      await panel.show({ kind: 'stl', title: query, subtitle: m.title, credit: m.credit, bytes });
      await wait(3500);
      fs.writeFileSync(path.join(out, 'real-3d-stl.png'), (await panel.win.webContents.capturePage()).toPNG());
      for (const n of [1, 2]) { await panel.win.webContents.executeJavaScript("document.getElementById('up').click()"); await wait(1200); fs.writeFileSync(path.join(out, `real-3d-stl-up${n}.png`), (await panel.win.webContents.capturePage()).toPNG()); }
      result.stlPage = await panel.win.webContents.executeJavaScript("JSON.stringify({ cls: document.body.className, load: document.getElementById('load').textContent, w: document.getElementById('cv').width })");
    }
    const parts = normalizeParts([
      { shape: 'sphere', size: 0.9, color: '#ffcc33', glow: true, label: 'Sun' },
      { shape: 'sphere', size: 0.12, color: '#b0b0b0', orbit: { radius: 1.5, speed: 60 }, label: 'Mercury' },
      { shape: 'sphere', size: 0.22, color: '#e8c070', orbit: { radius: 2.1, speed: 40 }, label: 'Venus' },
      { shape: 'sphere', size: 0.24, color: '#3b8ee8', orbit: { radius: 2.8, speed: 30 }, label: 'Earth' },
      { shape: 'sphere', size: 0.17, color: '#d9532f', orbit: { radius: 3.5, speed: 24 }, label: 'Mars' },
      { shape: 'sphere', size: 0.5, color: '#d8b48a', orbit: { radius: 4.6, speed: 14 }, label: 'Jupiter' },
      { shape: 'ring', size: [3.5, 3.52], color: '#5a6a78', opacity: 0.4, rotation: [90, 0, 0] }
    ]);
    await panel.show({ kind: 'shapes', title: 'The inner solar system', subtitle: 'Built from simple shapes', credit: 'Built by Relay from simple shapes', parts });
    await wait(3000);
    fs.writeFileSync(path.join(out, 'real-3d-shapes.png'), (await panel.win.webContents.capturePage()).toPNG());
    result.shapesPage = await panel.win.webContents.executeJavaScript("JSON.stringify({ cls: document.body.className, load: document.getElementById('load').textContent })");
  } catch (e) { result.error = e.stack; }
  console.log('RESULT', JSON.stringify(result));
  app.exit(0);
});
