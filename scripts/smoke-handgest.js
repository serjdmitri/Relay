// The new hand gestures on a real hologram window: big controls while a hand is in view, two fists pulled apart (the model comes apart and goes
// back), two hands turning like a wheel (it rolls), a swipe (next model), thumb up (kept). No camera. Run: <electron> scripts/smoke-handgest.js <outDir>
const { app } = require('electron');
const fs = require('fs');
const path = require('path');
const { HoloManager } = require('../src/main/holo/manager');
const holoWin = require('../src/main/holo/windows');
const { HandControl } = require('../src/main/hands/control');
const { normalizeParts } = require('../src/main/models/shapes');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
process.on('uncaughtException', (e) => console.log('UNCAUGHT', e.message));
app.whenReady().then(async () => {
  const out = process.argv[2] || path.join(__dirname, '../shots');
  const preload = path.join(__dirname, '../src/main/preload.js');
  let hc = null;
  const mgr = new HoloManager({ createWindow: ({ width, height }) => holoWin.createHoloWindow({ preload, width, height }), cursor: () => hc?.virtualCursor() || holoWin.cursor(), getUi: () => ({ controls: 'bar', spin: true, spinDelay: 10 }), area: holoWin.area, displayFor: holoWin.displayFor, download: async () => Buffer.alloc(0), saved: () => [], save: () => {} });
  holoWin.registerHoloIpc(mgr);
  hc = new HandControl({ holos: mgr, display: () => holoWin.area(), askAccess: async () => true, createCamera: async () => ({ close() {} }), createCursor: () => ({ moveTo() {}, setState() {}, hide() {}, close() {} }), onMic: () => {} });
  await hc.enable();
  const result = {};
  try {
    const wa = holoWin.area();
    const parts = normalizeParts([{ shape: 'box', size: [1.6, 0.5, 1], color: '#8a929a' }, { shape: 'cylinder', size: [0.35, 0.35, 0.25], color: '#222', position: [-0.9, -0.2, 0.6], rotation: [90, 0, 0] }, { shape: 'cylinder', size: [0.35, 0.35, 0.25], color: '#222', position: [0.9, -0.2, 0.6], rotation: [90, 0, 0] }, { shape: 'box', size: [0.5, 0.5, 0.5], color: '#cc3333', position: [0, 0.5, 0] }]);
    const id = await mgr.show({ title: 'Robot', items: [{ kind: 'shapes', title: 'Robot', credit: 'built', parts }], x: Math.round(wa.x + wa.width * 0.5), y: Math.round(wa.y + wa.height * 0.45) });
    const h = mgr.get(id);
    await wait(3000);
    const js = (c) => h.win.webContents.executeJavaScript(c);
    const T = (c) => js(`JSON.stringify(window.__holoTest.${c})`).then(JSON.parse);
    const shot = async (name) => { await js("document.documentElement.style.background='#06121c'; document.body.classList.add('near'); 0"); await wait(200); fs.writeFileSync(path.join(out, name), (await h.win.webContents.capturePage({ x: 0, y: 100, width: 1500, height: 900 })).toPNG()); };
    const size = () => js("(() => { const b = document.getElementById('explode').getBoundingClientRect(); return { w: Math.round(b.width), h: Math.round(b.height) }; })()");
    await T('front()');
    result.normalButton = await size();
    await shot('gest-1-normal.png');
    hc.frame({ t: 1, hands: [{ x: 0.5, y: 0.5, gesture: 'Open_Palm', pinch: 0.9, size: 0.2, score: 1 }] });
    await wait(500);
    result.handButton = await size();
    await shot('gest-2-hand-mode.png');
    const pt = { x: (h.x - wa.x) / (wa.width - 1), y: (h.y - wa.y) / (wa.height - 1) };
    await hc.handle({ type: 'pull', open: true, ...pt }); await wait(1400);
    result.pulled = (await T('state()')).exploded;
    await shot('gest-3-pulled-apart.png');
    await hc.handle({ type: 'pull', open: false, ...pt }); await wait(1400);
    result.pushed = (await T('state()')).exploded;
    const q0 = (await T('state()')).q;
    for (let i = 0; i < 12; i++) { await hc.handle({ type: 'twist', angle: 0.06, ...pt }); await wait(30); }
    await wait(200);
    result.twist = { before: q0.map((v) => +v.toFixed(2)), after: (await T('state()')).q.map((v) => +v.toFixed(2)) };
    await hc.handle({ type: 'thumbup', ...pt }); await wait(300);
    result.pinned = h.pinned;
    hc.frame({ t: 2, hands: [] }); await wait(3000);
    result.backToNormal = await size();
  } catch (e) { result.error = e.stack; }
  console.log('RESULT', JSON.stringify(result));
  app.exit(0);
});
