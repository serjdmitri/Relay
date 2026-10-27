// Draws the two README charts from the repository itself: tests by area (counted from test/)
// and lines of code by language. Run: node scripts/make-charts.mjs  (no dependencies)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'docs/img');
fs.mkdirSync(out, { recursive: true });
const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;

const FONT = "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', Helvetica, Arial, sans-serif";
const COLORS = ['#1c8fd6', '#4cc2ff', '#9fdcff', '#2a6f9e', '#7ad4ff', '#0f4a75']; // the app's cyan family, nothing else
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

// ---- tests by area -------------------------------------------------------------------------------------------
const AREAS = {
  'Claude and the agent loop': ['claude', 'loop', 'providers', 'router', 'tools'],
  'Instant commands and timers': ['quick', 'commands', 'timers', 'when'],
  'Mac actions (AppleScript)': ['mac'],
  'Settings, shortcuts, Firefox': ['store', 'shortcuts', 'meta', 'bridge'],
  'Dictation and glass pill': ['speech', 'dictation', 'dictation-history', 'glass']
};
const testFile = (name) => ['.test.js', '.test.mjs'].map((e) => path.join(root, 'test', name + e)).find((f) => fs.existsSync(f));
const count = (name) => {
  const src = fs.readFileSync(testFile(name), 'utf8');
  return (src.match(/^\s*(test|it)\(/gm) || []).length;
};
const known = new Set(Object.values(AREAS).flat());
const unlisted = fs.readdirSync(path.join(root, 'test')).filter((f) => /\.test\.m?js$/.test(f) && !known.has(f.replace(/\.test\.m?js$/, '')));
if (unlisted.length) AREAS['Other'] = unlisted.map((f) => f.replace(/\.test\.m?js$/, ''));
const tests = Object.entries(AREAS).map(([name, files]) => [name, files.reduce((n, f) => n + count(f), 0)]).sort((a, b) => b[1] - a[1]);
const totalTests = tests.reduce((n, [, v]) => n + v, 0);

function testsChart() {
  const W = 600, H = 340, left = 28, labelW = 214, barX = left + labelW, barMax = W - barX - 56;
  const max = Math.max(...tests.map(([, v]) => v));
  const rows = tests.map(([name, v], i) => {
    const y = 104 + i * 38, w = Math.max(6, Math.round((v / max) * barMax));
    return `<text x="${left}" y="${y + 17}" fill="#eef6fb" font-size="14">${esc(name)}</text>
    <rect x="${barX}" y="${y}" width="${w}" height="24" rx="8" fill="url(#g${i})"/>
    <text x="${barX + w + 10}" y="${y + 17}" fill="#fff" font-size="14" font-weight="700">${v}</text>`;
  }).join('\n    ');
  const defs = tests.map((_, i) => `<linearGradient id="g${i}" x1="0" x2="1"><stop offset="0" stop-color="${COLORS[i % COLORS.length]}"/><stop offset="1" stop-color="${COLORS[(i + 1) % COLORS.length]}"/></linearGradient>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Bar chart: ${totalTests} unit tests by area">
  <defs>${defs}<linearGradient id="card" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0f1822"/><stop offset="1" stop-color="#0b1118"/></linearGradient></defs>
  <g font-family="${FONT}">
    <rect width="${W}" height="${H}" rx="20" fill="url(#card)"/>
    <text x="${left}" y="46" fill="#fff" font-size="22" font-weight="700">${totalTests} unit tests</text>
    <text x="${left}" y="70" fill="#9db4c4" font-size="13">by area · counted from test/ · v${esc(version)}</text>
    ${rows}
  </g>
</svg>
`;
}

// ---- lines of code by language ---------------------------------------------------------------------------------
const SKIP = new Set(['node_modules', 'dist', 'shots', '.git']);
const LANG = { '.js': 'JavaScript', '.mjs': 'JavaScript', '.swift': 'Swift', '.html': 'HTML and CSS', '.css': 'HTML and CSS', '.sh': 'Shell' };
const lines = {};
let testLines = 0;
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { walk(p); continue; }
    const lang = LANG[path.extname(e.name)];
    if (!lang) continue;
    const n = fs.readFileSync(p, 'utf8').split('\n').length - 1;
    lines[lang] = (lines[lang] || 0) + n;
    if (p.startsWith(path.join(root, 'test'))) testLines += n;
  }
})(root);
const langs = Object.entries(lines).sort((a, b) => b[1] - a[1]);
const totalLines = langs.reduce((n, [, v]) => n + v, 0);

function codeChart() {
  const W = 600, H = 340, cx = 168, cy = 214, R = 92, r = 58;
  let a0 = -Math.PI / 2;
  const arcs = langs.map(([, v], i) => {
    const a1 = a0 + (v / totalLines) * Math.PI * 2 - 0.03;
    const p = (rad, a) => `${(cx + rad * Math.cos(a)).toFixed(2)} ${(cy + rad * Math.sin(a)).toFixed(2)}`;
    const large = a1 - a0 > Math.PI ? 1 : 0;
    const d = `M${p(R, a0)} A${R} ${R} 0 ${large} 1 ${p(R, a1)} L${p(r, a1)} A${r} ${r} 0 ${large} 0 ${p(r, a0)}Z`;
    a0 += (v / totalLines) * Math.PI * 2;
    return `<path d="${d}" fill="${COLORS[i % COLORS.length]}"/>`;
  }).join('\n    ');
  const legend = langs.map(([name, v], i) => {
    const y = 128 + i * 40;
    return `<rect x="340" y="${y}" width="14" height="14" rx="4" fill="${COLORS[i % COLORS.length]}"/>
    <text x="364" y="${y + 12}" fill="#eef6fb" font-size="15">${esc(name)}</text>
    <text x="572" y="${y + 12}" fill="#fff" font-size="15" font-weight="700" text-anchor="end">${v.toLocaleString('en-US')}</text>`;
  }).join('\n    ');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Donut chart: ${totalLines} lines of code by language">
  <defs><linearGradient id="card" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0f1822"/><stop offset="1" stop-color="#0b1118"/></linearGradient></defs>
  <g font-family="${FONT}">
    <rect width="${W}" height="${H}" rx="20" fill="url(#card)"/>
    <text x="28" y="46" fill="#fff" font-size="22" font-weight="700">${totalLines.toLocaleString('en-US')} lines of code</text>
    <text x="28" y="70" fill="#9db4c4" font-size="13">by language · ${testLines.toLocaleString('en-US')} of them are tests · v${esc(version)}</text>
    ${arcs}
    <text x="${cx}" y="${cy + 6}" fill="#fff" font-size="22" font-weight="700" text-anchor="middle">${langs.length}</text>
    <text x="${cx}" y="${cy + 26}" fill="#9db4c4" font-size="12" text-anchor="middle">languages</text>
    ${legend}
  </g>
</svg>
`;
}

fs.writeFileSync(path.join(out, 'chart-tests.svg'), testsChart());
fs.writeFileSync(path.join(out, 'chart-code.svg'), codeChart());
console.log(`charts written to ${out}: ${totalTests} tests, ${totalLines} lines`);
