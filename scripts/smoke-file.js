// The hologram as a file for dragging into an app: staged in the chosen type. (The system drag itself needs a real mouse drag and is not started here.) Run: <electron> scripts/smoke-file.js <outDir>
const { app } = require('electron');
const fs = require('fs');
const path = require('path');
const { HoloManager } = require('../src/main/holo/manager');
const holoWin = require('../src/main/holo/windows');
const { findStls, downloadStl } = require('../src/main/models/lookup');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
process.on('uncaughtException', (e) => console.log('UNCAUGHT', e.message));
app.whenReady().then(async () => {
  const out = process.argv[2] || path.join(__dirname, '../shots');
  const preload = path.join(__dirname, '../src/main/preload.js');
  const ui = { controls: 'menu', spin: true, spinDelay: 1 };
  const mgr = new HoloManager({ createWindow: ({ width, height }) => holoWin.createHoloWindow({ preload, width, height }), cursor: holoWin.cursor, getUi: () => ui, area: holoWin.area, displayFor: holoWin.displayFor, download: (u) => downloadStl(u), saved: () => [], save: () => {} });
  holoWin.registerHoloIpc(mgr);
  const result = {};
  try {
    const found = await findStls(process.env.QUERY || 'skull', { n: 3 });
    const opts = found.map((m) => ({ kind: 'stl', title: m.title, url: m.url, credit: m.credit }));
    const wa = holoWin.area();
    const id = await mgr.show({ title: 'Human skull', items: [{ kind: 'stl', title: found[0].title, credit: found[0].credit, url: found[0].url, bytes: await downloadStl(found[0].url) }], options: { list: opts, index: 0 }, x: Math.round(wa.x + wa.width * 0.5), y: Math.round(wa.y + wa.height * 0.4) });
    const h = mgr.get(id);
    await wait(3500);
    const js = (c) => h.win.webContents.executeJavaScript(c);
    const T = (c) => js(`JSON.stringify(window.__holoTest.${c})`).then(JSON.parse);
    const fsx = require('fs');
    result.menuHasDrag = await js("!!document.getElementById('dragout') && document.getElementById('dragout').draggable");
    // staged by itself shortly after the model is drawn (nothing asked for it)
    await wait(2500);
    result.auto = await js("0").then(() => null);
    for (const fmt of ['stl', '3mf', 'step']) {
      ui.dragFormat = fmt; mgr.refreshUi(); await wait(300);
      const p = await js('window.__holoTest.stage()');
      const st = p ? fsx.statSync(p) : null;
      const head16 = p ? fsx.readFileSync(p).subarray(0, 5).toString('latin1') : '';
      result[fmt] = { path: p && p.replace(process.env.HOME, '~'), bytes: st && st.size, head: head16 };
    }
  } catch (e) { result.error = e.stack; }
  console.log('RESULT', JSON.stringify(result));
  app.exit(0);
});
