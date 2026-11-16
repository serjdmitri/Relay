// The documents Relay wrote, on your phone: the list, one document as page pictures, what a change did (Approve or Reject), a page as a hologram, and pages
// dragged into a new order (which is saved into the document). Pictures are fetched with the phone's token and shown from memory, so the token never goes in an address.

// Where the page being dragged goes: of the other cards' vertical middles (top to bottom), how many are above the finger. 0 = first.
function dropIndex(mids, y) { let n = 0; for (const m of mids) if (y > m) n++; return n; }

// The order after moving the card at `from` so it sits at `to` (both 0-based, `to` counted in the list without it). Returns the old positions in their new order.
function moved(order, from, to) {
  const rest = order.filter((_, i) => i !== from);
  rest.splice(Math.max(0, Math.min(rest.length, to)), 0, order[from]);
  return rest;
}

if (typeof document !== 'undefined') (function () {
  const $ = (id) => document.getElementById(id);
  const token = localStorage.getItem('relay-remote-token') || '';
  if (!token) { location.href = '/'; return; }
  const head = { authorization: `Bearer ${token}` };
  const get = (path) => fetch(path, { headers: head });
  const post = (path, body) => fetch(path, { method: 'POST', headers: { ...head, 'content-type': 'application/json', 'x-relay-remote': '1' }, body: JSON.stringify(body) });
  const id = new URLSearchParams(location.search).get('id');
  const say = (t) => { $('dmsg').textContent = t || ''; };
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
  const unauth = (r) => { if (r.status === 401) { location.href = '/'; return true; } return false; };
  const when = (t) => new Date(t).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const images = new Map(); // key -> object URL

  async function showList() {
    $('dlist').hidden = false;
    const r = await get('/api/documents');
    if (unauth(r)) return;
    const { documents } = await r.json();
    $('dempty').hidden = documents.length > 0;
    $('dtiles').replaceChildren(...documents.map((d) => {
      const li = el('li');
      const t = el('span', '', d.title);
      const s = el('small', '', `${d.pages} page${d.pages === 1 ? '' : 's'}${d.pending ? ' · change waiting' : ''}`);
      if (d.pending) s.className = 'warn';
      li.append(t, s);
      li.onclick = () => { location.href = `/documents.html?id=${encodeURIComponent(d.id)}`; };
      return li;
    }));
  }

  let detail = null, sorting = false;

  async function load() {
    const r = await get(`/api/documents/${encodeURIComponent(id)}`);
    if (unauth(r)) return;
    if (!r.ok) { say((await r.json().catch(() => ({}))).error || 'Could not get that document.'); return; }
    detail = await r.json();
    draw();
  }

  async function picture(i, key) {
    if (images.has(key)) return images.get(key);
    const r = await get(`/api/documents/${encodeURIComponent(id)}/page/${i}.png`);
    if (!r.ok) throw new Error('page');
    const url = URL.createObjectURL(await r.blob());
    images.set(key, url);
    return url;
  }

  function draw() {
    const d = detail;
    $('dview').hidden = false;
    $('dtitle').textContent = d.title;
    $('dwhere').textContent = `${d.pages} page${d.pages === 1 ? '' : 's'} · version ${d.version} · saved in Documents/Relay Documents/${d.folderName}`;
    const pend = $('dpending');
    pend.hidden = !d.pending;
    if (d.pending) {
      $('dpnote').textContent = d.pendingNote;
      $('dchanges').replaceChildren(...d.changes.map((c) => {
        const li = el('li', `chg ${c.type}`);
        li.append(el('div', 'chgh', `${c.type === 'changed' ? 'Changed' : c.type === 'added' ? 'Added' : 'Removed'} on page ${c.page}`));
        if (c.before) li.append(el('div', 'was', c.before));
        if (c.after) li.append(el('div', 'now', c.after));
        return li;
      }));
    }
    $('dsort').disabled = !!d.pending || d.pages < 2;
    $('dsort').title = d.pending ? 'Approve or reject the change first' : '';
    $('dpages').replaceChildren(...d.pageList.map((p) => {
      const li = el('li', 'dpage');
      li.dataset.index = String(p.index);
      const top = el('div', 'dptop');
      const handle = el('button', 'dhandle', '⠿'); handle.type = 'button'; handle.setAttribute('aria-label', `Drag page ${p.index + 1}`);
      const up = el('button', 'dmove', '▲'); up.type = 'button'; up.setAttribute('aria-label', 'Move up');
      const down = el('button', 'dmove', '▼'); down.type = 'button'; down.setAttribute('aria-label', 'Move down');
      const holo = el('button', 'dholo', 'Hologram'); holo.type = 'button';
      top.append(handle, el('span', 'dnum', `Page ${p.index + 1}`), el('span', 'dwarn', p.overflow ? 'runs past the sheet' : ''), up, down, holo);
      const img = el('img'); img.alt = `Page ${p.index + 1}: ${p.excerpt}`; img.loading = 'lazy';
      picture(p.index, p.key).then((u) => { img.src = u; }).catch(() => { img.replaceWith(el('div', 'dim', 'Could not draw this page.')); });
      li.append(top, img);
      up.onclick = () => commit(movedBy(p.index, -1));
      down.onclick = () => commit(movedBy(p.index, 1));
      holo.onclick = () => hologram(p.index);
      handle.addEventListener('pointerdown', (e) => startDrag(e, li, handle));
      return li;
    }));
    $('dvers').replaceChildren(...d.versions.slice().reverse().map((v) => el('li', v.status, `v${v.n} · ${when(v.at)} · ${v.note}${v.status === 'pending' ? ' (waiting)' : v.status === 'rejected' ? ' (rejected)' : ''}`)));
    document.body.classList.toggle('sorting', sorting);
    $('dsort').setAttribute('aria-pressed', String(sorting));
    $('dsort').textContent = sorting ? 'Done' : 'Reorder pages';
    $('dsorthint').hidden = !sorting;
  }

  const movedBy = (i, step) => { const n = detail.pages, to = i + step; if (to < 0 || to >= n) return null; return moved([...Array(n).keys()], i, to); };

  async function commit(order) {
    if (!order) return;
    say('Saving the new order…');
    const r = await post(`/api/documents/${encodeURIComponent(id)}/reorder`, { order });
    if (unauth(r)) return;
    const b = await r.json().catch(() => ({}));
    if (!r.ok) { say(b.error || 'Could not move the pages.'); await load(); return; }
    detail = b; say('Saved.'); draw();
  }

  async function hologram(i) {
    say('Making the hologram on your Mac…');
    const r = await post(`/api/documents/${encodeURIComponent(id)}/hologram`, { page: i + 1 });
    if (unauth(r)) return;
    const b = await r.json().catch(() => ({}));
    if (!r.ok) { say(b.error || 'Could not make the hologram.'); return; }
    location.href = `/holo.html?id=${encodeURIComponent(b.holoId)}`;
  }

  async function review(action) {
    say(action === 'approve' ? 'Keeping the change…' : 'Putting the old pages back…');
    const r = await post(`/api/documents/${encodeURIComponent(id)}/review`, { action });
    if (unauth(r)) return;
    const b = await r.json().catch(() => ({}));
    if (!r.ok) { say(b.error || 'Could not do that.'); return; }
    detail = b; say(action === 'approve' ? 'Kept.' : 'Old version restored.'); draw();
  }

  // Drag by the handle: the card moves through the list under the finger; the new order is sent when it is let go.
  function startDrag(e, li, handle) {
    if (!sorting) return;
    e.preventDefault();
    try { handle.setPointerCapture(e.pointerId); } catch { /* the window listeners below carry the drag anyway */ }
    li.classList.add('dragging');
    const list = $('dpages');
    const lastY = { y: e.clientY };
    // The card is moved in the list while it is dragged, which takes its handle out of the page for a moment and ends its pointer capture; so the drag
    // is followed on the window, which sees every move and the release wherever the finger is.
    const onMove = (ev) => {
      lastY.y = ev.clientY;
      const others = [...list.children].filter((x) => x !== li);
      const mids = others.map((x) => { const b = x.getBoundingClientRect(); return b.top + b.height / 2; });
      const at = dropIndex(mids, ev.clientY);
      const before = others[at] || null;
      if (before !== li.nextElementSibling) list.insertBefore(li, before);
      if (ev.clientY < 90) window.scrollBy(0, -14); else if (ev.clientY > innerHeight - 90) window.scrollBy(0, 14);
    };
    const end = () => {
      for (const t of ['pointermove', 'pointerup', 'pointercancel', 'lostpointercapture']) window.removeEventListener(t, t === 'pointermove' ? onMove : end, true);
      li.classList.remove('dragging');
      const order = [...list.children].map((x) => Number(x.dataset.index));
      if (order.some((v, i) => v !== i)) commit(order);
    };
    window.addEventListener('pointermove', onMove, true);
    for (const t of ['pointerup', 'pointercancel']) window.addEventListener(t, end, true);
  }

  $('dsort').onclick = () => { sorting = !sorting; draw(); };
  $('dapprove').onclick = () => review('approve');
  $('dreject').onclick = () => review('reject');
  $('dtell').addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = $('dtellin').value.trim();
    if (!text) return;
    const r = await post('/api/ask', { text: `About the document "${detail.title}" (id ${detail.id}): ${text}` });
    if (unauth(r)) return;
    $('dtellin').value = '';
    say(r.ok ? 'Sent. Relay will change it, and the change will wait here for you to approve. Pull this page down to refresh.' : 'Could not send that.');
    setTimeout(load, 8000);
  });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && id) load(); });

  if (id) load(); else showList();
})();

if (typeof module !== 'undefined') module.exports = { dropIndex, moved };
