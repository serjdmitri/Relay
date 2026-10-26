// Real holograms in real Electron windows (each as big as the display): turn one every way, double-click to pull it apart, carry a piece
// anywhere, take it out, put the rest back together, and drop a piece on another hologram (the fit is stubbed). Saves pictures, including real
// screen captures (what you see, with what is behind it). Run: <electron> scripts/smoke-parts.js <file.glb> [outDir]
const { app } = require('electron');
const { execFileSync } = require('child_process');
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
    createWindow: ({ width, height }) => holoWin.createHoloWindow({ preload, width, height }), cursor: holoWin.cursor, area: holoWin.area, displayFor: holoWin.displayFor,
    download: (u) => downloadStl(u), saved: () => stored, save: (l) => { stored = l; },
    fit: async (base, item) => { fitCalls.push([base.title, item.title]); return { anchor: 'top', scale: 0.55, rotate: [0, 0, 0] }; },
    putFile: (b) => `/tmp/part-${b.length}.glb`
  });
  holoWin.registerHoloIpc(mgr);
  const real = (name) => execFileSync('screencapture', ['-x', path.join(out, name)]);
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
    const wa = holoWin.area();
    const cx = (f) => Math.round(wa.x + wa.width * f);
    const cy = Math.round(wa.y + wa.height * 0.45);
    const robot = await mgr.show({ title: 'Robot', items: [{ kind: 'shapes', title: 'Robot', credit: 'built', parts }], x: cx(0.2), y: cy });
    const head = await mgr.show({ title: 'Skull', items: [{ kind: 'stl', title: found[0].title, credit: found[0].credit, url: found[0].url, bytes: await downloadStl(found[0].url) }], x: cx(0.5), y: cy });
    const vex = await mgr.show({ title: 'VEX', items: [{ kind: 'glb', title: 'VEX robot', credit: 'photo', bytes: fs.readFileSync(glb), file: '/tmp/vex.glb' }], x: cx(0.8), y: cy });
    await wait(4000);
    const R = mgr.get(robot), H = mgr.get(head), V = mgr.get(vex);
    for (const h of [R, H, V]) h.win.webContents.on('console-message', (_e, level, msg) => { if (level >= 2) console.log('PAGE', msg.slice(0, 200)); });
    result.windowBounds = R.win.getBounds();
    result.fps = await R.win.webContents.executeJavaScript('window.__holoTest.fps()');
    real('parts-1-real.png');

    // turn the skull every way: sideways, up and down, and a diagonal; the orientation has to change about both axes
    const q0 = (await st(H)).q;
    const px = H.x - (H.disp?.x || 0), py = H.y - (H.disp?.y || 0);
    mouse(H, 'mouseMove', px, py); await wait(200);
    mouse(H, 'mouseDown', px, py); await wait(80);
    for (const [dx, dy] of [[0, 40], [0, 80], [40, 120], [90, 150]]) { mouse(H, 'mouseMove', px + dx, py + dy, { modifiers: ['leftButtonDown'] }); await wait(60); }
    mouse(H, 'mouseUp', px + 90, py + 150); await wait(300);
    result.turned = { before: q0.map((v) => +v.toFixed(2)), after: (await st(H)).q.map((v) => +v.toFixed(2)) };
    real('parts-2-turned-real.png');

    // double-click the robot: it pulls apart (turned to the front first, so the picture is the same every time)
    await R.win.webContents.executeJavaScript("document.getElementById('reset').click(); 0"); await wait(200);
    const rx = R.x - (R.disp?.x || 0), ry = R.y - (R.disp?.y || 0);
    mouse(R, 'mouseMove', rx, ry); await wait(200);
    mouse(R, 'mouseDown', rx, ry, { clickCount: 1 }); mouse(R, 'mouseUp', rx, ry, { clickCount: 1 });
    mouse(R, 'mouseDown', rx, ry, { clickCount: 2 }); mouse(R, 'mouseUp', rx, ry, { clickCount: 2 });
    await wait(1400);
    result.exploded = await st(R);
    real('parts-3-exploded-real.png');

    // carry one piece within the hologram, and then far out
    const p3 = await where(R, 3);
    mouse(R, 'mouseMove', p3.x, p3.y); await wait(300);
    mouse(R, 'mouseDown', p3.x, p3.y); await wait(100);
    mouse(R, 'mouseMove', p3.x + 60, p3.y - 40, { modifiers: ['leftButtonDown'] }); await wait(120);
    mouse(R, 'mouseUp', p3.x + 60, p3.y - 40); await wait(400);
    result.movedInside = { holos: mgr.holos.size, state: await st(R), now: await where(R, 3) };
    real('parts-4-moved-real.png');

    const known = new Set(mgr.holos.keys());
    const p3b = await where(R, 3);
    mouse(R, 'mouseDown', p3b.x, p3b.y); await wait(100);
    const far = { x: p3b.x + 20, y: Math.min(wa.y + wa.height - 70, p3b.y + 700) };
    for (let i = 1; i <= 8; i++) { mouse(R, 'mouseMove', p3b.x + (far.x - p3b.x) * i / 8, p3b.y + (far.y - p3b.y) * i / 8, { modifiers: ['leftButtonDown'] }); await wait(60); (result.trace ||= []).push([Math.round(p3b.x + (far.x - p3b.x) * i / 8), Math.round(p3b.y + (far.y - p3b.y) * i / 8), Math.round((await where(R, 3)).x), Math.round((await where(R, 3)).y)]); }
    await wait(150);
    result.farDbg = await R.win.webContents.executeJavaScript('JSON.stringify(window.__holoTest.carried && window.__holoTest.carried())');
    mouse(R, 'mouseUp', far.x, far.y); await wait(1800);
    const madeId = [...mgr.holos.keys()].find((id) => !known.has(id));
    const made = madeId && mgr.get(madeId);
    result.err = await R.win.webContents.executeJavaScript("document.getElementById('err').textContent");
    result.takenOut = { holos: mgr.holos.size, piece: made ? { title: made.title, x: made.x, y: made.y } : null, restState: await st(R) };
    real('parts-5-taken-out-real.png');

    // put the rest back together: double-click it again
    const p0 = await where(R, 0);
    mouse(R, 'mouseMove', p0.x, p0.y); await wait(200);
    mouse(R, 'mouseDown', p0.x, p0.y, { clickCount: 1 }); mouse(R, 'mouseUp', p0.x, p0.y, { clickCount: 1 });
    mouse(R, 'mouseDown', p0.x, p0.y, { clickCount: 2 }); mouse(R, 'mouseUp', p0.x, p0.y, { clickCount: 2 });
    await wait(1400);
    result.together = await st(R);
    real('parts-6-rest-together-real.png');

    // drop the pulled-out piece on the VEX robot: it joins it
    if (made) {
      const mx = made.x - (made.disp?.x || 0), my = made.y - (made.disp?.y || 0);
      mouse(made, 'mouseMove', mx, my); await wait(250);
      // the piece is a single solid model: pull it apart to get something to carry, then drag the first piece onto the VEX
      mouse(made, 'mouseDown', mx, my, { clickCount: 1 }); mouse(made, 'mouseUp', mx, my, { clickCount: 1 });
      mouse(made, 'mouseDown', mx, my, { clickCount: 2 }); mouse(made, 'mouseUp', mx, my, { clickCount: 2 });
      await wait(1400);
      result.pieceState = await st(made);
    }
    // a hologram dragged by its name onto another combines them
    const realCursor = mgr.cursor;
    const cur = { x: H.x, y: H.y };
    mgr.cursor = () => cur;
    mgr.startDrag(H);
    cur.x = V.x; cur.y = V.y;
    await wait(300);
    real('parts-7-over-real.png');
    mgr.cursor = realCursor;
    mgr.stopDrag();
    await wait(3500);
    result.merged = { holos: mgr.holos.size, vex: mgr.get(vex)?.title, items: mgr.get(vex)?.items.length, fit: fitCalls };
    real('parts-8-combined-real.png');
  } catch (e) { result.error = e.stack; }
  console.log('RESULT', JSON.stringify(result));
  app.exit(0);
});
