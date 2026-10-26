// Shows holograms on the real screen and takes a real screen capture (what the user sees, with whatever is behind). Run: <electron> scripts/smoke-real.js <outPng>
const { app } = require('electron');
const { execFileSync } = require('child_process');
const path = require('path');
const { HoloManager } = require('../src/main/holo/manager');
const holoWin = require('../src/main/holo/windows');
const { findStls, downloadStl } = require('../src/main/models/lookup');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
app.whenReady().then(async () => {
  const preload = path.join(__dirname, '../src/main/preload.js');
  let stored = [];
  const mgr = new HoloManager({ createWindow: ({ width, height }) => holoWin.createHoloWindow({ preload, width, height }), cursor: holoWin.cursor, area: holoWin.area, download: (u) => downloadStl(u), saved: () => stored, save: (l) => { stored = l; }, fit: async () => ({ anchor: 'top', scale: 0.5, rotate: [0, 0, 0] }), putFile: (b) => `/tmp/part-${b.length}.glb` });
  holoWin.registerHoloIpc(mgr);
  const found = await findStls('skull', { n: 1 });
  await mgr.show({ title: 'Skull', items: [{ kind: 'stl', title: found[0].title, credit: found[0].credit, url: found[0].url, bytes: await downloadStl(found[0].url) }], x: 300, y: 200 });
  await wait(4000);
  try { execFileSync('screencapture', ['-x', process.argv[2]]); console.log('SHOT ok'); } catch (e) { console.log('SHOT failed', e.message); }
  app.exit(0);
});
