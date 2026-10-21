const ICONS = {
  home: '<path d="M4 11l8-7 8 7"/><path d="M6 10v9h4v-5h4v5h4v-9"/>',
  history: '<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/>',
  routines: '<rect x="5" y="6" width="14" height="14" rx="3"/><path d="M10 10v6l5-3z" fill="#fff"/><path d="M9 3h6"/>',
  vocab: '<rect x="5" y="4" width="14" height="16" rx="2"/><path d="M9.5 15l2.5-7 2.5 7M10.4 13h3.2"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1"/>',
  model: '<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3"/>',
  command: '<path d="M9 9V6.5A2.5 2.5 0 106.5 9H9zm0 0h6m-6 0v6m6-6V6.5A2.5 2.5 0 1117.5 9H15zm0 0v6m0 0h2.5a2.5 2.5 0 11-2.5 2.5V15zm0 0H9m0 0v2.5A2.5 2.5 0 116.5 15H9z"/>',
  shield: '<path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z"/><rect x="9.5" y="10.5" width="5" height="4.5" rx="1" fill="#fff"/><path d="M10.5 10.5V9a1.5 1.5 0 013 0v1.5"/>',
  wave: '<path d="M4 12v0M8 8v8M12 5v14M16 8v8M20 12v0"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0014 0M12 18v3"/>',
  keyboard: '<rect x="3" y="6" width="18" height="12" rx="2.5"/><path d="M7 10h.01M10 10h.01M13 10h.01M16 10h.01M7 14h10"/>',
  laptop: '<rect x="5" y="5" width="14" height="10" rx="1.5"/><path d="M3 19h18"/>',
  chip: '<rect x="7" y="7" width="10" height="10" rx="2"/><path d="M10 4v3M14 4v3M10 17v3M14 17v3M4 10h3M4 14h3M17 10h3M17 14h3"/>',
  record: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.2" fill="currentColor"/>',
  chat: '<path d="M4 6a2 2 0 012-2h12a2 2 0 012 2v8a2 2 0 01-2 2h-7l-4 4v-4H6a2 2 0 01-2-2z"/>',
  undo: '<path d="M9 7L4 12l5 5"/><path d="M4 12h9a6 6 0 010 12"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  warn: '<path d="M12 4l9 16H3z"/><path d="M12 10v5M12 17.5v.01"/>'
};
const icon = (name) => `<svg viewBox="0 0 24 24">${ICONS[name]}</svg>`;

// Original mark: concentric relay rings and a dot on a dark squircle.
const LOGO = `<svg viewBox="0 0 100 100"><defs><linearGradient id="lg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6a6a6a"/><stop offset="1" stop-color="#3f3f3f"/></linearGradient></defs>
<rect x="4" y="4" width="92" height="92" rx="22" fill="url(#lg)"/>
<g fill="none" stroke="#f1f1f1" stroke-linecap="round"><path d="M50 18a32 32 0 1 1-30 21" stroke-width="5"/><path d="M50 30a20 20 0 1 1-18 13" stroke-width="5" opacity=".8"/><path d="M50 42a8 8 0 1 1-6 5" stroke-width="5" opacity=".6"/></g><circle cx="50" cy="50" r="3.6" fill="#f1f1f1"/></svg>`;

const COLORS = { home: '#2f7cf6', history: '#5e5ce6', routines: '#a24ad8', vocab: '#2d6cf0', general: '#7f8a9c', model: '#1f8bd6', shortcuts: '#2e6cf3', permissions: '#2d6cf3' };

function h(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
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
