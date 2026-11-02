const $ = (id) => document.getElementById(id);
let busy = false, data = null;
const action = async (name) => { const r = await relay.assignmentsAction(name); if (r && r.error) throw Error(r.error); return r; };
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const NO_CLASS = '__none';

// The same rules as the filter in assignments.js, applied to what the page already holds.
function visible() {
  const course = $('f-course').value, due = $('f-due').value, priority = $('f-priority').value, q = $('f-query').value.trim().toLowerCase();
  return data.items.filter((r) => (course === 'all' || (course === NO_CLASS ? !r.course : r.course === course))
    && (due === 'all' || (due === 'soon' ? ['overdue', 'today', 'week'].includes(r.bucket) : r.bucket === due))
    && (priority === 'all' || r.priority === priority)
    && (!q || `${r.title} ${r.course}`.toLowerCase().includes(q)));
}

function row(r) {
  const d = el('div', `arow pri-${r.priority} bucket-${r.bucket}`);
  const head = el('div', 'ahead'); head.append(el('span', 'abadge', r.priorityLabel), el('span', 'atitle', r.title)); d.append(head);
  d.append(el('p', 'ameta', `${r.when}${r.course ? ` · ${r.course}` : ' · No class listed'}${r.dueDate && r.dueDate !== r.due ? ` · ${r.dueDate}` : ''}`));
  if (r.note) d.append(el('p', 'anote', r.note));
  if (data.sourceUrl) { const b = el('button', 'alink', 'Open source'); b.title = 'Opens your school assignment page in Firefox'; b.onclick = async () => { try { await action('open-source'); } catch (e) { $('status').textContent = e.message; } }; d.append(b); }
  return d;
}

function renderList() {
  const list = visible();
  $('list').replaceChildren(...(list.length ? list.map(row) : [el('p', 'aempty', data.items.length ? 'Nothing matches these filters.' : 'No assignments yet. Press Refresh to read your school page.')]));
  $('summary').textContent = data.items.length ? `Showing ${list.length} of ${data.items.length} · ${data.counts.overdue} overdue · ${data.counts.today} due today · ${data.counts.week} in the next week · ${data.counts.nodate} without a readable date` : '';
}

function render(r) {
  data = r;
  const keep = $('f-course').value;
  $('f-course').replaceChildren(...[['all', 'All classes'], ...r.courses.map((c) => [c, c]), [NO_CLASS, 'No class listed']].map(([v, t]) => { const o = el('option', '', t); o.value = v; return o; }));
  $('f-course').value = [...$('f-course').options].some((o) => o.value === keep) ? keep : 'all';
  $('stamp').textContent = r.checkedAt ? `${r.fromCache ? 'Last checked' : 'Checked'} ${new Date(r.checkedAt).toLocaleString()}` : '';
  $('status').textContent = r.problem ? `${r.problem}${r.items.length ? ' Showing the last result.' : ''}` : r.truncated ? 'The page was long, so this list may be incomplete. Filters on the school page can also hide assignments.' : 'Only what the visible school page shows; filters or unloaded sections on it can hide some assignments.';
  renderList();
}

async function load(name) {
  if (busy) return;
  busy = true; $('refresh').disabled = true;
  if (name === 'refresh') $('status').textContent = 'Reading your school page… this can take up to 15 seconds.';
  try { render(await action(name)); } catch (e) { $('status').textContent = `Could not load: ${e.message}`; } finally { busy = false; $('refresh').disabled = false; }
}
for (const id of ['f-course', 'f-due', 'f-priority']) $(id).onchange = () => data && renderList();
$('f-query').oninput = () => data && renderList();
$('refresh').onclick = () => load('refresh');
$('source').onclick = async () => { try { await action('open-source'); } catch (e) { $('status').textContent = e.message; } };
$('x').onclick = () => action('close');
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') action('close'); });
load('load');
