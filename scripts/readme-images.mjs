// Composes the README pictures from the real UI screenshots: run `node scripts/screenshots.mjs` first.
// Writes docs/img/pill-states.png, ui-main.png and ui-more.png. The windows and pills are the real renderer
// pages, drawn with a mocked backend (scripts/mock-relay.js), so no personal data is shown.
import { launch } from './chromium.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const shots = path.join(root, 'shots');
const out = path.join(root, 'docs/img');
fs.mkdirSync(out, { recursive: true });
const img = (f) => 'data:image/png;base64,' + fs.readFileSync(path.join(shots, f)).toString('base64');

const WALL = 'linear-gradient(135deg,#1B1464 0%,#6B2BD9 42%,#E0489B 78%,#FF9A4D 100%)';
const FONT = "-apple-system,BlinkMacSystemFont,'SF Pro Text',Helvetica,Arial,sans-serif";
const base = (w, h, body) => `<!doctype html><body style="margin:0;width:${w}px;height:${h}px;background:${WALL};position:relative;overflow:hidden;font-family:${FONT};color:#fff">
<div style="position:absolute;inset:0;background:radial-gradient(circle at 18% 22%,rgba(91,227,255,.45),transparent 45%),radial-gradient(circle at 88% 85%,rgba(255,226,122,.40),transparent 45%)"></div>${body}</body>`;

const win = (file, x, y, w) => `<img src="${img(file)}" style="position:absolute;left:${x}px;top:${y}px;width:${w}px;border-radius:14px;box-shadow:0 24px 60px rgba(10,4,40,.55),0 0 0 1px rgba(255,255,255,.18)">`;
const cap = (t, x, y, w) => `<div style="position:absolute;left:${x}px;top:${y}px;width:${w}px;text-align:center;font-size:17px;font-weight:600;text-shadow:0 1px 8px rgba(20,6,60,.5)">${t}</div>`;
const pillImg = (file, x, y, w) => `<img src="${img(file)}" style="position:absolute;left:${x}px;top:${y}px;width:${w}px">`;

const browser = await launch();
const page = await browser.newPage({ deviceScaleFactor: 2 });
async function shoot(name, w, h, body) {
  await page.setViewportSize({ width: w, height: h });
  await page.setContent(base(w, h, body));
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(out, name) });
}

// four pill states (each screenshot carries its own soft shadow, so the frames overlap their captions harmlessly)
const pw = 600;
await shoot('pill-states.png', 1200, 470,
  pillImg('pill-working.png', 0, 20, pw) + cap('Doing it. Stop any time.', 0, 140, pw) +
  pillImg('pill-confirm.png', 600, 0, pw) + cap('Asks before it sends, trashes or runs shell', 600, 150, pw) +
  pillImg('pill-done.png', 0, 235, pw) + cap('A short result, then it gets out of the way', 0, 355, pw) +
  pillImg('pill-input.png', 600, 235, pw) + cap('Or type it with ⌥T', 600, 355, pw) +
  `<div style="position:absolute;left:0;right:0;bottom:22px;text-align:center;font-size:14px;opacity:.8">The pill drops out of the notch under the menu bar</div>`);

// windows
await shoot('ui-main.png', 1200, 470, win('main-home.png', 36, 36, 548) + win('main-history.png', 616, 36, 548));
await shoot('ui-more.png', 1200, 470, win('main-account-openai.png', 36, 36, 548) + win('main-speech.png', 616, 36, 548));
await browser.close();
console.log('images written to', out);
