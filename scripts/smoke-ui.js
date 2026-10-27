// The three control styles (menu, side, bar) on a real hologram window, and the "leave it still after a touch" setting. Run: <electron> scripts/smoke-ui.js <outDir>
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
    const found = await findStls('skull', { n: 3 });
    const opts = found.map((m) => ({ kind: 'stl', title: m.title, url: m.url, credit: m.credit }));
    const wa = holoWin.area();
    const id = await mgr.show({ title: 'Human skull', items: [{ kind: 'stl', title: found[0].title, credit: found[0].credit, url: found[0].url, bytes: await downloadStl(found[0].url) }], options: { list: opts, index: 0 }, x: Math.round(wa.x + wa.width * 0.5), y: Math.round(wa.y + wa.height * 0.4) });
    const h = mgr.get(id);
    await wait(3500);
    const js = (c) => h.win.webContents.executeJavaScript(c);
    const T = (c) => js(`JSON.stringify(window.__holoTest.${c})`).then(JSON.parse);
    const shot = async (name) => { await js("document.documentElement.style.background='#0b1620'; document.body.classList.add('near'); 0"); await wait(250); fs.writeFileSync(path.join(out, name), (await h.win.webContents.capturePage({ x: 450, y: 150, width: 900, height: 760 })).toPNG()); };
    await T('front()');
    for (const c of ['menu', 'side', 'bar']) { ui.controls = c; mgr.refreshUi(); await wait(300); await shot(`ui-${c}.png`); }
    ui.controls = 'menu'; mgr.refreshUi(); await wait(300);
    await js("document.getElementById('more').click(); 0"); await wait(300);
    await shot('ui-menu-open.png');
    result.menuItems = await js("[...document.querySelectorAll('#items .btn:not([hidden])')].map((b) => b.dataset.name)");
    await js("document.getElementById('close').dataset.x = 1; document.body.classList.remove('menu-open'); 0");
    // spin: touched now (by moving it), still for 1 s, then turns again
    h.win.webContents.send('holo:state', 'pos', mgr.local(h)); await wait(150);
    const q0 = (await T('state()')).q; await wait(700); const q1 = (await T('state()')).q;
    await wait(2500); const q2 = (await T('state()')).q;
    const diff = (a, b) => +a.reduce((s, v, i) => s + Math.abs(v - b[i]), 0).toFixed(3);
    result.spin = { stillWhileWaiting: diff(q0, q1), turnsAfterwards: diff(q1, q2) };
    ui.spin = false; mgr.refreshUi(); await wait(3000);
    const q3 = (await T('state()')).q; await wait(1500);
    result.spinOff = diff(q3, (await T('state()')).q);
  } catch (e) { result.error = e.stack; }
  console.log('RESULT', JSON.stringify(result));
  app.exit(0);
});
