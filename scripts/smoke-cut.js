// Trackpad pinch zoom and the cut bar on a real hologram window. Run: <electron> scripts/smoke-cut.js <outDir>
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
    await T('front()');
    // pinch: a wheel with ctrl held is what a trackpad pinch sends
    const s0 = (await T('scale()'));
    h.win.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(mgr.local(h).x), y: Math.round(mgr.local(h).y) }); await wait(200);
    for (let i = 0; i < 8; i++) { h.win.webContents.sendInputEvent({ type: 'mouseWheel', x: Math.round(mgr.local(h).x), y: Math.round(mgr.local(h).y), deltaX: 0, deltaY: -6, modifiers: ['control'], canScroll: false }); await wait(30); }
    await wait(200);
    const s1 = (await T('scale()'));
    for (let i = 0; i < 8; i++) { h.win.webContents.sendInputEvent({ type: 'mouseWheel', x: Math.round(mgr.local(h).x), y: Math.round(mgr.local(h).y), deltaX: 0, deltaY: 6, modifiers: ['control'], canScroll: false }); await wait(30); }
    await wait(200);
    result.pinch = { before: s0, zoomedIn: s1, afterOut: await T('scale()') };
    // the same as the browser sees it: a pinch OUT on a trackpad is a wheel with ctrl held and a NEGATIVE deltaY
    await js("for (let i = 0; i < 8; i++) window.dispatchEvent(new WheelEvent('wheel', { ctrlKey: true, deltaY: -6, cancelable: true })); 0"); await wait(200);
    result.pinchOutDom = await T('scale()');
    await js("for (let i = 0; i < 8; i++) window.dispatchEvent(new WheelEvent('wheel', { ctrlKey: true, deltaY: 6, cancelable: true })); 0"); await wait(200);
    result.pinchInDom = await T('scale()');
    // plain scroll still works, gently
    for (let i = 0; i < 4; i++) { h.win.webContents.sendInputEvent({ type: 'mouseWheel', x: Math.round(mgr.local(h).x), y: Math.round(mgr.local(h).y), deltaX: 0, deltaY: -20 }); await wait(30); }
    await wait(200); result.scroll = await T('scale()');
    await js("document.documentElement.style.background='#0b1620'; document.body.classList.add('near'); 0");
    await T('front()'); await wait(200);
    const px = async () => { const img = h.win.webContents.capturePage ? await h.win.webContents.capturePage() : null; const b = img.toBitmap(); const sz = img.getSize(); let lit = 0; for (let i = 0; i < b.length; i += 4) if (b[i] + b[i + 1] + b[i + 2] > 120) lit++; return { lit, sz }; };
    const shot = async (name) => { await wait(250); fs.writeFileSync(path.join(out, name), (await h.win.webContents.capturePage()).toPNG()); };
    result.full = await px(); await shot('cut-0-full.png');
    result.cutOn = await T('cut(true, 1, 0.0)'); await wait(300); await shot('cut-1-half-y.png'); result.half = await px();
    result.cutLow = await T('cut(true, 1, -0.5)'); await wait(300); await shot('cut-2-low-y.png'); result.low = await px();
    result.cutX = await T('cut(true, 0, 0.0)'); await wait(300); await shot('cut-3-half-x.png'); result.halfX = await px();
    result.flip = await T('cut(true, 0, 0.0, true)'); await wait(300); await shot('cut-4-flipped.png');
    result.bar = await js("JSON.stringify({ shown: getComputedStyle(document.getElementById('cutbar')).display, body: document.body.classList.contains('cutting') })").then(JSON.parse);
    await js("document.getElementById('solid').click(); 0"); await wait(900);
    await T('cut(true, 1, 0.0)'); await wait(400); await shot('cut-5-solid-half.png');
    await T('cut(false)'); await wait(300); result.off = await js("JSON.stringify({ body: document.body.classList.contains('cutting') })").then(JSON.parse);
  } catch (e) { result.error = e.stack; }
  console.log('RESULT', JSON.stringify(result));
  app.exit(0);
});
