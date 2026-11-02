const $ = (id) => document.getElementById(id);
let busy = false;
const action = async (name, value) => { const r = await relay.prioritiesAction(name, value); if (r && r.error) throw Error(r.error); return r; };
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

function row(item) {
  const r = el('div', `pitem src-${item.source.toLowerCase()}`);
  const head = el('div', 'ihead'); head.append(el('span', 'badge', item.source), el('span', 'ititle', item.title));
  r.append(head, el('p', 'iwhen', item.when));
  if (item.detail) r.append(el('p', 'idetail', item.detail));
  if (item.canOpen) {
    const b = el('button', 'iopen', item.source === 'Email' ? 'Open email' : item.source === 'School' ? 'Open school page' : `Open ${item.source}`);
    b.onclick = async () => { try { await action('open', item.id); } catch (e) { $('status').textContent = e.message; } };
    r.append(b);
  }
  return r;
}

function render(r) {
  const h = $('headline'); h.className = r.counts.now ? 'g-now' : r.counts.today ? 'g-today' : 'g-ok'; h.textContent = r.headline;
  $('weather').textContent = r.weather || ''; $('weather').hidden = !r.weather;
  $('groups').replaceChildren(...['now', 'today', 'soon', 'later'].filter((g) => r.counts[g]).map((g) => {
    const sec = el('section', `group g-${g}`); sec.append(el('h3', '', `${r.groups[g]} (${r.counts[g]})`));
    for (const i of r.items.filter((x) => x.group === g)) sec.append(row(i));
    return sec;
  }));
  const down = r.sources.filter((s) => s.state !== 'ok');
  $('sources').querySelector('summary').textContent = down.length ? `${r.sources.length - down.length} of ${r.sources.length} sources checked, ${down.length} not` : `All ${r.sources.length} sources checked`;
  $('sourceList').replaceChildren(...r.sources.map((s) => el('p', s.state === 'ok' ? 'okline' : 'unkline', `${s.state === 'ok' ? '✓' : '✗'} ${s.name}${s.note ? `: ${s.note}` : s.state === 'ok' ? '' : ': not available or not set up'}`)));
  $('sources').open = down.length > 0;
  $('stamp').textContent = `Checked ${new Date(r.at).toLocaleTimeString()}`;
  $('status').textContent = 'Ranked from what the checked sources say. Dates the page did not state exactly are shown as written.';
}

async function load(name) {
  if (busy) return;
  busy = true; $('run').disabled = true;
  if (name === 'rerun') $('status').textContent = 'Checking your calendar, reminders, school and email…';
  try { render(await action(name)); } catch (e) { $('status').textContent = `Could not build the list: ${e.message}`; } finally { busy = false; $('run').disabled = false; }
}
$('run').onclick = () => load('rerun');
$('x').onclick = () => action('close');
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') action('close'); });
load('run');
