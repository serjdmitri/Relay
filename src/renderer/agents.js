const $ = (id) => document.getElementById(id);
let state = null, busy = false, timer = null;
const call = async (name, value) => { const r = await relay.agentsAction(name, value); if (r && r.error) throw Error(r.error); return r; };
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const open = new Set(); // finished results the person expanded, kept across redraws

const mins = (ms) => { const s = Math.max(0, Math.round(ms / 1000)); return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`; };

function runningRow(a) {
  const d = el('div', 'job running');
  d.append(el('div', 'jtask', a.task), el('div', 'jstep', `${a.stopping ? 'Stopping…' : a.step || 'Working'}${a.steps ? ` · ${a.steps} step${a.steps === 1 ? '' : 's'}` : ''} · ${mins(Date.now() - a.startedAt)}`));
  const b = el('button', 'cancel', a.stopping ? 'Stopping' : 'Cancel'); b.disabled = !!a.stopping;
  b.onclick = async () => { b.disabled = true; try { await call('cancel', a.id); } catch (e) { $('status').textContent = e.message; } refresh(); };
  d.append(b); return d;
}

function queuedRow(q) {
  const d = el('div', 'job queued');
  d.append(el('div', 'jtask', q.task), el('div', 'jstep', `Waiting, number ${q.position} in line`));
  const b = el('button', 'cancel', 'Remove'); b.onclick = async () => { b.disabled = true; try { await call('cancel', q.id); } catch (e) { $('status').textContent = e.message; } refresh(); };
  d.append(b); return d;
}

function finishedRow(f) {
  const d = el('details', `job fin st-${f.status}`); d.open = open.has(f.id);
  d.ontoggle = () => { if (d.open) open.add(f.id); else open.delete(f.id); };
  const sum = el('summary'); sum.append(el('span', 'badge', f.status === 'done' ? 'Done' : f.status === 'stopped' ? 'Stopped' : 'Failed'), el('span', 'jtask', f.task), el('span', 'jstep', mins(f.endedAt - f.startedAt))); d.append(sum);
  d.append(el('pre', 'jresult', f.result || 'No answer was returned.'));
  const c = el('button', 'cancel', 'Copy result'); c.onclick = async () => { try { await relay.copyText(`${f.task}\n\n${f.result}`); $('status').textContent = 'Result copied.'; } catch { $('status').textContent = 'Could not copy.'; } };
  d.append(c); return d;
}

function render(s) {
  state = s;
  const foreground = $('foreground');
  foreground.replaceChildren();
  if (s.foreground) {
    const f = s.foreground, row = el('div', 'job running');
    row.append(el('div', 'jtask', f.text), el('div', 'jstep', `${f.status}${f.queued ? ` · ${f.queued} request(s) waiting` : ''}`));
    const stop = el('button', 'cancel', f.queued ? 'Stop request and queue' : 'Stop request');
    stop.onclick = async () => { stop.disabled = true; try { const r = await call('stop-foreground', f.id); if (!r.stopped) $('status').textContent = 'That request is no longer running.'; } catch (e) { $('status').textContent = e.message; } refresh(); };
    row.append(stop); foreground.append(row);
  } else foreground.append(el('p', 'empty', 'No foreground request is running.'));
  $('h-running').textContent = `Running (${s.running.length} of ${s.max})`;
  $('running').replaceChildren(...(s.running.length ? s.running.map(runningRow) : [el('p', 'empty', 'Nothing is running.')]));
  $('h-queued').hidden = !s.queued.length; $('queued').replaceChildren(...s.queued.map(queuedRow));
  $('finished').replaceChildren(...(s.finished.length ? s.finished.map(finishedRow) : [el('p', 'empty', 'Nothing has finished yet this session.')]));
  $('clear').hidden = !s.finished.length;
  $('status').textContent = s.running.length || s.queued.length ? `${s.running.length} running, ${s.queued.length} waiting.` : 'No jobs running. Type some above to start them together.';
}

async function refresh() { try { render(await call('state')); } catch (e) { $('status').textContent = e.message; } }

$('start').onclick = async () => {
  if (busy) return; busy = true; $('start').disabled = true;
  try {
    const r = await call('start', $('jobs').value);
    const started = r.results.filter((x) => x.started).length, queued = r.results.filter((x) => x.queued).length, bad = r.results.filter((x) => x.error);
    $('startnote').textContent = [started && `${started} started`, queued && `${queued} waiting`, bad.length && `${bad.length} not started: ${bad[0].error}`, r.ignored && `${r.ignored} extra line${r.ignored === 1 ? '' : 's'} ignored (10 at most)`].filter(Boolean).join(' · ');
    if (!bad.length) $('jobs').value = '';
    render(r.state);
  } catch (e) { $('startnote').textContent = e.message; } finally { busy = false; $('start').disabled = false; }
};
$('clear').onclick = async () => { try { render((await call('clear')).state); } catch (e) { $('status').textContent = e.message; } };
$('x').onclick = () => call('close');
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') call('close'); });
timer = setInterval(refresh, 1000); window.addEventListener('beforeunload', () => clearInterval(timer));
refresh();
