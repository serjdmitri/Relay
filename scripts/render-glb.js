// Draws each GLB as a hologram from a few sides and saves the pictures (to compare generators or photos). No camera, no network.
// Run: <electron> scripts/render-glb.js <outDir> <file.glb>...
const { app } = require('electron');
const fs = require('fs');
const path = require('path');
const { HoloManager } = require('../src/main/holo/manager');
const holoWin = require('../src/main/holo/windows');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
app.whenReady().then(async () => {
  const [out, ...files] = process.argv.slice(2);
  const preload = path.join(__dirname, '../src/main/preload.js');
  const mgr = new HoloManager({ createWindow: ({ width, height }) => holoWin.createHoloWindow({ preload, width, height }), cursor: holoWin.cursor, area: holoWin.area, displayFor: holoWin.displayFor, download: async () => Buffer.alloc(0), saved: () => [], save: () => {} });
  holoWin.registerHoloIpc(mgr);
  const info = [];
  for (const f of files) {
    const id = await mgr.show({ title: path.basename(f, '.glb'), items: [{ kind: 'glb', title: path.basename(f, '.glb'), credit: '', bytes: fs.readFileSync(f), file: f }], x: 700, y: 450 });
    const h = mgr.get(id);
    await wait(2500);
    const js = (c) => h.win.webContents.executeJavaScript(c);
    for (const yaw of [30, 150, 270]) {
      await js(`window.__holoTest.yaw(${yaw}); document.documentElement.style.background='#10202c'; 0`);
      await wait(500);
      const img = await h.win.webContents.capturePage({ x: 430, y: 150, width: 560, height: 560 });
      fs.writeFileSync(path.join(out, `${path.basename(f, '.glb')}-y${yaw}.png`), img.toPNG());
    }
    info.push(path.basename(f));
    mgr.close(id);
  }
  console.log('RENDERED', JSON.stringify(info));
  app.exit(0);
});
