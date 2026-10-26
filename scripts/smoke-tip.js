// Hover a control of a real hologram window and save what the page draws (on a dark backdrop), to see the tooltip. Run: <electron> scripts/smoke-tip.js <outDir>
const { app } = require('electron');
const fs = require('fs');
const path = require('path');
const { HoloManager } = require('../src/main/holo/manager');
const holoWin = require('../src/main/holo/windows');
const { normalizeParts } = require('../src/main/models/shapes');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
app.whenReady().then(async () => {
  const preload = path.join(__dirname, '../src/main/preload.js');
  const mgr = new HoloManager({ createWindow: ({ width, height }) => holoWin.createHoloWindow({ preload, width, height }), cursor: holoWin.cursor, area: holoWin.area, displayFor: holoWin.displayFor, download: async () => Buffer.alloc(0), saved: () => [], save: () => {} });
  holoWin.registerHoloIpc(mgr);
  const parts = normalizeParts([{ shape: 'box', size: [1.6, 0.4, 1], color: '#8a929a' }, { shape: 'sphere', size: [0.5], color: '#cc3333', position: [0, 0.6, 0] }]);
  const id = await mgr.show({ title: 'Demo', items: [{ kind: 'shapes', title: 'Demo', credit: 'built', parts }], x: 500, y: 450 });
  await wait(2500);
  const h = mgr.get(id);
  const out = [];
  for (const b of ['explode', 'pin', 'move']) {
    const r = await h.win.webContents.executeJavaScript(`(() => { const r = document.getElementById('${b}').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    h.win.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(r.x), y: Math.round(r.y) });
    await wait(400);
    await h.win.webContents.executeJavaScript("document.documentElement.style.background='#06121c'; 0");
    await wait(150);
    const img = await h.win.webContents.capturePage({ x: 250, y: 200, width: 500, height: 520 });
    fs.writeFileSync(path.join(process.argv[2], `tip-${b}.png`), img.toPNG());
    out.push(await h.win.webContents.executeJavaScript("document.getElementById('tip').textContent"));
  }
  console.log('TIPS', JSON.stringify(out));
  app.exit(0);
});
