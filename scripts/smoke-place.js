// Two models combined, then one dragged by hand onto the surface of the other and left there (kept in the main process). Run: <electron> scripts/smoke-place.js [outDir]
const { app } = require('electron');
const fs = require('fs');
const path = require('path');
const { HoloManager } = require('../src/main/holo/manager');
const holoWin = require('../src/main/holo/windows');
const { normalizeParts } = require('../src/main/models/shapes');
const out = process.argv[2] || path.join(__dirname, '../shots');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
process.on('uncaughtException', (e) => console.log('UNCAUGHT', e.message));
app.whenReady().then(async () => {
  const preload = path.join(__dirname, '../src/main/preload.js');
  const mgr = new HoloManager({ createWindow: ({ width, height }) => holoWin.createHoloWindow({ preload, width, height }), cursor: holoWin.cursor, area: holoWin.area, displayFor: holoWin.displayFor, download: async () => Buffer.alloc(0), saved: () => [], save: () => {}, fit: async () => ({ anchor: 'right', scale: 0.6, rotate: [0, 0, 0] }) });
  holoWin.registerHoloIpc(mgr);
  const result = {};
  try {
    const box = normalizeParts([{ shape: 'box', size: [1.6, 1, 1.2], color: '#8a929a' }]);
    const ball = normalizeParts([{ shape: 'sphere', size: [0.6], color: '#cc3333' }]);
    const wa = holoWin.area();
    const a = await mgr.show({ title: 'Base', items: [{ kind: 'shapes', title: 'Base', credit: 'built', parts: box }], x: Math.round(wa.x + wa.width * 0.4), y: Math.round(wa.y + wa.height * 0.45) });
    const b = await mgr.show({ title: 'Ball', items: [{ kind: 'shapes', title: 'Ball', credit: 'built', parts: ball }], x: Math.round(wa.x + wa.width * 0.8), y: Math.round(wa.y + wa.height * 0.45) });
    await wait(2500);
    await mgr.merge(b, a);
    await wait(2500);
    const h = mgr.get(a);
    h.win.webContents.on('console-message', (_e, level, msg) => { if (level >= 2) console.log('PAGE', msg.slice(0, 300)); });
    const js = (c) => h.win.webContents.executeJavaScript(c);
    const T = (c) => js(`JSON.stringify(window.__holoTest.${c})`).then((x) => JSON.parse(x));
    const mouse = (type, x, y, extra = {}) => h.win.webContents.sendInputEvent({ type, x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1, ...extra });
    const shot = async (name) => { await js("document.documentElement.style.background='#06121c'; document.body.classList.add('near'); 0"); await wait(150); fs.writeFileSync(path.join(out, name), (await h.win.webContents.capturePage({ x: 0, y: 150, width: 1400, height: 800 })).toPNG()); };
    await T('front()'); await wait(300);
    result.items = h.items.length;
    await shot('place-1-combined.png');
    const ball1 = await T('itemAt(1)'), base0 = await T('itemAt(0)');
    // pick the ball (rotates a little: a click), then drag it onto the top of the base
    mouse('mouseMove', ball1.x, ball1.y); await wait(200);
    mouse('mouseDown', ball1.x, ball1.y); await wait(80); mouse('mouseUp', ball1.x, ball1.y); await wait(250);
    result.sel = await T('sel()');
    const ball2 = await T('itemAt(1)');
    mouse('mouseDown', ball2.x, ball2.y); await wait(80);
    for (let i = 1; i <= 8; i++) { mouse('mouseMove', ball2.x + (base0.x - ball2.x) * i / 8, ball2.y + (base0.y - 40 - ball2.y) * i / 8, { modifiers: ['leftButtonDown'] }); await wait(50); }
    mouse('mouseUp', base0.x, base0.y - 40); await wait(700);
    result.placement = mgr.get(a).items[1].placement;
    result.now = await T('itemAt(1)');
    await shot('place-2-placed.png');
  } catch (e) { result.error = e.stack; }
  console.log('RESULT', JSON.stringify(result));
  app.exit(0);
});
