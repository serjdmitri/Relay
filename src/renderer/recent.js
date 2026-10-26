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
  const items = (history || []).filter((h) => h.text && !/^Checking your progress$/.test(h.text)).slice(0, MAX);
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

async function refresh() {
  try { render((await relay.getState()).history); } catch {}
}

relay.onRecent((m) => {
  if (m === 'show') { refresh(); requestAnimationFrame(() => requestAnimationFrame(() => document.body.classList.add('show'))); }
  else document.body.classList.remove('show');
});
relay.onStateChanged(() => refresh());
glass.addEventListener('mousemove', (e) => {
  glass.style.setProperty('--mx', `${e.clientX}px`);
  glass.style.setProperty('--my', `${e.clientY}px`);
});
refresh();
