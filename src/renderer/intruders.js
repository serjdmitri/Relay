/* global relay */
// The "who was at your Mac" window: the visits from the intruder log, newest first, with their pictures. Everything here is text set with textContent or an image from the
// log itself; nothing from a visit is ever treated as markup.
const $ = (id) => document.getElementById(id);
const OUTCOME = { 'owner-returned': 'You came back', fingerprint: 'Stopped with your fingerprint', trusted: 'A trusted person arrived', locked: 'Screen locked', ended: 'Alarm ended', ongoing: 'Still going' };
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
const note = (text) => { $('note').textContent = text || ''; $('note').hidden = !text; };

function when(at, now) {
  const d = new Date(at), sameDay = new Date(now).toDateString() === d.toDateString();
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return sameDay ? `Today at ${time}` : `${d.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' })} at ${time}`;
}

async function showPhotos(box, id) {
  box.replaceChildren(el('span', '', 'Loading…'));
  const r = await relay.intrudersPhotos(id);
  box.replaceChildren();
  if (r.error) { box.append(el('span', '', r.error)); return; }
  if (!r.photos.length) box.append(el('span', '', 'The pictures could not be read.'));
  for (const p of r.photos) { const img = el('img'); img.src = p.src; img.alt = 'A picture of the person at your Mac'; img.onclick = () => img.classList.toggle('big'); box.append(img); }
}

function card(v, now, index, byId) {
  const c = el('div', `visit${v.reviewed ? '' : ' fresh'}`);
  const head = el('div', 'head'); head.append(el('span', 'when', when(v.at, now)), el('span', `chip ${v.outcome}`, OUTCOME[v.outcome] || v.outcome));
  if (v.label) head.append(el('span', 'chip same', v.label));
  else if (v.sameAs) head.append(el('span', 'chip same', 'Seen before'));
  c.append(head);
  const earlier = v.sameAs && byId.get(v.sameAs);
  c.append(el('p', 'what', `${v.photos} picture${v.photos === 1 ? '' : 's'}. ${v.outcome === 'locked' ? `I locked the screen after ${v.seconds} seconds.` : ''}${earlier ? ` The same face as the visit on ${new Date(earlier.at).toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' })}.` : ''}`.trim()));
  const shots = el('div', 'shots'); c.append(shots);
  if (index < 4) showPhotos(shots, v.id); else { const b = el('button', 'act', 'Show the pictures'); b.onclick = () => showPhotos(shots, v.id); shots.append(b); }
  const row = el('div', 'row'), name = el('input'); name.placeholder = 'Who is this?'; name.maxLength = 40; name.value = v.label || '';
  const save = el('button', 'act', 'Save name'); save.onclick = async () => { const r = await relay.intrudersLabel(v.id, name.value); note(r.error || ''); if (!r.error) load(); };
  const del = el('button', 'act del', 'Delete'); del.onclick = async () => { note('Confirm with Touch ID to delete this visit…'); const r = await relay.intrudersRemove(v.id); note(r.error || ''); if (!r.error) load(); };
  row.append(name, save, del); c.append(row);
  return c;
}

async function load() {
  const r = await relay.intrudersList();
  if (r.error) { note(r.error); return; }
  const byId = new Map(r.visits.map((v) => [v.id, v]));
  $('list').replaceChildren(...r.visits.map((v, i) => card(v, r.now, i, byId)));
  $('empty').hidden = r.visits.length > 0;
}

$('x').onclick = () => relay.intrudersClose();
addEventListener('keydown', (e) => { if (e.key === 'Escape') relay.intrudersClose(); });
relay.onIntrudersRefresh(() => load());
load();
