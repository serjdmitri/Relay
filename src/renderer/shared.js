// Stroke icons for content areas (colour comes from currentColor).
const ICONS = {
  wave: '<path d="M3 12v0M7 8.5v7M11 5v14M15 8v8M19 10.5v3M21.5 12v0"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0013 0M12 17.5V21"/>',
  keyboard: '<rect x="2.5" y="6" width="19" height="12" rx="2.5"/><path d="M6 10h.01M9 10h.01M12 10h.01M15 10h.01M18 10h.01M6 13.5h.01M18 13.5h.01M9 14h6"/>',
  command: '<path d="M9 9V6.5A2.5 2.5 0 106.5 9H9zm0 0h6m-6 0v6m6-6V6.5A2.5 2.5 0 1117.5 9H15zm0 0v6m0 0h2.5a2.5 2.5 0 11-2.5 2.5V15zm0 0H9m0 0v2.5A2.5 2.5 0 116.5 15H9z"/>',
  record: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.2" fill="currentColor"/>',
  chat: '<path d="M4 6a2 2 0 012-2h12a2 2 0 012 2v8a2 2 0 01-2 2h-7l-4 4v-4H6a2 2 0 01-2-2z"/>',
  undo: '<path d="M9 7L4 12l5 5"/><path d="M4 12h9a6 6 0 010 12" transform="translate(0 -5)"/>',
  chip: '<rect x="7" y="7" width="10" height="10" rx="2"/><path d="M10 4v3M14 4v3M10 17v3M14 17v3M4 10h3M4 14h3M17 10h3M17 14h3"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8 10.5V8a4 4 0 018 0v2.5"/>',
  headphones: '<path d="M4 15v-3a8 8 0 0116 0v3"/><rect x="3" y="14" width="4" height="6" rx="2"/><rect x="17" y="14" width="4" height="6" rx="2"/>',
  copy: '<rect x="8.5" y="8.5" width="11" height="11" rx="2.5"/><path d="M15.5 8.5V6.5a2 2 0 00-2-2h-7a2 2 0 00-2 2v7a2 2 0 002 2h2"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>',
  download: '<path d="M12 4v11M7.5 11l4.5 4.5 4.5-4.5M5 20h14"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  warn: '<path d="M12 4l9 16H3z"/><path d="M12 10v5M12 17.5v.01"/>'
};
const icon = (name) => `<svg viewBox="0 0 24 24">${ICONS[name]}</svg>`;

// Filled glyphs for the sidebar's coloured tiles. White on the tile colour, like SF Symbols.
// `--bc` (the tile colour) is used to cut details out of a glyph.
const GLYPHS = {
  home: '<path fill="#fff" d="M12 3 2.6 11.3a.8.8 0 00.5 1.4H5V20a1.5 1.5 0 001.5 1.5H9.6v-5.2h4.8v5.2h3.1A1.5 1.5 0 0019 20v-7.3h1.9a.8.8 0 00.5-1.4z"/>',
  history: '<circle cx="12" cy="12" r="9" fill="#fff"/><path d="M12 7v5.2l3.4 2" fill="none" stroke="var(--bc)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  routines: '<rect x="8" y="2.8" width="8" height="2.2" rx="1.1" fill="#fff" opacity=".75"/><rect x="5" y="6.2" width="14" height="15" rx="3" fill="#fff"/><path d="M10.2 10.6v6.6l5.3-3.3z" fill="var(--bc)"/>',
  vocab: '<path fill="#fff" d="M7 3.5h10A1.5 1.5 0 0118.5 5v14.2a1.3 1.3 0 01-1.3 1.3H7A2 2 0 015 18.5V5.5a2 2 0 012-2z"/><path d="M9.2 15.2l2.8-7.2 2.8 7.2M10.2 13h3.6" fill="none" stroke="var(--bc)" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>',
  memory: '<path fill="#fff" d="M7 3.2h10a1.2 1.2 0 011.2 1.2V21l-6.2-4.3L5.8 21V4.4A1.2 1.2 0 017 3.2z"/>',
  remote: '<g fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="7" y="2.8" width="10" height="18.4" rx="2.4"/><path d="M10.5 18h3"/></g>',
  connectors: '<g fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 7V3.5M15 7V3.5M7 7h10v4.5a5 5 0 01-5 5 5 5 0 01-5-5z"/><path d="M12 16.5V21"/></g>',
  general: '<g fill="#fff"><circle cx="12" cy="12" r="6.6"/><rect x="10.4" y="2.6" width="3.2" height="18.8" rx="1.2"/><rect x="10.4" y="2.6" width="3.2" height="18.8" rx="1.2" transform="rotate(45 12 12)"/><rect x="10.4" y="2.6" width="3.2" height="18.8" rx="1.2" transform="rotate(90 12 12)"/><rect x="10.4" y="2.6" width="3.2" height="18.8" rx="1.2" transform="rotate(135 12 12)"/></g><circle cx="12" cy="12" r="2.9" fill="var(--bc)"/>',
  speech: '<g stroke="#fff" stroke-width="1.9" stroke-linecap="round"><path d="M4 11v2M7 8.5v7M10 5v14M13 7.5v9M16 5.5v13M19 9v6M21 11.5v1"/></g>',
  shortcuts: '<g fill="none" stroke="#fff" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M9 9V6.5A2.5 2.5 0 106.5 9H9zm0 0h6m-6 0v6m6-6V6.5A2.5 2.5 0 1117.5 9H15zm0 0v6m0 0h2.5a2.5 2.5 0 11-2.5 2.5V15zm0 0H9m0 0v2.5A2.5 2.5 0 116.5 15H9z"/></g>',
  permissions: '<path fill="#fff" d="M12 2.8 4.6 5.6v6c0 4.6 3 8.3 7.4 9.9 4.4-1.6 7.4-5.3 7.4-9.9v-6z"/><rect x="9" y="10.8" width="6" height="5" rx="1.2" fill="var(--bc)"/><path d="M10.2 10.8V9.4a1.8 1.8 0 013.6 0v1.4" fill="none" stroke="var(--bc)" stroke-width="1.5"/>',
  mic: '<rect x="9" y="3.2" width="6" height="11.2" rx="3" fill="#fff"/><path d="M5.6 11.2a6.4 6.4 0 0012.8 0M12 17.6v3.2" fill="none" stroke="#fff" stroke-width="1.9" stroke-linecap="round"/>',
  accessibility: '<circle cx="12" cy="12" r="9.4" fill="#fff"/><circle cx="12" cy="7.6" r="1.7" fill="var(--bc)"/><path d="M7 10.2l5 1 5-1M12 11.2v3.4M9.6 18l2.4-3.4 2.4 3.4" fill="none" stroke="var(--bc)" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>',
  screen: '<rect x="3.2" y="5" width="17.6" height="11.6" rx="2" fill="none" stroke="#fff" stroke-width="1.8" stroke-dasharray="3 2"/><circle cx="12" cy="10.8" r="2.4" fill="#fff"/><path d="M8 20h8" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/>',
  input: '<rect x="2.8" y="6" width="18.4" height="12" rx="2.4" fill="#fff"/><path d="M6.4 10h.01M9.4 10h.01M12.4 10h.01M15.4 10h.01M18 10h.01M8.5 14h7" stroke="var(--bc)" stroke-width="1.8" stroke-linecap="round"/>',
  account: '<circle cx="12" cy="12" r="9.2" fill="#fff"/><circle cx="12" cy="9.6" r="3.1" fill="var(--bc)"/><path d="M5.8 18.2c1.2-2.6 3.4-3.8 6.2-3.8s5 1.2 6.2 3.8A9 9 0 0112 21.2a9 9 0 01-6.2-3z" fill="var(--bc)"/>'
};
const glyph = (name) => `<svg viewBox="0 0 24 24">${GLYPHS[name]}</svg>`;

// Original mark: concentric relay rings and a dot on a dark squircle.
const LOGO = `<svg viewBox="0 0 100 100"><defs><linearGradient id="rl-bg" x1="7" y1="4" x2="93" y2="96" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#0b2236"/><stop offset=".5" stop-color="#0f4a75"/><stop offset="1" stop-color="#1c8fd6"/></linearGradient><radialGradient id="rl-sh" cx=".3" cy=".1" r=".8"><stop offset="0" stop-color="#fff" stop-opacity=".38"/><stop offset=".6" stop-color="#fff" stop-opacity="0"/></radialGradient><linearGradient id="rl-ar" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#bfeaff"/></linearGradient><radialGradient id="rl-gl"><stop offset="0" stop-color="#4cc2ff" stop-opacity=".8"/><stop offset="1" stop-color="#4cc2ff" stop-opacity="0"/></radialGradient><radialGradient id="rl-dt" cx=".5" cy=".4" r=".6"><stop offset="0" stop-color="#e6f8ff"/><stop offset="1" stop-color="#4cc2ff"/></radialGradient></defs>
<rect x="3.1" y="3.1" width="93.8" height="93.8" rx="22.7" fill="url(#rl-bg)"/><rect x="3.1" y="3.1" width="93.8" height="93.8" rx="22.7" fill="url(#rl-sh)"/>
<g fill="none" stroke-linecap="round" stroke-width="5.5"><path d="M50 17.19A32.81 32.81 0 1 1 31.18 23.12" stroke="url(#rl-ar)"/><path d="M50 28.12A21.88 21.88 0 1 1 37.45 32.08" stroke="#fff" stroke-opacity=".78"/><path d="M50 38.67A11.33 11.33 0 1 1 43.50 40.72" stroke="#fff" stroke-opacity=".55"/></g><circle cx="50" cy="50" r="9" fill="url(#rl-gl)"/><circle cx="50" cy="50" r="3.9" fill="url(#rl-dt)"/></svg>`;

// Every page has its own colour pair: it tints the tile, the selected item, buttons, toggles and the glow behind the page.
const THEME = {
  home: ['#1c8fd6', '#4cc2ff'], history: ['#2a9ee0', '#5fb4ff'], routines: ['#1f86cf', '#3fb6e8'], vocab: ['#2aa5d8', '#58cdf0'], memory: ['#2490d4', '#58cdf0'], connectors: ['#2a9ee0', '#4cc2ff'], remote: ['#2490d4', '#4cc2ff'],
  general: ['#2490d4', '#4cc2ff'], speech: ['#2aa5d8', '#4cc2ff'], shortcuts: ['#1f86cf', '#4cc2ff'], permissions: ['#2a9ee0', '#4cc2ff'], account: ['#1c8fd6', '#5fb4ff']
};
const COLORS = Object.fromEntries(Object.entries(THEME).map(([id, [a]]) => [id, a]));
const GRAD = Object.fromEntries(Object.entries(THEME).map(([id, [a, b]]) => [id, `linear-gradient(135deg, ${a}, ${b})`]));

function h(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  if (t.content.children.length > 1) { // several elements: kept together (the old code silently dropped all but the first: the pairing code, the Shortcut key and the secure address were never shown)
    const w = document.createElement('div');
    w.style.display = 'contents';
    w.append(t.content);
    return w;
  }
  return t.content.firstElementChild;
}

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function timeAgo(ts) {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} minute${m === 1 ? '' : 's'} ago`;
  const hr = Math.round(m / 60);
  if (hr < 24) return `${hr} hour${hr === 1 ? '' : 's'} ago`;
  const d = Math.round(hr / 24);
  return `${d} day${d === 1 ? '' : 's'} ago`;
}

// Convert a DOM keyboard capture into a stored shortcut definition.
const MOD_CODES = ['AltLeft', 'AltRight', 'ControlLeft', 'ControlRight', 'ShiftLeft', 'ShiftRight', 'MetaLeft', 'MetaRight'];
function modsFromEvent(e) {
  return [e.altKey && 'Alt', e.ctrlKey && 'Control', e.shiftKey && 'Shift', e.metaKey && 'Meta'].filter(Boolean);
}
