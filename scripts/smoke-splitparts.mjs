// Pulls a photo-made model apart in the real hologram page (in Chromium, with a stand-in for Electron's bridge) and says how many pieces it made.
// Run: node scripts/smoke-splitparts.mjs <file.glb> [out.png]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch } from './chromium.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/renderer');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.png': 'image/png', '.wasm': 'application/wasm' };
const server = http.createServer((q, r) => { const f = path.join(root, decodeURIComponent(q.url.split('?')[0])); if (!f.startsWith(root) || !fs.existsSync(f)) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' }); r.end(fs.readFileSync(f)); }).listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
const bytes = fs.readFileSync(process.argv[2]).toString('base64');
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.addInitScript(() => { window.relay = new Proxy({}, { get: (_, k) => (k === 'onHolo' ? (cb) => { window.__cb = cb; } : () => Promise.resolve({})) }); });
await page.goto(`${base}/holo.html`);
await page.waitForFunction(() => window.__cb);
await page.evaluate((b64) => window.__cb('init', { id: 'x', title: 'Model', items: [{ kind: 'glb', title: 'Model', credit: 'test', bytes: Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)) }], pos: { x: 500, y: 400 }, scale: 1, ui: {} }), bytes);
await page.waitForTimeout(6000);
const t0 = Date.now();
await page.evaluate(() => document.getElementById('explode').click());
await page.waitForTimeout(2500);
const r = await page.evaluate(() => ({ parts: window.__holoTest.state().parts, hint: document.getElementById('hint2')?.textContent || '' }));
console.log('RESULT', JSON.stringify({ ...r, ms: Date.now() - t0, errors: errs.slice(0, 3) }));
if (process.argv[3]) await page.screenshot({ path: process.argv[3] });
await browser.close(); server.close(); process.exit(0);
