// Records the pull-apart video of a photo-made model in the real hologram page (Chromium, stand-in bridge): is a video made and handed to save?
// Run: node scripts/smoke-video.mjs <file.glb>
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch } from './chromium.mjs';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/renderer');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.png': 'image/png', '.wasm': 'application/wasm' };
const server = http.createServer((q, r) => { const f = path.join(root, decodeURIComponent(q.url.split('?')[0])); if (!f.startsWith(root) || !fs.existsSync(f)) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' }); r.end(fs.readFileSync(f)); }).listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
const errs = []; page.on('pageerror', (e) => errs.push(e.message));
await page.addInitScript((process_out) => { window.__saved = null; window.relay = new Proxy({}, { get: (_, k) => (k === 'onHolo' ? (cb) => { window.__cb = cb; } : k === 'holoSave' ? async (d) => { window.__saved = { ext: d.ext, bytes: d.bytes.length, head: Array.from(d.bytes.slice(0, 4)), b64: process_out ? btoa(Array.from(d.bytes, (x) => String.fromCharCode(x)).join('')) : '' }; return { ok: true, where: '/tmp' }; } : () => Promise.resolve({})) }); }, !!process.env.OUT);
await page.goto(`${base}/holo.html`);
await page.waitForFunction(() => window.__cb);
const b64 = fs.readFileSync(process.argv[2]).toString('base64');
await page.evaluate((b) => window.__cb('init', { id: 'x', title: 'Model', items: [{ kind: 'glb', title: 'Model', credit: 'test', bytes: Uint8Array.from(atob(b), (c) => c.charCodeAt(0)) }], pos: { x: 500, y: 400 }, scale: 1, ui: {} }), b64);
await page.waitForTimeout(5000);
const r = await page.evaluate(() => window.__holoTest.record());
console.log('RESULT', JSON.stringify({ r, saved: await page.evaluate(() => window.__saved), exploded: await page.evaluate(() => window.__holoTest.state().exploded), errors: errs.slice(0, 3) }));
if (process.env.OUT) fs.writeFileSync(process.env.OUT, Buffer.from((await page.evaluate(() => window.__saved.b64)), 'base64'));
await browser.close(); server.close(); process.exit(0);
