// The measure tool on a designed cube (real millimetres): two clicks near opposite edges of its front face read about its width. Was: A designed model in a real hologram window: "a cube with a hole going through it and a cone on top", then edited by mouse (move a shape,
// Run: <electron> scripts/smoke-measure.js [outDir]
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
    const cad = cadModel.normalizeCad({ shapes: [{ name: 'Cube', type: 'cube', size: 40 }] });
    const wa = holoWin.area();
    const id = await mgr.show({ title: 'Cube', items: [{ kind: 'cad', title: 'Cube', credit: 'Designed with Relay', cad }], x: Math.round(wa.x + wa.width * 0.5), y: Math.round(wa.y + wa.height * 0.45) });
    const h = mgr.get(id);
    h.win.webContents.on('console-message', (_e, level, msg) => { if (level >= 2) console.log('PAGE', msg.slice(0, 300)); });
    await wait(3500);
    const js = (code) => h.win.webContents.executeJavaScript(code);
    const T = (call) => js(`JSON.stringify(window.__holoTest.${call})`).then((x) => JSON.parse(x));
    await js("document.getElementById('reset').click(); document.getElementById('spin') ; 0"); await wait(400);
    await js("window.__holoTest.front()"); await wait(300);
    const b = await T('bounds()');
    result.px = { widthPx: b.r.x - b.l.x, size: b.size, q: (await T('state()')).q };
    const inset = 10;
    const a = await T(`measureAt(${b.l.x + inset}, ${b.c.y})`);
    const c = await T(`measureAt(${b.r.x - inset}, ${b.c.y})`);
    result.first = a; result.second = c;
    const expected = 40 * (b.r.x - b.l.x - 2 * inset) / (b.r.x - b.l.x);
    result.expectedMm = +(c.world / (b.size[1] / 40)).toFixed(2); // the cube's height is 40 mm: that many world units per mm; the distance the two clicks really found, in those
    await js("document.documentElement.style.background='#06121c'; document.body.classList.add('near'); 0"); await wait(400);
    result.label = await js("document.getElementById('mlabel').textContent + ' | ' + document.getElementById('mlabel').style.display");
    fs.writeFileSync(path.join(out, 'measure-1.png'), (await h.win.webContents.capturePage()).toPNG());
    // a third click starts again
    const d = await T(`measureAt(${b.c.x}, ${b.c.y})`);
    result.third = d;
    await js('window.__holoTest.measureOff()');
    result.off = await js("document.getElementById('mlabel').style.display");
  } catch (e) { result.error = e.stack; }
  console.log('RESULT', JSON.stringify(result));
  app.exit(0);
});
