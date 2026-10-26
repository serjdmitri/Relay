// Drives the real Relay Remote server and phone page in a phone-sized Chromium: pair with a code, ask by typing, watch the
// status and the answer arrive, then unpair. The "Mac" is a stand-in that answers after a moment. Screenshots go to ./shots.
import { launch } from './chromium.mjs';
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { RemoteServer } = require('../src/main/remote/server');
const { Pairing, Devices } = require('../src/main/remote/auth');
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'shots');
fs.mkdirSync(out, { recursive: true });

let list = [];
let server;
const state = { state: 'idle', label: '', tasks: [], agents: [] };
const control = {
  ask: async (text) => {
    const id = 'r' + Date.now();
    state.state = 'working'; state.label = 'Opening Notes'; state.tasks = [{ id: '1', text, status: 'running' }];
    server.broadcast({ type: 'status', ...state });
    setTimeout(() => { state.state = 'idle'; state.label = ''; state.tasks = []; server.broadcast({ type: 'status', ...state }); server.broadcast({ type: 'result', id, reply: `Done: ${text}.`, status: 'done' }); }, 1200);
    return id;
  },
  stop() {}, snapshot: () => state, recent: () => [{ text: 'earlier', reply: 'Hello from earlier.', status: 'done', ts: 1 }]
};
const pairing = new Pairing({ code: () => '123456' });
const devices = new Devices({ list: () => list, save: (l) => { list = l; } });
server = new RemoteServer({ control, pairing, devices, root: path.join(root, 'src/remote'), host: '127.0.0.1', port: 0 });
await server.start();
const url = `http://127.0.0.1:${server.port}/`;
pairing.start();

const results = [];
const ok = (name, cond, extra = '') => results.push([cond ? 'PASS' : 'FAIL', name, extra]);
const browser = await launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await ctx.addInitScript(() => localStorage.setItem('relay-remote-speak', '0')); // a headless browser never finishes speaking
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
try {
  await page.goto(url + '?code=123456');
  ok('pairing screen shows with the code filled in', (await page.inputValue('#code')) === '123456');
  await page.screenshot({ path: path.join(out, 'remote-pair.png') });
  await page.fill('#devname', "Sergey's iPhone");
  await page.click('#pairgo');
  await page.waitForSelector('#home:not([hidden])');
  ok('pairing works and the home screen opens', true);
  await page.waitForFunction(() => document.getElementById('reply').textContent.includes('Hello from earlier'));
  ok('the last answer is shown', true);
  ok('connected dot is on', await page.evaluate(() => document.getElementById('conn').className.includes('on')) || (await page.waitForFunction(() => document.getElementById('conn').className.includes('on'), null, { timeout: 4000 }).then(() => true).catch(() => false)));
  await page.fill('#text', 'make a note called groceries');
  await page.press('#text', 'Enter');
  await page.waitForFunction(() => document.getElementById('status').textContent === 'PROCESSING');
  await page.waitForTimeout(300);
  ok('shows PROCESSING with the task bullet', (await page.textContent('#tasks')).includes('groceries'));
  await page.screenshot({ path: path.join(out, 'remote-working.png') });
  await page.waitForFunction(() => document.getElementById('reply').textContent.startsWith('Done: make a note'), null, { timeout: 5000 });
  ok('the answer arrives', true);
  ok('and it goes back to IDLE', (await page.textContent('#status')) === 'IDLE');
  await page.screenshot({ path: path.join(out, 'remote-home.png') });
  page.once('dialog', (d) => d.accept());
  await page.click('#gear');
  await page.click('#unpair');
  await page.waitForSelector('#pair:not([hidden])');
  ok('unpairing returns to the pairing screen', (await page.evaluate(() => localStorage.getItem('relay-remote-token'))) === null);
  ok('no page errors', errors.length === 0, errors.join(' | '));
} catch (e) {
  ok('run', false, e.message);
}
await browser.close();
server.stop();
for (const r of results) console.log(r.join('  '));
process.exit(results.some((r) => r[0] === 'FAIL') ? 1 : 0);
