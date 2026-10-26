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
const ctx = await browser.newContext({ viewport: { width: 820, height: 620 }, deviceScaleFactor: 2, colorScheme: 'dark' });
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

// the same pages in the system's light appearance
const lctx = await browser.newContext({ viewport: { width: 820, height: 620 }, deviceScaleFactor: 2, colorScheme: 'light' });
await lctx.addInitScript(mock);
const lmain = await lctx.newPage();
for (const p of ['home', 'general', 'permissions']) {
  await lmain.goto(url('index.html', `?page=${p}`));
  await lmain.waitForTimeout(150);
  await lmain.screenshot({ path: path.join(out, `main-${p}-light.png`) });
}
await lctx.close();

// sidebar collapsed: the main area takes the whole window
await main.goto(url('index.html', '?page=home'));
await main.evaluate(() => document.getElementById('sbtn').click());
await main.waitForTimeout(500);
await main.screenshot({ path: path.join(out, 'main-home-collapsed.png') });
await main.evaluate(() => localStorage.removeItem('sidebar'));

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
  dictating: { state: 'working', label: 'Listening', text: 'Open Notes and remind me to call mom at 5' },
  listening: { state: 'listening', mode: 'ask', askLabel: 'Right ⌥', dictateLabel: 'Right ⌘', reset: true, partial: 'Show me how to turn on Night Shift' }
};
for (const [name, msg] of Object.entries(states)) {
  await pill.evaluate((m) => window.__askState(m), { ...msg, show: true, glass: false, look: 'jarvis' });
  await pill.waitForTimeout(1100);
  const r = await pill.evaluate(() => { const b = document.getElementById('pill').getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; });
  const pad = 70; // keep the whole soft shadow so it fades out instead of being cut off
  await pill.screenshot({ path: path.join(out, `pill-${name}.png`), omitBackground: true, clip: { x: Math.max(0, r.x - pad), y: Math.max(0, r.y - pad), width: r.w + 2 * pad, height: r.h + 2 * pad } });
}
// the Recent menu on the left edge: the real window blurs what is behind it, here a wallpaper stands in
const rec = await ctx.newPage();
await rec.setViewportSize({ width: 344, height: 700 });
rec.on('pageerror', (e) => errors.push('recent: ' + e.message));
await rec.goto(url('recent.html'));
await rec.evaluate(() => { document.documentElement.style.background = 'radial-gradient(600px 500px at 60% 40%, #3a6f93, #1b3b52 60%, #0e1f2d)'; });
await rec.evaluate(() => window.__recent('show'));
await rec.waitForTimeout(1400);
await rec.screenshot({ path: path.join(out, 'recent-menu.png') });
// the overlay (buddy, drawings and the step-by-step guide) drawn over a wallpaper, since the real window is transparent
const ov = await ctx.newPage();
await ov.setViewportSize({ width: 1000, height: 620 });
ov.on('pageerror', (e) => errors.push('overlay: ' + e.message));
await ov.goto(url('overlay.html'));
const send = (m) => ov.evaluate((x) => window.__overlay(x), m);
await ov.evaluate(() => { document.documentElement.style.background = 'radial-gradient(900px 600px at 50% 40%, #12425e, #061826 70%, #03101b)'; });
await send({ type: 'look', look: 'jarvis' });
const snap = async (name, wait = 900) => { await ov.waitForTimeout(wait); await ov.screenshot({ path: path.join(out, `overlay-${name}.png`) }); };
await send({ type: 'buddy-state', state: 'listening' });
await send({ type: 'cursor', x: 330, y: 280 });
await snap('buddy-listening', 1200);
await send({ type: 'buddy-state', state: 'thinking' });
await snap('buddy-thinking', 500);
await send({ type: 'buddy-state', state: 'done' });
await snap('buddy-done', 600);
await send({ type: 'point', x: 640, y: 200, label: 'Night Shift' });
await send({ type: 'draw', add: false, shapes: [
  { type: 'box', x: 540, y: 170, w: 210, h: 62, label: 'Turn this on' },
  { type: 'arrow', x: 260, y: 430, x2: 520, y2: 250, label: 'Start here' },
  { type: 'circle', x: 760, y: 420, r: 44, label: 'Then click Done' }
] });
await snap('draw', 1300);
await send({ type: 'guide', card: { steps: ['Open System Settings', 'Click Displays', 'Click Night Shift', 'Turn on Schedule'], current: 1, total: 4 } });
await snap('guide', 700);
await send({ type: 'clear' });
// the reactor HUD: listening in the middle, working in the top left, and an answer
await send({ type: 'hud', state: { state: 'listening', mode: 'ask', partial: 'Open Notes and make a note called groceries', level: 0.7, askLabel: 'Right ⌥', dictateLabel: 'Right ⌘', name: 'J.A.R.V.I.S' } });
await snap('hud-listening', 1400);
const tasks = [{ id: 'a', text: 'Open Notes and make a note called groceries', status: 'running' }, { id: 'b', text: 'Set a timer for 10 minutes', status: 'queued' }, { id: 'c', text: 'Pause the music', status: 'queued' }];
await send({ type: 'hud', state: { state: 'working', label: 'Creating a note', text: tasks[0].text, tasks, name: 'J.A.R.V.I.S' } });
await snap('hud-working', 1600);
await send({ type: 'hud', state: { state: 'done', status: 'done', reply: 'Made a note called groceries.', tasks: tasks.map((t) => ({ ...t, status: 'done' })), name: 'J.A.R.V.I.S' } });
await snap('hud-done', 600);
await send({ type: 'hud', hide: true });
await send({ type: 'hud', state: { state: 'input', mode: 'type', reset: true, name: 'J.A.R.V.I.S' } });
await snap('hud-input', 1200);
await send({ type: 'hud', state: { state: 'confirm', question: 'Send "running late" to +1 305 555 0100?', name: 'J.A.R.V.I.S' } });
await snap('hud-confirm', 1000);
await send({ type: 'hud', hide: true });
// the mark key: a freehand circle drawn while it is held
await send({ type: 'mark-start' });
const ring = Array.from({ length: 41 }, (_, i) => [610 + 150 * Math.cos((i / 40) * 6.4), 300 + 95 * Math.sin((i / 40) * 6.4)]);
for (const [x, y] of ring) { await send({ type: 'mark-point', x, y }); await ov.waitForTimeout(8); }
await snap('mark', 100);
await send({ type: 'mark-end', cancel: true });
await send({ type: 'mark-clear' });
// the classic look, for comparison
await ov.evaluate(() => { document.documentElement.style.background = 'linear-gradient(135deg,#1B1464,#6B2BD9 45%,#E0489B 80%,#FF9A4D)'; });
await send({ type: 'look', look: 'classic' });
await send({ type: 'buddy-state', state: 'thinking' });
await send({ type: 'guide', card: { steps: ['Open System Settings', 'Click Displays', 'Click Night Shift', 'Turn on Schedule'], current: 1, total: 4 } });
await snap('classic-guide', 700);
await send({ type: 'clear' });
await browser.close();
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('shots written to', out);
