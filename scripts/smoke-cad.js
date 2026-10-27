// A designed model in a real hologram window: "a cube with a hole going through it and a cone on top", then edited by mouse (move a shape,
// pull a face, add a shape, cut a hole, undo) and by voice (the edit tool's change list). Run: <electron> scripts/smoke-cad.js [outDir]
const { app } = require('electron');
const fs = require('fs');
const path = require('path');
const { HoloManager } = require('../src/main/holo/manager');
const holoWin = require('../src/main/holo/windows');
const cadModel = require('../src/main/models/cad');

const out = process.argv[2] || path.join(__dirname, '../shots');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
process.on('uncaughtException', (e) => console.log('UNCAUGHT', e.message));

app.setPath('downloads', require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'relay-dl-'))); // saved files go to a temporary folder in this test
app.whenReady().then(async () => {
  const preload = path.join(__dirname, '../src/main/preload.js');
  const mgr = new HoloManager({ createWindow: ({ width, height }) => holoWin.createHoloWindow({ preload, width, height }), cursor: holoWin.cursor, area: holoWin.area, displayFor: holoWin.displayFor, download: async () => Buffer.alloc(0), saved: () => [], save: () => {} });
  holoWin.registerHoloIpc(mgr);
  const result = {};
  try {
    const cad = cadModel.normalizeCad({ shapes: [
      { name: 'Cube', type: 'cube', size: 40 },
      { name: 'Hole', type: 'cylinder', diameter: 16, through: { of: 'Cube', axis: 'y' } },
      { name: 'Cone', type: 'cone', size: [30, 25, 30], on: { of: 'Cube', side: 'top' } }
    ] });
    const wa = holoWin.area();
    const id = await mgr.show({ title: 'Cube with a hole', items: [{ kind: 'cad', title: 'Cube with a hole', credit: 'Designed with Relay', cad }], x: Math.round(wa.x + wa.width * 0.5), y: Math.round(wa.y + wa.height * 0.45) });
    const h = mgr.get(id);
    h.win.webContents.on('console-message', (_e, level, msg) => { if (level >= 2) console.log('PAGE', msg.slice(0, 300)); });
    await wait(3500);
    const js = (code) => h.win.webContents.executeJavaScript(code);
    const T = (call) => js(`JSON.stringify(window.__holoTest.${call})`).then((x) => JSON.parse(x));
    const mouse = (type, x, y, extra = {}) => h.win.webContents.sendInputEvent({ type, x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1, ...extra });
    const shot = async (name) => { await js("document.documentElement.style.background='#06121c'; document.body.classList.add('near'); 0"); await wait(150); fs.writeFileSync(path.join(out, name), (await h.win.webContents.capturePage({ x: 0, y: 150, width: 1400, height: 800 })).toPNG()); };
    result.editButtonShown = await js("!document.getElementById('edit').hidden");
    await js("document.getElementById('reset').click(); 0"); await wait(300);
    await shot('cad-1-model.png');

    await js("document.getElementById('edit').click(); 0"); await wait(700);
    result.editing = (await T('cad()')).editing;
    await T('front()'); await wait(200);
    await shot('cad-2-editing.png');

    // pick the cone and move it sideways by dragging
    const cone = await T("shapeAt('s3')");
    mouse('mouseMove', cone.x, cone.y); await wait(200);
    mouse('mouseDown', cone.x, cone.y); await wait(80);
    for (let i = 1; i <= 5; i++) { mouse('mouseMove', cone.x + i * 12, cone.y, { modifiers: ['leftButtonDown'] }); await wait(50); }
    mouse('mouseUp', cone.x + 60, cone.y); await wait(300);
    const afterMove = await T('cad()');
    result.moved = { sel: afterMove.sel, pos: afterMove.spec.shapes[2].pos, was: cad.shapes[2].pos };
    await shot('cad-3-moved.png');

    // pull the right face of the cube out
    mouse('mouseMove', cone.x - 100, cone.y + 200); // away
    const cubePos = await T("shapeAt('s1')");
    mouse('mouseMove', cubePos.x, cubePos.y + 30); await wait(100);
    mouse('mouseDown', cubePos.x, cubePos.y + 30); await wait(80); mouse('mouseUp', cubePos.x, cubePos.y + 30); await wait(250);
    result.cubeSel = (await T('cad()')).sel;
    const handle = await T('handleAt(0, 1)');
    result.handle = handle;
    mouse('mouseMove', handle.x, handle.y); await wait(150);
    mouse('mouseDown', handle.x, handle.y); await wait(80);
    for (let i = 1; i <= 5; i++) { mouse('mouseMove', handle.x + i * 8, handle.y, { modifiers: ['leftButtonDown'] }); await wait(50); }
    mouse('mouseUp', handle.x + 40, handle.y); await wait(300);
    const afterResize = await T('cad()');
    result.resized = { sel: afterResize.sel, size: afterResize.spec.shapes[0].size, pos: afterResize.spec.shapes[0].pos, was: cad.shapes[0].pos };
    await shot('cad-4-resized.png');

    // add a sphere with the button, and make it a hole with the button
    await js("document.querySelector('[data-add=sphere]').click(); 0"); await wait(300);
    const added = await T('cad()');
    result.added = added.spec.shapes.map((s) => `${s.name}${s.hole ? ' (hole)' : ''}`);
    await js("document.getElementById('holeT').click(); 0"); await wait(300);
    result.sphereIsHole = (await T('cad()')).spec.shapes.at(-1).hole;
    await shot('cad-5-added-hole.png');

    // undo twice
    await js("document.getElementById('undo').click(); 0"); await wait(200);
    await js("document.getElementById('undo').click(); 0"); await wait(200);
    result.afterUndo = (await T('cad()')).spec.shapes.length;
    // what the page saved reached the main process
    await wait(600);
    result.savedInMain = mgr.get(id).items[0].cad.shapes.length;

    // by voice: make the hole bigger and add a ball on the cone (the edit tool's path)
    await js("document.getElementById('done').click(); 0"); await wait(500);
    const cur = mgr.get(id).items[0].cad;
    const edited = cadModel.applyEdits(cur, [{ op: 'set', name: 'Hole', diameter: 26 }, { op: 'add', shape: { type: 'sphere', size: 12, on: { of: 'Cone', side: 'top' } } }]);
    mgr.setCad(mgr.get(id), 0, edited, { push: true });
    await wait(2500);
    result.afterVoice = { shapes: (await T('cad()')).spec.shapes.length, editing: (await T('cad()')).editing, hole: edited.shapes[1].size };
    await shot('cad-6-voice-edit.png');
    result.stl = await T('stlBytes()');
    for (const fmt of ['stl', '3mf', 'step']) { await js(`window.__holoTest.save('${fmt}'); 0`); await wait(900); }
    const dir = path.join(app.getPath('downloads'), 'Relay 3D');
    result.saved = fs.existsSync(dir) ? fs.readdirSync(dir).map((f) => [f, fs.statSync(path.join(dir, f)).size]) : [];
    result.savedDir = dir;
    const g = await mgr.requestGlb(mgr.get(id)); // what the phone gets
    result.phoneGlb = g ? { head: g.bytes.slice(0, 4).toString(), kb: Math.round(g.bytes.length / 1024), mm: g.mm } : null;
    result.fps = await T('fps()');
  } catch (e) { result.error = e.stack; }
  console.log('RESULT', JSON.stringify(result));
  app.exit(0);
});
