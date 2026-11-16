// What your Mac sent with a lid flick: the newest first, each with a preview and Save and Open buttons. It listens to the same event stream as the main page,
// so a new one appears as it is sent, and it asks the Mac for the ones that arrived before this page was opened.
(function () {
  const $ = (id) => document.getElementById(id);
  const token = localStorage.getItem('relay-remote-token') || '';
  if (!token) { location.href = '/'; return; }
  $('page').hidden = false;
  const auth = { authorization: `Bearer ${token}` };
  const shown = new Map(); // id -> { card, url }
  let stream = null;

  const say = (text, bad) => { $('msg').textContent = text || ''; $('msg').className = bad ? 'err' : ''; };
  const size = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} bytes`);
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
  const unpair = () => { try { localStorage.removeItem('relay-remote-token'); } catch { /* it goes back to pairing anyway */ } location.href = '/'; };

  // Save: the share sheet (Save to Files, Save Image) where the phone has one for files, else a download.
  async function save(meta, blob) {
    const file = new File([blob], meta.name || 'From your Mac', { type: blob.type });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file] }); return; } catch (e) { if (e && e.name === 'AbortError') return; }
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = file.name;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 60000);
  }

  async function fill(meta, entry) {
    const { card } = entry;
    const preview = card.querySelector('.lid-preview'), save$ = card.querySelector('[data-save]'), open$ = card.querySelector('[data-open]');
    try {
      const res = await fetch(`/api/lid/${encodeURIComponent(meta.id)}`, { headers: auth });
      if (res.status === 401) return unpair();
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'That is gone.');
      const type = res.headers.get('x-relay-mime') || 'application/octet-stream';
      const blob = new Blob([await res.arrayBuffer()], { type });
      entry.url = URL.createObjectURL(blob);
      if (type.startsWith('image/')) { const img = new Image(); img.alt = meta.name; img.src = entry.url; preview.append(img); }
      else if (type === 'text/plain') { const pre = el('pre'); pre.textContent = (await blob.text()).slice(0, 3000); preview.append(pre); }
      save$.disabled = open$.disabled = false;
      save$.onclick = () => save(meta, blob);
      open$.onclick = () => { window.open(entry.url, '_blank'); }; // the blob is ready, so this is still the tap that opens it
    } catch (e) { preview.append(el('p', 'lid-meta', e.message || 'Could not get that from your Mac.')); }
  }

  function add(meta, fresh) {
    if (!meta || !meta.id || shown.has(meta.id)) return;
    const card = el('article', 'lid-card');
    card.append(el('div', 'lid-name', meta.name || 'From your Mac'), el('div', 'lid-meta', `${size(meta.size || 0)}${meta.at ? ' · ' + new Date(meta.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : ''}`), el('div', 'lid-preview'));
    const actions = el('div', 'lid-actions');
    const saveBtn = el('button', 'lid-btn primary', 'Save'), openBtn = el('button', 'lid-btn', 'Open');
    saveBtn.type = openBtn.type = 'button'; saveBtn.disabled = openBtn.disabled = true;
    saveBtn.dataset.save = openBtn.dataset.open = '';
    actions.append(saveBtn, openBtn); card.append(actions);
    const entry = { card, url: '' };
    shown.set(meta.id, entry);
    $('items').prepend(card);
    $('empty').hidden = true;
    while ($('items').children.length > 5) { const last = $('items').lastElementChild; for (const [id, e] of shown) if (e.card === last) { if (e.url) URL.revokeObjectURL(e.url); shown.delete(id); } last.remove(); }
    if (fresh) { say('Just arrived from your Mac.'); setTimeout(() => say(''), 4000); }
    fill(meta, entry);
  }

  async function load() {
    try {
      const res = await fetch('/api/lid', { headers: auth });
      if (res.status === 401) return unpair();
      for (const m of ((await res.json()).items || []).reverse()) add(m, false);
    } catch { say('Could not reach your Mac.', true); }
  }

  function onEvent(e) {
    if (e.type === 'lid') add(e, true);
    else if (e.type === 'status' && e.look && window.RelayLook) window.RelayLook.apply(e.look, e.mode);
  }

  // The event stream, by fetch (it carries the token in a header). It reconnects by itself.
  async function connect() {
    stream?.abort();
    const ac = new AbortController();
    stream = ac;
    try {
      const res = await fetch('/api/events', { headers: auth, signal: ac.signal });
      if (res.status === 401) return unpair();
      $('conn').className = 'dot on';
      const reader = res.body.getReader(), dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
          const m = chunk.match(/^data: (.*)$/m);
          if (m) { try { onEvent(JSON.parse(m[1])); } catch { /* a line that is not an event */ } }
        }
      }
    } catch { /* it reconnects below */ }
    if (ac.signal.aborted) return;
    $('conn').className = 'dot bad';
    setTimeout(connect, 2500);
  }

  load();
  connect();
})();
