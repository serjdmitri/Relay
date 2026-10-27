// Hand events (as the gesture logic would send them) driving a real hologram window: a fist grabs and carries it, a pinch-hold turns it, a
// pinch clicks a button, two hands resize it. No camera. Run: <electron> scripts/smoke-handmap.js
const { app } = require('electron');
const path = require('path');
const { HoloManager } = require('../src/main/holo/manager');
const holoWin = require('../src/main/holo/windows');
const { HandControl } = require('../src/main/hands/control');
const { normalizeParts } = require('../src/main/models/shapes');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
process.on('uncaughtException', (e) => console.log('UNCAUGHT', e.message));
app.whenReady().then(async () => {
  const preload = path.join(__dirname, '../src/main/preload.js');
  let hc = null;
  const mgr = new HoloManager({ createWindow: ({ width, height }) => holoWin.createHoloWindow({ preload, width, height }), cursor: () => hc?.virtualCursor() || holoWin.cursor(), area: holoWin.area, displayFor: holoWin.displayFor, download: async () => Buffer.alloc(0), saved: () => [], save: () => {} });
  holoWin.registerHoloIpc(mgr);
  hc = new HandControl({ holos: mgr, display: () => holoWin.area(), askAccess: async () => true, createCamera: async () => ({ close() {} }), createCursor: () => ({ moveTo() {}, setState() {}, hide() {}, close() {} }), onMic: () => {} });
  await hc.enable();
  const result = {};
  try {
    const wa = holoWin.area();
    const parts = normalizeParts([{ shape: 'box', size: [1.6, 1, 1.2], color: '#8a929a' }, { shape: 'sphere', size: [0.6], color: '#cc3333', position: [0, 0.8, 0] }]);
    const id = await mgr.show({ title: 'Demo', items: [{ kind: 'shapes', title: 'Demo', credit: 'built', parts }], x: Math.round(wa.x + wa.width * 0.5), y: Math.round(wa.y + wa.height * 0.45) });
    const h = mgr.get(id);
    await wait(3000);
    const pt = (x, y) => ({ x: (x - wa.x) / (wa.width - 1), y: (y - wa.y) / (wa.height - 1) });
    const T = (c) => h.win.webContents.executeJavaScript(`JSON.stringify(window.__holoTest.${c})`).then(JSON.parse);
    result.start = { x: h.x, y: h.y };
    // a fist on the model grabs it, the hand moves 300 right and 120 down, the hand opens
    await hc.handle({ type: 'move', ...pt(h.x, h.y) }); await wait(150);
    await hc.handle({ type: 'grab', ...pt(h.x, h.y) }); await wait(200);
    for (let i = 1; i <= 10; i++) { await hc.handle({ type: 'move', held: true, ...pt(result.start.x + i * 30, result.start.y + i * 12) }); await wait(40); }
    await wait(150);
    await hc.handle({ type: 'release', ...pt(result.start.x + 300, result.start.y + 120) }); await wait(400);
    result.afterFist = { x: h.x, y: h.y, captured: !!hc.captured };
    // pinch held on the model turns it
    const q0 = (await T('state()')).q;
    await hc.handle({ type: 'move', ...pt(h.x, h.y) }); await wait(150);
    await hc.handle({ type: 'pinchdown', ...pt(h.x, h.y) }); await wait(150);
    for (let i = 1; i <= 8; i++) { await hc.handle({ type: 'move', held: true, ...pt(h.x + i * 14, h.y + i * 9) }); await wait(40); }
    await hc.handle({ type: 'pinchup', ...pt(h.x + 112, h.y + 72) }); await wait(300);
    result.turned = { before: q0.map((v) => +v.toFixed(2)), after: (await T('state()')).q.map((v) => +v.toFixed(2)) };
    // two hands: bigger
    const s0 = h.scale;
    for (let i = 0; i < 6; i++) { await hc.handle({ type: 'scale', factor: 1.12, ...pt(h.x, h.y) }); await wait(30); }
    await wait(600);
    result.scale = { before: s0, after: h.scale };
    // a pinch-tap on the explode button (find it, move the hand there, click)
    const btn = await h.win.webContents.executeJavaScript("(() => { document.body.classList.add('near'); const r = document.getElementById('explode').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()");
    await wait(400);
    await hc.handle({ type: 'click', ...pt(btn.x + (h.disp?.x || 0), btn.y + (h.disp?.y || 0)) }); await wait(1200);
    result.exploded = (await T('state()')).exploded;
  } catch (e) { result.error = e.stack; }
  console.log('RESULT', JSON.stringify(result));
  app.exit(0);
});
