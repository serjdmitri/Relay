// Overnight tasks: work you hand Relay for the night ("tonight, organize my Downloads"). It waits in a list, runs unattended inside the overnight
// window (default 1 to 6 AM) one task at a time, and in the morning Relay reports what happened: what finished, what it could check itself, what
// failed and what needed you. Pure decisions here (the queue, the window, the checks, the report); main.js does the running. Honest by design: a
// result is only "checked" when Relay itself could look (for example that a file is really gone); otherwise it is "done, not independently checked".

const HOUR = 3600e3;
const MAX_TASKS = 20;
const STALE_MS = 6 * HOUR;
const clean = (s, n = 300) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);

// ---- the overnight window ----
const inWindow = (date, { from, to }) => { const h = date.getHours(); return from < to ? h >= from && h < to : h >= from || h < to; };
// The window containing `now`, or the most recent one that has ended: { start, end } in epoch ms.
function windowBounds(now, { from, to }) {
  const day = (d, h) => { const x = new Date(d); x.setHours(h, 0, 0, 0); return x.getTime(); };
  const starts = [-1, 0].map((o) => { const d = new Date(now); d.setDate(d.getDate() + o); return d; });
  const wins = starts.map((d) => { const start = day(d, from); const e = new Date(start); if (to <= from) e.setDate(e.getDate() + 1); e.setHours(to, 0, 0, 0); return { start, end: e.getTime() }; });
  return wins.filter((w) => w.start <= now.getTime()).pop() || wins[0];
}

// ---- what you can say ----
// Without a comma or colon after "tonight"/"overnight", the next word has to be an action, so "overnight oats recipe" is not a task.
const VERB = /^(?:organi[sz]e|clean|tidy|sort|back ?up|make|create|build|write|summari[sz]e|download|move|rename|compress|zip|scan|check|run|update|install|convert|export|import|find|archive|prepare|draft|generate|compile|index|process|rebuild|reorgani[sz]e|study|copy|merge|split|label|tag|resize|transcribe|translate)\b/i;
const NOT_A_TASK = /^(?:what|what's|whats|how|why|when|where|who|is|are|will|would|do|does|did|can|could|should|at|around|by|after|before|remind)\b/i;
function parseOvernightCommand(text) {
  const n = String(text || '').trim().replace(/[“”"]/g, '').replace(/^(?:hey |ok |okay )?(?:relay|jarvis)[, ]+/i, '').replace(/^please /i, '').replace(/\s+/g, ' ');
  if (!n) return null;
  const low = n.toLowerCase().replace(/[.!?]+$/, '');
  if (/^(?:what(?:'s| is) (?:on|in|queued for) (?:tonight(?:'s)?|the overnight|my overnight)(?: list| queue)?|(?:show|list|read)(?: me)?(?: my| the)? (?:tonight(?:'s)?|overnight)(?: list| queue| tasks)|what(?:'s| is) queued(?: for tonight| overnight)?|(?:overnight|tonight(?:'s)?) (?:queue|list|tasks))$/.test(low)) return { type: 'list' };
  if (/^(?:clear|empty|cancel all|remove all)(?: of)?(?: my| the)? (?:tonight(?:'s)?|overnight)(?: list| queue| tasks)?$/.test(low) || /^(?:clear|empty) (?:my |the )?(?:overnight|tonight(?:'s)?) (?:list|queue|tasks)$/.test(low)) return { type: 'clear' };
  let m = /^(?:cancel|remove|drop|delete) (?:overnight |tonight(?:'s)? )?task (?:number |#)?(\d{1,2})(?: from (?:tonight(?:'s)? list|the overnight (?:list|queue)))?$/.exec(low);
  if (m) return { type: 'cancel', n: Number(m[1]) };
  if (/^(?:what happened overnight|overnight report|how did (?:last night|the night|my overnight (?:tasks|list|work)) (?:go|do)|did my overnight (?:tasks|list|work) (?:finish|run|work)|what did you do (?:last night|overnight)|(?:read|show|give) (?:me )?(?:my |the )?overnight report)$/.test(low)) return { type: 'report' };
  m = /^(?:tonight|overnight|while i(?:'m| am)? (?:asleep|sleeping)|while i sleep|tonight while i sleep|at night)([,:])?\s+(?:please )?(.{4,300})$/i.exec(n);
  if (m) { const task = clean(m[2].replace(/[.!?]+$/, '')); if (task && !NOT_A_TASK.test(task) && (m[1] || VERB.test(task))) return { type: 'add', task }; return null; }
  m = /^(?:do|run|handle|take care of) (?:this|it|that)? ?(?:tonight|overnight|while i sleep)[,:]?\s+(.{4,300})$/i.exec(n);
  if (!m) m = /^(?:queue|add|put) (.{4,300}?) (?:for|on|to) (?:tonight(?:'s list)?|overnight|the overnight (?:list|queue)|tonight(?:'s)? list)$/i.exec(n);
  if (m) { const task = clean(m[1].replace(/[.!?]+$/, '')); if (task && !NOT_A_TASK.test(task)) return { type: 'add', task }; }
  return null;
}

// ---- checking a run: what Relay can look at itself, and what it can only report ----
// actions: this run's recorded tool calls [{ tool, input, result, ok }]. exists: (path) => boolean.
function verifyRun({ status, reply }, actions, { exists = () => true, home = '' } = {}) {
  const acts = Array.isArray(actions) ? actions : [];
  const checks = [], notes = [];
  const expand = (p) => String(p || '').replace(/^~(?=\/|$)/, home);
  const declined = acts.filter((a) => /declined|refused by your file permission rule|not done:/i.test(String(a.result || '')) && a.ok === false);
  const failed = acts.filter((a) => a.ok === false && !declined.includes(a));
  if (declined.length) return { verdict: 'needs-you', checks, notes: [`Needed an approval nobody was there to give: ${declined.map((a) => a.tool).slice(0, 3).join(', ')}. Nothing risky was done.`] };
  if (status === 'failed') return { verdict: 'failed', checks, notes: [clean(reply, 200) || 'It did not complete.'] };
  if (status === 'stopped') return { verdict: 'failed', checks, notes: [clean(reply, 200) || 'It was stopped before it finished.'] };
  if (status !== 'done') return { verdict: 'unknown', checks, notes: ['The outcome was not confirmed.'] };
  if (failed.length) return { verdict: 'partial', checks, notes: [`${failed.length} step${failed.length === 1 ? '' : 's'} failed: ${failed.map((a) => a.tool).slice(0, 4).join(', ')}.`] };
  for (const a of acts) {
    if (a.tool === 'trash_path' && a.input?.path) {
      const gone = !exists(expand(a.input.path));
      checks.push({ label: `${a.input.path} is no longer where it was`, ok: gone });
    }
  }
  if (checks.some((c) => !c.ok)) return { verdict: 'partial', checks, notes: ['A check failed: something that should have changed did not.'] };
  if (checks.length) return { verdict: 'checked', checks, notes };
  if (!acts.length) return { verdict: 'unconfirmed', checks, notes: ['No actions were recorded, so there is nothing to check; treat the answer as unconfirmed.'] };
  return { verdict: 'recorded', checks, notes: [`${acts.length} step${acts.length === 1 ? '' : 's'} ran and each reported success; Relay could not look at the result itself.`] };
}

const MARK = { checked: '✓ Checked', recorded: '• Done, not independently checked', unconfirmed: '? Unconfirmed', partial: '! Partly done', failed: '✗ Did not work', 'needs-you': '! Needs you', skipped: '– Not run', unknown: '? Outcome unknown' };

// The morning report. routines: scheduled runs that happened in the window [{ text, status }].
function buildReport(tasks, routines = [], { now = Date.now() } = {}) {
  const lines = [`Overnight report, ${new Date(now).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}.`, ''];
  const counts = { checked: 0, recorded: 0, problem: 0, skipped: 0 };
  for (const t of tasks) { if (t.verdict === 'checked') counts.checked++; else if (t.verdict === 'recorded' || t.verdict === 'unconfirmed') counts.recorded++; else if (t.status === 'skipped') counts.skipped++; else counts.problem++; }
  if (tasks.length) {
    lines.push('Work you assigned:');
    tasks.forEach((t, i) => {
      lines.push(`${i + 1}. ${t.text}`);
      lines.push(`   ${MARK[t.verdict] || MARK[t.status] || t.status}${t.notes?.length ? `: ${t.notes.join(' ')}` : ''}`);
      for (const c of t.checks || []) lines.push(`   ${c.ok ? '✓' : '✗'} ${c.label}`);
      if (t.reply && ['checked', 'recorded', 'unconfirmed'].includes(t.verdict)) lines.push(`   Relay said: ${clean(t.reply, 220)}`);
    });
  } else lines.push('Nothing was assigned for the night.');
  if (routines.length) {
    lines.push('', 'Planned routines:');
    for (const r of routines) lines.push(`• ${String(r.text).replace(/^Scheduled: /, '')}: ${({ done: 'completed', failed: 'failed', stopped: 'stopped', missed: 'missed (the Mac was asleep or Relay was closed)', unknown: 'outcome unconfirmed' })[r.status] || r.status}`);
  }
  lines.push('', 'A result is only "checked" when Relay could look at it itself. Everything else is what the task reported.');
  const summary = [counts.checked && `${counts.checked} checked`, counts.recorded && `${counts.recorded} done but not independently checked`, counts.problem && `${counts.problem} need${counts.problem === 1 ? 's' : ''} attention`, counts.skipped && `${counts.skipped} not run`].filter(Boolean).join(', ');
  return { text: lines.join('\n'), counts, summary: summary || 'nothing ran' };
}

// ---- the queue ----
class OvernightQueue {
  constructor({ store, now = () => new Date(), settings = () => ({}) }) { Object.assign(this, { store, now, settings }); }
  get state() { const s = this.store.get('overnight'); return s && Array.isArray(s.tasks) ? s : { tasks: [], report: null }; }
  save(s) { this.store.set('overnight', s); }
  conf() { const c = this.settings() || {}; const from = Number.isInteger(c.from) ? c.from : 1, to = Number.isInteger(c.to) ? c.to : 6; const f = Math.min(23, Math.max(0, from)), t = Math.min(23, Math.max(0, to)); return { enabled: c.enabled !== false, from: f, to: f === t ? (f + 5) % 24 : t };  /* a window that starts and ends at the same hour would never close */ }
  list() { return this.state.tasks; }
  queued() { return this.list().filter((t) => t.status === 'queued'); }

  add(text) {
    const t = clean(text);
    if (!t) return { error: 'Tell me what to do tonight.' };
    const s = this.state;
    if (this.queued().length >= MAX_TASKS) return { error: `Tonight's list is full (${MAX_TASKS}).` };
    if (this.queued().some((x) => x.text.toLowerCase() === t.toLowerCase())) return { error: 'That is already on tonight\'s list.' };
    const task = { id: Math.random().toString(36).slice(2, 10), text: t, added: this.now().getTime(), status: 'queued' };
    this.save({ ...s, tasks: [...s.tasks, task] });
    return { task };
  }
  cancel(n) { const q = this.queued(), t = q[n - 1]; if (!t) return null; const s = this.state; this.save({ ...s, tasks: s.tasks.filter((x) => x.id !== t.id) }); return t; }
  clear() { const s = this.state, q = this.queued(); this.save({ ...s, tasks: s.tasks.filter((x) => x.status !== 'queued') }); return q.length; }

  update(id, patch) { const s = this.state; this.save({ ...s, tasks: s.tasks.map((t) => (t.id === id ? { ...t, ...patch } : t)) }); }
  begin(task) { const runId = `overnight:${task.id}`; this.update(task.id, { status: 'running', startedAt: this.now().getTime(), runId }); return runId; }

  // What to do right now: run the next task, skip what the window missed, mark an interrupted run, or write the morning report.
  next({ canRun = true, activeRunId = null } = {}) {
    const now = this.now(), conf = this.conf(), s = this.state, out = { run: null, skip: [], interrupted: [], report: null };
    if (!conf.enabled) return out;
    const open = inWindow(now, conf), win = windowBounds(now, conf);
    for (const t of s.tasks) if (t.status === 'running' && t.runId !== activeRunId && now.getTime() - (t.startedAt || 0) > 5 * 60000) out.interrupted.push(t);
    if (open && canRun && !activeRunId) out.run = s.tasks.find((t) => t.status === 'queued') || null;
    if (!open) for (const t of s.tasks) if (t.status === 'queued' && t.added < win.start && now.getTime() >= win.end) out.skip.push(t);
    // More to do in this window? Then the report waits. Otherwise report everything that finished, was skipped or was interrupted and has not been reported.
    const waiting = s.tasks.filter((t) => t.status === 'queued' && !out.skip.includes(t));
    const busy = !!out.run || s.tasks.some((t) => t.status === 'running' && !out.interrupted.includes(t)) || (open && waiting.length > 0);
    if (!busy && !open) { // the report is for the morning: it waits until the window has closed
      const done = s.tasks.filter((t) => !['queued', 'running'].includes(t.status) && !t.reported);
      const ids = [...new Set([...done, ...out.skip, ...out.interrupted].map((t) => t.id))];
      if (ids.length) out.report = ids;
    }
    return out;
  }
  skip(tasks, why) { for (const t of tasks) this.update(t.id, { status: 'skipped', verdict: 'skipped', finishedAt: this.now().getTime(), notes: [why] }); }
  markReported(tasks, report) { const ids = new Set(tasks.map((t) => t.id)); const s = this.state; this.save({ tasks: s.tasks.map((t) => (ids.has(t.id) ? { ...t, reported: true } : t)).slice(-60), report: { ts: this.now().getTime(), text: report.text, counts: report.counts, summary: report.summary } }); }
}

module.exports = { OvernightQueue, parseOvernightCommand, verifyRun, buildReport, inWindow, windowBounds, MARK };
