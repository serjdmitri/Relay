// Renders the phone's home-screen icon for each look (src/remote/icons/<look>.png, 180x180, full bleed: iOS rounds the corners itself)
// and the per-look web manifests (src/remote/manifests/<look>.webmanifest) whose background_color is the splash colour.
// Run: node scripts/make-phone-icons.mjs   (needs Chrome, like scripts/make-icons.mjs)
import { launch } from './chromium.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const iconDir = path.join(root, 'src', 'remote', 'icons');
const manDir = path.join(root, 'src', 'remote', 'manifests');
fs.mkdirSync(iconDir, { recursive: true });
fs.mkdirSync(manDir, { recursive: true });

// The Relay mark: three open rings round a glowing dot. Each look draws it its own way.
const rings = (stroke, w, extra = '') => `<g fill="none" stroke-linecap="${stroke.cap}" stroke-width="${w}" ${extra}><path d="M50 17.19A32.81 32.81 0 1 1 31.18 23.12" stroke="${stroke.a}"/><path d="M50 28.12A21.88 21.88 0 1 1 37.45 32.08" stroke="${stroke.b}" stroke-opacity=".8"/><path d="M50 38.67A11.33 11.33 0 1 1 43.5 40.72" stroke="${stroke.c}" stroke-opacity=".6"/></g>`;
const dot = (r, glow, fill) => `<circle cx="50" cy="50" r="${r * 2.3}" fill="${glow}" opacity=".55"/><circle cx="50" cy="50" r="${r}" fill="${fill}"/>`;

const LOOKS = {
  // Liquid Glass: blue depth with a bright sheen across the top, like a lit pane.
  glass: { bg: '#050d14', svg: `<defs><linearGradient id="b" x1="7" y1="0" x2="93" y2="100" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#0b2236"/><stop offset=".55" stop-color="#0f4a75"/><stop offset="1" stop-color="#1c8fd6"/></linearGradient><radialGradient id="s" cx=".3" cy=".05" r=".85"><stop offset="0" stop-color="#fff" stop-opacity=".5"/><stop offset=".55" stop-color="#fff" stop-opacity="0"/></radialGradient><linearGradient id="e" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".7"/><stop offset=".25" stop-color="#fff" stop-opacity="0"/></linearGradient></defs><rect width="100" height="100" fill="url(#b)"/><rect width="100" height="100" fill="url(#s)"/><rect width="100" height="48" fill="url(#e)" opacity=".35"/>${rings({ cap: 'round', a: '#fff', b: '#fff', c: '#fff' }, 5.5)}${dot(3.9, '#4cc2ff', '#e6f8ff')}` },
  // Instrument: flat near-black, hairline rings, no glow. Reads like a gauge.
  instrument: { bg: '#04090e', svg: `<rect width="100" height="100" fill="#04090e"/>${rings({ cap: 'butt', a: '#00d4ff', b: '#9fe9ff', c: '#d9f6ff' }, 3.2)}<circle cx="50" cy="50" r="3.4" fill="#00d4ff"/>` },
  // Studio: deep navy with a soft vertical lift and a calm, solid mark.
  studio: { bg: '#060f17', svg: `<defs><linearGradient id="b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#14293a"/><stop offset="1" stop-color="#060f17"/></linearGradient></defs><rect width="100" height="100" fill="url(#b)"/>${rings({ cap: 'round', a: '#e9fbff', b: '#7cc3d6', c: '#3b8aa0' }, 5)}${dot(4, '#00d4ff', '#e9fbff')}` },
  // Cockpit: black, cyan corner brackets and a crosshair feel.
  cockpit: { bg: '#050d14', svg: `<rect width="100" height="100" fill="#050d14"/><g fill="none" stroke="#00d4ff" stroke-width="2.2" stroke-linecap="square" opacity=".85"><path d="M12 28V12h16M72 12h16v16M88 72v16H72M28 88H12V72"/></g>${rings({ cap: 'butt', a: '#00d4ff', b: '#00d4ff', c: '#00d4ff' }, 3, 'opacity=".95"')}<path d="M50 40v-6M50 60v6M40 50h-6M60 50h6" stroke="#00d4ff" stroke-width="1.6"/>${dot(3, '#00d4ff', '#e6fbff')}` },
  // Buddy: friendly, chunky and round, bigger dot like an eye.
  buddy: { bg: '#08121b', svg: `<defs><linearGradient id="b" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2fd6ff"/><stop offset="1" stop-color="#0a6fb8"/></linearGradient></defs><rect width="100" height="100" fill="url(#b)"/>${rings({ cap: 'round', a: '#fff', b: '#fff', c: '#fff' }, 7.5)}<circle cx="50" cy="50" r="8" fill="#fff"/><circle cx="52.5" cy="47.5" r="2.6" fill="#0a6fb8"/>` }
};

const browser = await launch();
const page = await browser.newPage({ viewport: { width: 180, height: 180 } });
for (const [look, def] of Object.entries(LOOKS)) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="180" height="180">${def.svg}</svg>`;
  await page.setContent(`<body style="margin:0;background:#000">${svg}</body>`);
  await page.screenshot({ path: path.join(iconDir, `${look}.png`), clip: { x: 0, y: 0, width: 180, height: 180 } });
  fs.writeFileSync(path.join(manDir, `${look}.webmanifest`), JSON.stringify({
    name: 'Relay Remote', short_name: 'Relay', description: 'Talk to Relay on your Mac from your phone.',
    start_url: '/', display: 'standalone', orientation: 'any',
    background_color: def.bg, theme_color: def.bg,
    icons: [{ src: `/icons/${look}.png`, sizes: '180x180', type: 'image/png' }]
  }, null, 2) + '\n');
}
await browser.close();
console.log('phone icons and manifests written for', Object.keys(LOOKS).join(', '));
