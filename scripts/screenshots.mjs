// Renders every page with a mocked backend into ./shots (used for the README images and for visual comparison).
// On a Mac it finds Google Chrome; elsewhere set CHROMIUM_PATH.
import { launch } from './chromium.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'shots');
fs.mkdirSync(out, { recursive: true });
const mock = fs.readFileSync(path.join(root, 'scripts/mock-relay.js'), 'utf8');
const url = (f, q = '') => 'file://' + path.join(root, 'src/renderer', f) + q;

const browser = await launch();
const ctx = await browser.newContext({ viewport: { width: 820, height: 620 }, deviceScaleFactor: 2 });
await ctx.addInitScript(mock);

const main = await ctx.newPage();
const errors = [];
main.on('pageerror', (e) => errors.push('main: ' + e.message));
main.on('console', (m) => m.type() === 'error' && errors.push('main console: ' + m.text()));
for (const p of ['home', 'history', 'routines', 'vocab', 'general', 'speech', 'shortcuts', 'permissions', 'account']) {
  await main.goto(url('index.html', `?page=${p}`));
  await main.waitForTimeout(150);
  await main.screenshot({ path: path.join(out, `main-${p}.png`) });
}

// the model service picker, with a key-based service selected
await main.goto(url('index.html', '?page=account'));
await main.evaluate(() => window.relay.set('settings.model.provider', 'openai'));
await main.waitForTimeout(200);
await main.screenshot({ path: path.join(out, 'main-account-openai.png') });

const onb = await ctx.newPage();
await onb.setViewportSize({ width: 720, height: 560 });
onb.on('pageerror', (e) => errors.push('onb: ' + e.message));
await onb.goto(url('onboarding.html'));
await onb.waitForTimeout(100);
await onb.screenshot({ path: path.join(out, 'onb-welcome.png') });

const pill = await ctx.newPage();
await pill.setViewportSize({ width: 640, height: 300 });
pill.on('pageerror', (e) => errors.push('pill: ' + e.message));
await pill.goto(url('ask.html'));
const states = {
  input: { state: 'input', askLabel: 'Right ⌥', reset: true },
  working: { state: 'working', label: 'Opening Notes', text: 'Open notes and make a note called Plan' },
  confirm: { state: 'confirm', question: 'Send "running late" to +1 305 555 0100?' },
  done: { state: 'done', status: 'done', reply: 'Reminder set: call mom, today at 5:00 PM.' },
  dictating: { state: 'working', label: 'Listening', text: 'Open Notes and remind me to call mom at 5' }
};
for (const [name, msg] of Object.entries(states)) {
  await pill.evaluate((m) => window.__askState(m), { ...msg, show: true, glass: false });
  await pill.waitForTimeout(1100);
  const r = await pill.evaluate(() => { const b = document.getElementById('pill').getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; });
  const pad = 70; // keep the whole soft shadow so it fades out instead of being cut off
  await pill.screenshot({ path: path.join(out, `pill-${name}.png`), omitBackground: true, clip: { x: Math.max(0, r.x - pad), y: Math.max(0, r.y - pad), width: r.w + 2 * pad, height: r.h + 2 * pad } });
}
await browser.close();
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('shots written to', out);
