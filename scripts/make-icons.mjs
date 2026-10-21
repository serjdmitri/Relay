// Renders assets/icon.png (1024) and the menu bar template icons from SVG.
import { launch } from './chromium.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const assets = path.join(root, 'assets');
fs.mkdirSync(assets, { recursive: true });

const appIcon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="1024" height="1024"><defs><linearGradient id="lg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6a6a6a"/><stop offset="1" stop-color="#3f3f3f"/></linearGradient></defs>
<rect x="4" y="4" width="92" height="92" rx="22" fill="url(#lg)"/>
<g fill="none" stroke="#f1f1f1" stroke-linecap="round"><path d="M50 18a32 32 0 1 1-30 21" stroke-width="5"/><path d="M50 30a20 20 0 1 1-18 13" stroke-width="5" opacity=".8"/><path d="M50 42a8 8 0 1 1-6 5" stroke-width="5" opacity=".6"/></g><circle cx="50" cy="50" r="3.6" fill="#f1f1f1"/></svg>`;

const tray = (size) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="${size}" height="${size}"><g fill="none" stroke="#000" stroke-linecap="round" stroke-width="9"><path d="M50 10a40 40 0 1 1-37.5 26"/><path d="M50 30a20 20 0 1 1-18 13"/></g><circle cx="50" cy="50" r="6" fill="#000"/></svg>`;

const browser = await launch();
const page = await browser.newPage();
async function render(svg, file, size) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<body style="margin:0;background:transparent">${svg}</body>`);
  await page.screenshot({ path: path.join(assets, file), omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
}
await render(appIcon, 'icon.png', 1024);
await render(tray(18), 'trayTemplate.png', 18);
await render(tray(36), 'trayTemplate@2x.png', 36);
await browser.close();
console.log('icons written to', assets);
