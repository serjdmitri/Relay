// Renders the Mac window in each of the five looks (dark) with the mocked backend, into docs/img/look-<look>.png, for the README.
// Run: node scripts/look-shots.mjs  (needs Chrome, like scripts/screenshots.mjs)
import { launch } from './chromium.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'docs/img');
fs.mkdirSync(out, { recursive: true });
const mock = fs.readFileSync(path.join(root, 'scripts/mock-relay.js'), 'utf8');
const browser = await launch();
const ctx = await browser.newContext({ viewport: { width: 980, height: 640 }, deviceScaleFactor: 2, colorScheme: 'dark' });
await ctx.addInitScript(mock);
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
for (const look of ['glass', 'instrument', 'studio', 'cockpit', 'buddy']) {
  await page.addInitScript((l) => { try { localStorage.setItem('relay-look', l); } catch (e) {} }, look);
  await page.goto('file://' + path.join(root, 'src/renderer/index.html') + '?page=home');
  await page.evaluate((l) => { document.documentElement.setAttribute('data-look', l); }, look);
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(out, `look-${look}.png`) });
}
await browser.close();
if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1; } else console.log('look screenshots written to', out);
