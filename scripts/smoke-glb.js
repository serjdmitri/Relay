// Shows a GLB file as a hologram in real Electron, as a hologram and as solid, and saves pictures. Run: <electron> scripts/smoke-glb.js <file.glb> [outDir]
const { app } = require('electron');
const fs = require('fs');
const path = require('path');
const { HoloManager } = require('../src/main/holo/manager');
const holoWin = require('../src/main/holo/windows');

const file = process.argv[2];
const out = process.argv[3] || path.join(__dirname, '../shots');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
process.on('uncaughtException', (e) => console.log('UNCAUGHT', e.message));
app.whenReady().then(async () => {
  const preload = path.join(__dirname, '../src/main/preload.js');
  const mgr = new HoloManager({ createWindow: ({ width, height }) => holoWin.createHoloWindow({ preload, width, height }), cursor: holoWin.cursor, area: holoWin.area, download: async () => Buffer.alloc(0), saved: () => [], save: () => {} });
  holoWin.registerHoloIpc(mgr);
  const result = {};
  try {
    const id = await mgr.show({ title: 'VEX robot', items: [{ kind: 'glb', title: 'VEX Robotics Competition Robot', credit: 'Wikimedia Commons photo · made into 3D by Stable Fast 3D', bytes: fs.readFileSync(file) }] });
    const h = mgr.get(id);
    await wait(3200);
    await h.win.webContents.executeJavaScript("document.documentElement.style.background='#06121c'; document.body.classList.add('near'); 0");
    await wait(200);
    fs.writeFileSync(path.join(out, 'holo-glb-1.png'), (await h.win.webContents.capturePage()).toPNG());
    await wait(2200);
    fs.writeFileSync(path.join(out, 'holo-glb-2.png'), (await h.win.webContents.capturePage()).toPNG());
    await h.win.webContents.executeJavaScript("document.getElementById('solid').click(); 0");
    await wait(2500);
    fs.writeFileSync(path.join(out, 'holo-glb-solid.png'), (await h.win.webContents.capturePage()).toPNG());
    result.err = await h.win.webContents.executeJavaScript("document.getElementById('err').textContent");
  } catch (e) { result.error = e.stack; }
  console.log('RESULT', JSON.stringify(result));
  app.exit(0);
});
