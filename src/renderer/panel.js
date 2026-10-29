// One live panel's page. Relay sends the numbers; fixed panels draw them here, plugin panels show the plugin's text, and a model-built panel
// is shown in an isolated frame (no scripts from outside, only the hosts you approved) that is handed the same numbers by message.
const id = new URLSearchParams(location.search).get('id') || '';
const body = document.getElementById('body');
const LABEL = { cpu: 'CPU', memory: 'Memory', battery: 'Battery', network: 'Network', disk: 'Disk', jobs: 'Working on' };
let spec = null;
let frame = null;
const rows = {};

const meter = (key, label) => {
  const el = document.createElement('div');
  el.className = 'm';
  el.innerHTML = '<div class="l"><span></span><span class="v"></span></div><div class="bar"><i></i></div>';
  el.firstChild.firstChild.textContent = label;
  body.append(el);
  return { v: el.querySelector('.v'), bar: el.querySelector('i') };
};

function draw(data) {
  if (data.error) { body.textContent = ''; const e = document.createElement('div'); e.className = 'err'; e.textContent = data.error; body.append(e); return; }
  if (spec.kind === 'plugin') { body.textContent = ''; const p = document.createElement('pre'); p.textContent = data.text || ''; body.append(p); return; }
  for (const key of spec.sources) {
    const d = data[key];
    if (!d) continue;
    if (key === 'dashboard') {
      rows.dashboard ||= (() => { const el = document.createElement('div'); body.append(el); return el; })();
      const root = rows.dashboard; root.replaceChildren();
      const section = (title, lines) => { const head = document.createElement('div'); head.className = 'l'; head.textContent = title; root.append(head); for (const text of lines) { const el = document.createElement('div'); el.className = 'job'; el.textContent = text; root.append(el); } };
      section('Tasks', d.tasks.length ? d.tasks.map(t => `${t.text} · ${t.status}`) : ['Nothing running.']);
      section('Calendar', d.events.length ? d.events.map(e => `${new Date(e.start).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} · ${e.title}`) : [d.calendarChecked ? 'No upcoming events today.' : 'Calendar not available yet.']);
      section('Timers', d.timers.length ? d.timers.map(t => `${t.label} · ${Math.ceil(t.seconds / 60)} min`) : ['No timers.']);
      section('Recent', d.recent.length ? d.recent.map(r => `${r.text} · ${r.status}`) : ['Nothing yet.']);
      continue;
    }
    if (key === 'jobs') {
      rows.jobs ||= (() => { const el = document.createElement('div'); body.append(el); return el; })();
      rows.jobs.textContent = '';
      if (!d.jobs.length) { const j = document.createElement('div'); j.className = 'job'; j.textContent = 'Nothing right now.'; rows.jobs.append(j); }
      for (const j of d.jobs) { const el = document.createElement('div'); el.className = 'job'; el.textContent = j.text; const s = document.createElement('small'); s.textContent = ` ${j.status}`; el.append(s); rows.jobs.append(el); }
      continue;
    }
    rows[key] ||= meter(key, LABEL[key]);
    const r = rows[key];
    if (key === 'network') { r.v.textContent = `↓ ${d.downKBs} KB/s  ↑ ${d.upKBs} KB/s`; r.bar.style.width = `${Math.min(100, Math.round((d.downKBs + d.upKBs) / 100))}%`; }
    else if (key === 'battery') { r.v.textContent = d.present ? `${d.percent}%${d.charging ? ' charging' : ''}` : 'No battery'; r.bar.style.width = `${d.present ? d.percent : 0}%`; }
    else if (key === 'disk') { r.v.textContent = d.present ? `${d.freeGb} GB free` : '—'; r.bar.style.width = `${d.present ? d.usedPct : 0}%`; }
    else if (key === 'memory') { r.v.textContent = `${d.usedGb} of ${d.totalGb} GB`; r.bar.style.width = `${d.percent}%`; }
    else { r.v.textContent = `${d.percent}%`; r.bar.style.width = `${d.percent}%`; }
  }
}

relay.panelGet(id).then((s) => {
  if (!s) return;
  spec = s;
  document.getElementById('title').textContent = s.title;
  if (s.kind === 'custom') {
    frame = document.createElement('iframe');
    frame.setAttribute('sandbox', 'allow-scripts'); // no same-origin: the page cannot reach Relay, its storage or the files
    frame.srcdoc = s.doc;
    body.style.padding = '0';
    body.append(frame);
  }
});
relay.onPanel((pid, data) => {
  if (pid !== id || !spec) return;
  if (spec.kind === 'custom') {
    const out = {};
    for (const k of spec.sources) if (data[k] !== undefined) out[k] = data[k];
    frame?.contentWindow?.postMessage(out, '*');
  } else draw(data);
});
document.getElementById('x').onclick = () => relay.panelClose(id);
