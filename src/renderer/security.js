const $ = (id) => document.getElementById(id);
let busy = false;
const action = async (name) => { const r = await relay.securityAction(name); if (r && r.error) throw Error(r.error); return r; };
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const LABEL = { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low', info: 'Note' };

function finding(x) {
  const d = el('details', `finding sev-${x.severity}`);
  d.open = x.severity === 'critical' || x.severity === 'high';
  const s = el('summary'); s.append(el('span', 'badge', LABEL[x.severity]), el('span', 'ftitle', x.title)); d.append(s);
  if (x.detail) d.append(el('p', 'why', x.detail));
  if (x.fix) d.append(el('p', 'fix', `Fix: ${x.fix}`));
  return d;
}

function render(r) {
  const bad = r.counts.critical + r.counts.high, review = r.counts.medium + r.counts.low;
  const v = $('verdict'); v.className = bad ? 'sev-high' : review ? 'sev-medium' : 'sev-ok';
  v.textContent = bad ? `${bad} thing${bad === 1 ? ' is' : 's are'} at serious risk. Fix those first.` : review ? `Nothing serious, but ${review} thing${review === 1 ? '' : 's'} worth reviewing.` : 'Nothing at risk was found.';
  $('counts').replaceChildren(...['critical', 'high', 'medium', 'low', 'info'].filter((k) => r.counts[k]).map((k) => el('span', `chip sev-${k}`, `${r.counts[k]} ${LABEL[k]}`)), el('span', 'chip sev-ok', `${r.passed.length} OK`), ...(r.notChecked.length ? [el('span', 'chip sev-unknown', `${r.notChecked.length} not checked`)] : []));
  const rank = (key) => Math.max(-1, ...r.findings.filter((x) => x.area === key && x.severity !== 'info').map((x) => ['low', 'medium', 'high', 'critical'].indexOf(x.severity)));
  $('areas').replaceChildren(...Object.entries(r.areas).sort((a, b) => rank(b[0]) - rank(a[0])).map(([key, name]) => {
    const here = r.findings.filter((x) => x.area === key), sec = el('section', 'area');
    const worst = here.find((x) => x.severity !== 'info');
    sec.append(el('h3', '', name), el('p', `areastate ${worst ? `sev-${worst.severity}` : 'sev-ok'}`, here.length ? `${here.length} to look at` : 'All clear'));
    for (const x of here) sec.append(finding(x));
    return sec;
  }));
  $('passed').querySelector('summary').textContent = `${r.passed.length} checks passed`;
  $('passedList').replaceChildren(...r.passed.map((p) => el('p', 'okline', `✓ ${p.title}`)));
  $('unknown').hidden = !r.notChecked.length;
  $('unknown').querySelector('summary').textContent = `${r.notChecked.length} could not be checked (not counted as safe)`;
  $('unknownList').replaceChildren(...r.notChecked.map((p) => el('p', 'unkline', `${p.title}: ${p.detail || ''}`)));
  $('stamp').textContent = `Checked ${new Date(r.at).toLocaleTimeString()}`;
  $('status').textContent = r.summary;
}

async function load(name) {
  if (busy) return;
  busy = true; $('run').disabled = true; $('copy').disabled = true;
  if (name === 'rerun') $('status').textContent = 'Checking this Mac…';
  try { render(await action(name)); } catch (e) { $('status').textContent = `The audit could not run: ${e.message}`; } finally { busy = false; $('run').disabled = false; $('copy').disabled = false; }
}
$('run').onclick = () => load('rerun');
$('copy').onclick = async () => { try { await action('copy'); $('status').textContent = 'Report copied. It lists where problems are, never secret values.'; } catch (e) { $('status').textContent = e.message; } };
$('x').onclick = () => action('close');
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') action('close'); });
load('run');
