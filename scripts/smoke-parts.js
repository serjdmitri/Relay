// Real holograms in real Electron windows: pull a model apart, pick a piece with the pointer, drag it out into its own hologram,
// and combine two (the fit is stubbed). Saves pictures. Run: <electron> scripts/smoke-parts.js <file.glb> [outDir]
const { app } = require('electron');
const fs = require('fs');
const path = require('path');
const { HoloManager } = require('../src/main/holo/manager');
const holoWin = require('../src/main/holo/windows');
const { findStls, downloadStl } = require('../src/main/models/lookup');
const { normalizeParts } = require('../src/main/models/shapes');

const glb = process.argv[2];
const out = process.argv[3] || path.join(__dirname, '../shots');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
process.on('uncaughtException', (e) => console.log('UNCAUGHT', e.message));

app.whenReady().then(async () => {
  const preload = path.join(__dirname, '../src/main/preload.js');
  let stored = [];
  const fitCalls = [];
  const mgr = new HoloManager({
    createWindow: ({ width, height }) => holoWin.createHoloWindow({ preload, width, height }), cursor: holoWin.cursor, area: holoWin.area,
    download: (u) => downloadStl(u), saved: () => stored, save: (l) => { stored = l; },
    fit: async (base, item) => { fitCalls.push([base.title, item.title]); return { anchor: 'top', scale: 0.55, rotate: [0, 0, 0] }; },
    putFile: (b) => `/tmp/part-${b.length}.glb`
  });
  holoWin.registerHoloIpc(mgr);
  const dark = (h) => h.win.webContents.executeJavaScript("document.documentElement.style.background='#06121c'; document.body.classList.add('near'); 0");
  const shot = async (h, name) => { await dark(h); await wait(120); fs.writeFileSync(path.join(out, name), (await h.win.webContents.capturePage()).toPNG()); };
  const st = (h) => h.win.webContents.executeJavaScript('JSON.stringify(window.__holoTest.state())').then(JSON.parse);
  const where = (h, i) => h.win.webContents.executeJavaScript(`JSON.stringify(window.__holoTest.where(${i}))`).then(JSON.parse);
  const mouse = (h, type, x, y, extra = {}) => h.win.webContents.sendInputEvent({ type, x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1, ...extra });
  const result = {};
  try {
    const found = await findStls('skull', { n: 1 });
    const parts = normalizeParts([
      { shape: 'box', size: [1.6, 0.4, 1], color: '#8a929a' }, { shape: 'cylinder', size: [0.35, 0.35, 0.25], color: '#222222', position: [-0.9, -0.2, 0.6], rotation: [90, 0, 0] },
      { shape: 'cylinder', size: [0.35, 0.35, 0.25], color: '#222222', position: [0.9, -0.2, 0.6], rotation: [90, 0, 0] }, { shape: 'box', size: [0.5, 0.5, 0.5], color: '#cc3333', position: [0, 0.45, 0] }
    ]);
    const robot = await mgr.show({ title: 'Robot', items: [{ kind: 'shapes', title: 'Robot', credit: 'built', parts }], x: 20, y: 80 });
    const head = await mgr.show({ title: 'Skull', items: [{ kind: 'stl', title: found[0].title, credit: found[0].credit, url: found[0].url, bytes: await downloadStl(found[0].url) }], x: 500, y: 80 });
    const vex = await mgr.show({ title: 'VEX', items: [{ kind: 'glb', title: 'VEX robot', credit: 'photo', bytes: fs.readFileSync(glb), file: '/tmp/vex.glb' }], x: 980, y: 80 });
    await wait(3500);
    const R = mgr.get(robot);
    R.win.webContents.on('console-message', (_e, level, msg) => { if (level >= 2) console.log('PAGE', msg.slice(0, 200)); });
    await shot(R, 'parts-1-together.png');
    await R.win.webContents.executeJavaScript("document.getElementById('explode').click(); 0");
    await wait(1400);
    result.explodedState = await st(R);
    await shot(R, 'parts-2-exploded.png');
    // hover, click to select, then drag the piece out
    const p0 = await where(R, 3);
    mouse(R, 'mouseMove', p0.x, p0.y); await wait(500);
    mouse(R, 'mouseDown', p0.x, p0.y); await wait(120); mouse(R, 'mouseUp', p0.x, p0.y); await wait(300);
    result.selected = (await st(R)).selected;
    await shot(R, 'parts-3-selected.png');
    const before = mgr.holos.size;
    const knownIds = new Set(mgr.holos.keys());
    mouse(R, 'mouseDown', p0.x, p0.y); await wait(150);
    mouse(R, 'mouseMove', p0.x + 8, p0.y + 4, { modifiers: ['leftButtonDown'] }); await wait(60);
    mouse(R, 'mouseMove', p0.x + 40, p0.y + 30, { modifiers: ['leftButtonDown'] }); await wait(1500);
    result.err = await R.win.webContents.executeJavaScript("document.getElementById('err').textContent");
    result.pulledOut = { holosBefore: before, holosAfter: mgr.holos.size, dragging: !!mgr.dragging };
    // the pointer carries the new hologram away from the first one (the real pointer is not moved by this test, so the stand-in is)
    const realCursor = mgr.cursor;
    mgr.cursor = () => ({ x: 1500, y: 700 });
    await wait(300);
    mouse(R, 'mouseUp', p0.x + 40, p0.y + 30);
    await wait(600);
    mgr.cursor = realCursor;
    const newest = mgr.get([...mgr.holos.keys()].find((id) => !knownIds.has(id)));
    result.piece = newest ? { title: newest.title, x: newest.win.getBounds().x, y: newest.win.getBounds().y } : null;
    result.afterDrop = { dragging: !!mgr.dragging, remaining: (await st(R)).items };
    await wait(2000);
    await shot(newest, 'parts-4-piece.png');
    await shot(R, 'parts-5-rest.png');
    // the skull split into regions
    const H = mgr.get(head);
    await H.win.webContents.executeJavaScript("document.getElementById('explode').click(); 0");
    await wait(1500);
    result.skullParts = (await st(H)).parts;
    await shot(H, 'parts-6-skull-exploded.png');
    // combine: the piece onto the VEX robot (stub fit: on top, smaller)
    const V = mgr.get(vex);
    await mgr.merge(newest.id, vex);
    await wait(3000);
    result.merged = { title: V.title, items: V.items.length, placement: V.items[1]?.placement, fit: fitCalls[0] };
    await shot(V, 'parts-7-combined.png');
  } catch (e) { result.error = e.stack; }
  console.log('RESULT', JSON.stringify(result));
  app.exit(0);
});
