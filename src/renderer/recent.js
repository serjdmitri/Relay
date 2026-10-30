/* global relay */
// The Recent menu's page. Everything that comes from history goes in with textContent.
const list = document.getElementById('list');
const count = document.getElementById('count');
const glass = document.getElementById('glass');
const MAX = 14;

const ago = (ts) => {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86400)}d`;
};

function render(history) {
  // This menu repeats requests: never turn an uncertain scheduled action into an
  // accidental second attempt. Its outcome remains available in History.
  const items = (history || []).filter((h) => h.text && !['unknown', 'missed', 'resolved'].includes(h.status) && !/^Checking your progress$/.test(h.text)).slice(0, MAX);
  list.replaceChildren();
  count.textContent = items.length ? `${items.length}` : '';
  if (!items.length) {
    const e = document.createElement('div');
    e.className = 'empty';
    e.textContent = 'Nothing yet. Hold Right ⌥ and ask.';
    list.append(e);
    return;
  }
  items.forEach((h, i) => {
    const it = document.createElement('div');
    it.className = `item ${h.status === 'stopped' ? 'stopped' : h.status === 'failed' ? 'failed' : ''}`.trim();
    it.style.setProperty('--i', String(i));
    const t = document.createElement('div'); t.className = 't'; t.textContent = ago(h.ts);
    const q = document.createElement('div'); q.className = 'q'; q.textContent = h.text;
    const a = document.createElement('div'); a.className = 'a'; a.textContent = h.reply || '';
    it.append(t, q, a);
    it.onclick = () => { relay.recentAsk(h.text); };
    list.append(it);
  });
}

// The glass is one shape: the panel plus a curved flare above and below its left side. The clip and the faint outline are drawn for its current size.
const R = 22; // the flares
const C = 28; // the panel's far corners
const outpath = document.getElementById('outpath');
function shape() {
  const w = glass.offsetWidth; const t = glass.offsetHeight;
  if (!w || !t) return;
  const d = `M0 0A${R} ${R} 0 0 0 ${R} ${R}H${w - C}A${C} ${C} 0 0 1 ${w} ${R + C}V${t - R - C}A${C} ${C} 0 0 1 ${w - C} ${t - R}H${R}A${R} ${R} 0 0 0 0 ${t}`;
  glass.style.clipPath = `path('${d}Z')`;
  outpath.setAttribute('d', d); // open: no line along the screen edge
}
new ResizeObserver(shape).observe(glass);

async function refresh() {
  try { render((await relay.getState()).history); } catch {}
  shape();
  relay.recentSize?.(glass.offsetHeight - 2 * R); // the panel itself, without the flares
}

relay.onRecent((m) => {
  if (m === 'show') { document.body.classList.remove('hide'); refresh().then(() => requestAnimationFrame(() => document.body.classList.add('show'))); }
  else { document.body.classList.add('hide'); setTimeout(() => document.body.classList.remove('show'), 300); }
});
relay.onStateChanged(() => refresh());
glass.addEventListener('mouseenter', () => relay.recentHit?.(true));
glass.addEventListener('mouseleave', () => relay.recentHit?.(false));
glass.addEventListener('mousemove', (e) => {
  glass.style.setProperty('--mx', `${e.clientX}px`);
  glass.style.setProperty('--my', `${e.clientY}px`);
});
refresh();
