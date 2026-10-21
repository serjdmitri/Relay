// Renders every page with a mocked backend into ./shots for visual comparison.
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
for (const p of ['home', 'history', 'routines', 'vocab', 'general', 'model', 'shortcuts', 'permissions']) {
  await main.goto(url('index.html', `?page=${p}`));
  await main.waitForTimeout(150);
  await main.screenshot({ path: path.join(out, `main-${p}.png`) });
}

const onb = await ctx.newPage();
await onb.setViewportSize({ width: 720, height: 560 });
onb.on('pageerror', (e) => errors.push('onb: ' + e.message));
await onb.goto(url('onboarding.html'));
await onb.waitForTimeout(100);
await onb.screenshot({ path: path.join(out, 'onb-welcome.png') });
for (let i = 0; i < 7; i++) {
  if (i === 5) {
    // step index 4 (Firefox) needs an answer before Continue enables
    await onb.screenshot({ path: path.join(out, 'onb-4-no-answer.png') });
    await onb.click('.yn button[data-v="yes"]');
    await onb.waitForTimeout(100);
    await onb.screenshot({ path: path.join(out, 'onb-4-yes.png') });
  }
  await onb.click('#footer .pill-btn:last-child');
  await onb.waitForTimeout(150);
  await onb.screenshot({ path: path.join(out, `onb-${i}.png`) });
}

const pill = await ctx.newPage();
await pill.setViewportSize({ width: 480, height: 120 });
pill.on('pageerror', (e) => errors.push('pill: ' + e.message));
await pill.goto(url('ask.html'));
const states = {
  input: { state: 'input', askLabel: 'Right ⌥', reset: true },
  working: { state: 'working', label: 'Opening Notes', text: 'Open notes and make a note called Plan' },
  confirm: { state: 'confirm', question: 'Send "running late" to +1 305 555 0100?' },
  done: { state: 'done', status: 'done', reply: 'You have 6 apps open: Claude, darktable, Finder, Firefox, Preview and System Settings.' }
};
for (const [name, msg] of Object.entries(states)) {
  await pill.evaluate((m) => window.__askState(m), msg);
  await pill.waitForTimeout(100);
  await pill.screenshot({ path: path.join(out, `pill-${name}.png`) });
}
await browser.close();
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('shots written to', out);
