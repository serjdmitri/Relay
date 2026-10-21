// Renders assets/icon.png (1024) and the menu bar template icons from SVG.
import { launch } from './chromium.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const assets = path.join(root, 'assets');
fs.mkdirSync(assets, { recursive: true });

const appIcon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="1024" height="1024"><defs><linearGradient id="i-bg" x1="7" y1="4" x2="93" y2="96" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#4F46FF"/><stop offset=".5" stop-color="#C13CF0"/><stop offset="1" stop-color="#FF8A3D"/></linearGradient><radialGradient id="i-sh" cx=".3" cy=".1" r=".8"><stop offset="0" stop-color="#fff" stop-opacity=".38"/><stop offset=".6" stop-color="#fff" stop-opacity="0"/></radialGradient><linearGradient id="i-ar" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#FFE9C7"/></linearGradient><radialGradient id="i-gl"><stop offset="0" stop-color="#FFC94A" stop-opacity=".8"/><stop offset="1" stop-color="#FFC94A" stop-opacity="0"/></radialGradient><radialGradient id="i-dt" cx=".5" cy=".4" r=".6"><stop offset="0" stop-color="#FFF7C2"/><stop offset="1" stop-color="#FFC94A"/></radialGradient></defs>
<rect x="3.1" y="3.1" width="93.8" height="93.8" rx="22.7" fill="url(#i-bg)"/><rect x="3.1" y="3.1" width="93.8" height="93.8" rx="22.7" fill="url(#i-sh)"/>
<g fill="none" stroke-linecap="round" stroke-width="5.5"><path d="M50 17.19A32.81 32.81 0 1 1 31.18 23.12" stroke="url(#i-ar)"/><path d="M50 28.12A21.88 21.88 0 1 1 37.45 32.08" stroke="#fff" stroke-opacity=".78"/><path d="M50 38.67A11.33 11.33 0 1 1 43.50 40.72" stroke="#fff" stroke-opacity=".55"/></g><circle cx="50" cy="50" r="9" fill="url(#i-gl)"/><circle cx="50" cy="50" r="3.9" fill="url(#i-dt)"/></svg>`;

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
