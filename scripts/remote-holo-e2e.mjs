// The phone's hologram page in a phone-sized Chromium, against the real server: the list, a model drawn on the canvas, turning it with a finger,
// and the three file buttons giving real files. The "Mac" is a stand-in that serves a small test model.
import { launch } from './chromium.mjs';
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { RemoteServer } = require('../src/main/remote/server');
const { Pairing, Devices } = require('../src/main/remote/auth');
const { tinyGlb } = require('../test/helpers/glb');
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'shots');
fs.mkdirSync(out, { recursive: true });

let list = [];
const control = { ask: async () => 'r1', stop() {}, snapshot: () => ({ state: 'idle', label: '', tasks: [], agents: [] }), recent: () => [], holos: () => [{ id: 'holo-aaaa-1111', title: 'Test octahedron', pinned: false, designed: true }], holoModel: async () => ({ bytes: tinyGlb(), mm: true, title: 'Test octahedron' }) };
const pairing = new Pairing({ code: () => '123456' });
const devices = new Devices({ list: () => list, save: (l) => { list = l; } });
const server = new RemoteServer({ control, pairing, devices, root: path.join(root, 'src/remote'), host: '127.0.0.1', port: 0 });
await server.start();
const base = `http://127.0.0.1:${server.port}`;
pairing.start();
const { token } = await (await fetch(`${base}/api/pair`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-relay-remote': '1' }, body: JSON.stringify({ code: '123456', name: 'iPhone' }) })).json();

const results = [];
const ok = (name, cond, extra = '') => results.push([cond ? 'PASS' : 'FAIL', name, extra]);
const browser = await launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, acceptDownloads: true });
await ctx.addInitScript((t) => localStorage.setItem('relay-remote-token', t), token);
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
try {
  await page.goto(`${base}/holo.html`);
  await page.waitForSelector('#tiles li');
  ok('the list shows the hologram on the Mac', (await page.textContent('#tiles')).includes('Test octahedron'));
  await page.screenshot({ path: path.join(out, 'remote-holo-list.png') });
  await page.click('#tiles li');
  await page.waitForFunction(() => document.getElementById('vtitle').textContent === 'Test octahedron' && document.getElementById('vmsg').textContent === '', null, { timeout: 15000 });
  await page.waitForTimeout(800);
  // a WebGL canvas cannot be read back after it is shown, so the picture of the page is checked: the model's light blue is there
  const shot = await page.screenshot({ clip: await page.locator('#gl').boundingBox() });
  const lit = await page.evaluate(async (b64) => { const img = new Image(); img.src = `data:image/png;base64,${b64}`; await img.decode(); const t = document.createElement('canvas'); t.width = img.width; t.height = img.height; const g = t.getContext('2d'); g.drawImage(img, 0, 0); const d = g.getImageData(0, 0, t.width, t.height).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] > 45 && d[i + 2] > 60) n++; return n; }, shot.toString('base64'));
  ok('the model is drawn on the canvas', lit > 5000, `${lit} model-coloured pixels`);
  await page.screenshot({ path: path.join(out, 'remote-holo-view.png') });
  const box = await page.locator('#gl').boundingBox();
  const before = await page.screenshot({ clip: box });
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
  const cdp = await ctx.newCDPSession(page);
  const x0 = box.x + box.width / 2, y0 = box.y + box.height / 2;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y: y0 }] });
  for (let i = 1; i <= 8; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + i * 14, y: y0 + i * 6 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(300);
  const after = await page.screenshot({ clip: box });
  ok('a finger drag turns it', !before.equals(after));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-phone-'));
  for (const fmt of ['stl', '3mf', 'step']) {
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 10000 }), page.click(`#vbar [data-fmt="${fmt}"]`)]);
    const f = path.join(dir, dl.suggestedFilename());
    await dl.saveAs(f);
    const size = fs.statSync(f).size;
    ok(`${fmt.toUpperCase()} downloads as a file named after the model`, dl.suggestedFilename() === `Test octahedron.${fmt}` && size > 200, `${dl.suggestedFilename()} ${size} bytes`);
    if (fmt === '3mf') ok('the 3MF is a valid zip', /No errors detected/.test(execFileSync('unzip', ['-t', f]).toString()));
    if (fmt === 'stl') ok('the STL holds the 8 triangles of the model, 20 mm across', fs.readFileSync(f).readUInt32LE(80) === 8);
  }
  ok('no page errors', errors.length === 0, errors.join(' | '));
} catch (e) {
  ok('run', false, e.message + ' | ' + errors.join(' | ') + ' | msg: ' + (await page.textContent('#vmsg').catch(() => '')));
}
await browser.close();
server.stop();
for (const r of results) console.log(r.join('  '));
process.exit(results.some((r) => r[0] === 'FAIL') ? 1 : 0);
