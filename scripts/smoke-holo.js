// Runs real holograms in real Electron windows (borderless, transparent): shows a real model and one built from shapes, moves the
// pointer over and off the model to check clicks fall through where they should, steps options, combines two, and saves pictures.
// Run: <electron> scripts/smoke-holo.js [outDir]
const { app, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');
const { HoloManager } = require('../src/main/holo/manager');
const holoWin = require('../src/main/holo/windows');
const { findStls, downloadStl } = require('../src/main/models/lookup');
const { normalizeParts } = require('../src/main/models/shapes');

const out = process.argv[2] || path.join(__dirname, '../shots');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
process.on('uncaughtException', (e) => console.log('UNCAUGHT', e.message));

app.whenReady().then(async () => {
  const preload = path.join(__dirname, '../src/main/preload.js');
  const ignoreLog = [];
  let stored = [];
  const mgr = new HoloManager({
    createWindow: ({ width, height }) => { const w = holoWin.createHoloWindow({ preload, width, height }); const o = w.setIgnoreMouseEvents.bind(w); w.setIgnoreMouseEvents = (...a) => { ignoreLog.push([w.webContents.id, a[0]]); return o(...a); }; return w; },
    cursor: holoWin.cursor, area: holoWin.area, download: (u) => downloadStl(u), saved: () => stored, save: (l) => { stored = l; }
  });
  holoWin.registerHoloIpc(mgr);
  const dark = (h) => h.win.webContents.executeJavaScript("document.documentElement.style.background='#06121c'; 0"); // only for the picture
  const shot = async (h, name) => { await dark(h); await wait(150); fs.writeFileSync(path.join(out, name), (await h.win.webContents.capturePage()).toPNG()); };
  const result = {};
  try {
    const found = await findStls('skull', { n: 4 });
    result.options = found.map((m) => m.title);
    const opts = found.map((m) => ({ kind: 'stl', title: m.title, url: m.url, credit: m.credit }));
    const parts = normalizeParts([{ shape: 'sphere', size: 0.8, color: '#ffcc33', glow: true, label: 'Sun' }, { shape: 'sphere', size: 0.22, color: '#3b8ee8', orbit: { radius: 1.8, speed: 40 }, label: 'Earth' }, { shape: 'ring', size: [1.8, 1.82], color: '#5a6a78', rotation: [90, 0, 0] }]);
    const a = await mgr.show({ title: 'Skull', items: [{ kind: 'stl', title: found[0].title, credit: found[0].credit, url: found[0].url, bytes: await downloadStl(found[0].url) }], options: { list: opts, index: 0 } });
    const b = await mgr.show({ title: 'Solar system', items: [{ kind: 'shapes', title: 'Solar system', credit: 'Built by Relay', parts }] });
    await wait(2800);
    await shot(mgr.get(a), 'holo-1-skull.png');
    await shot(mgr.get(b), 'holo-2-shapes.png');
    // the pointer: over the middle of the skull the window takes clicks; off in a corner of the (display-sized) window it lets them through
    const wa = mgr.get(a).win;
    const mine = () => ignoreLog.filter((l) => l[0] === wa.webContents.id).map((l) => l[1]);
    ignoreLog.length = 0;
    wa.webContents.sendInputEvent({ type: 'mouseMove', x: mgr.get(a).x, y: mgr.get(a).y });
    await wait(900);
    const over = mine();
    ignoreLog.length = 0;
    wa.webContents.sendInputEvent({ type: 'mouseMove', x: 20, y: 20 });
    await wait(900);
    result.pointer = { over, off: mine() };
    // another model for the same thing
    await mgr.step(a, 1);
    await wait(1500);
    result.step = mgr.get(a).items[0].title;
    // combine the skull with the solar system
    mgr.merge(b, a);
    await wait(2600);
    result.combined = { title: mgr.get(a).title, items: mgr.get(a).items.length, holos: mgr.holos.size };
    await shot(mgr.get(a), 'holo-3-combined.png');
    mgr.pin(a, true);
    result.saved = stored.map((s) => ({ title: s.title, items: s.items.map((i) => i.kind), pinned: s.pinned, hasBytes: JSON.stringify(s).includes('bytes') }));
  } catch (e) { result.error = e.stack; }
  console.log('RESULT', JSON.stringify(result));
  app.exit(0);
});
