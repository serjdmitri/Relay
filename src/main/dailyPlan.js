// A deterministic draft: only suggest items present in checked sources.
function planToday(facts) {
  const items = [];
  for (const r of facts.due || []) if (r.title) items.push({ title: r.title, source: 'Reminders', rank: r.overdue ? 0 : 1, detail: r.overdue ? 'overdue' : 'due today' });
  for (const a of facts.school?.assignments || []) if (a.title) {
    // Only sort exact ISO calendar dates; preserve the page's wording and do
    // not guess the meaning of relative or locale-dependent dates.
    const due = String(a.due || '').trim();
    const m = due.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    let date = Infinity;
    if (m) {
      const parsed = new Date(`${due}T00:00:00Z`);
      if (Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === due) date = parsed.getTime();
    }
    items.push({ title: a.title, source: 'School', rank: 2, date, detail: due ? `due ${due}` : 'due date not identified' });
  }
  for (const h of facts.unfinished || []) if (h.text && ['failed', 'stopped'].includes(h.status)) items.push({ title: `Review: ${String(h.text).replace(/\s+/g, ' ').slice(0, 100)}`, source: 'Relay history', rank: 3, detail: `${h.status}; check its latest status` });
  for (const e of facts.events || []) if (e.title && (!e.start || e.start >= facts.now)) items.push({ title: e.title, source: 'Calendar', rank: 4, detail: e.start ? `at ${e.start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}` : 'all day or time unavailable' });
  items.sort((a, b) => a.rank - b.rank || (a.date ?? Infinity) - (b.date ?? Infinity));
  const seen = new Set();
  const selected = items.filter((item) => { const key = item.title.toLowerCase().trim(); if (seen.has(key)) return false; seen.add(key); return true; }).slice(0, 3);
  const lines = selected.length ? selected.map((item, i) => `${i + 1}. ${item.title} — ${item.source}, ${item.detail}.`) : ['No priorities could be identified from the checked sources.'];
  const unavailable = [...(facts.missing || []), ...(facts.school?.problem ? ['school'] : [])];
  if (unavailable.length) lines.push(`Sources unavailable or not configured: ${unavailable.join(', ')}.`);
  const { isSecret } = require('./memory');
  const context = (facts.memories || []).map((m) => String(m.text || '').trim()).filter((text) => text && !isSecret(text) && /\b(?:school|class|course|assignment|homework|study|work|project|deadline|exam)\b/i.test(text)).slice(0, 3);
  if (context.length) lines.push(`Saved local context (user-stated; check whether still current): ${context.join('; ')}.`);
  return `Suggested priorities for today:\n${lines.join('\n')}`;
}

function closeDay({ facts, actions = [], history = [] }) {
  const now = facts.now;
  const start = new Date(now); start.setHours(0, 0, 0, 0);
  const valid = (item) => Number.isFinite(item.ts) && item.ts >= start.getTime() && item.ts <= now.getTime();
  const recorded = actions.filter((a) => valid(a) && a.ok === true && require('./recap').CHANGES[a.tool]);
  const unfinished = history.filter((h) => valid(h) && ['failed', 'stopped', 'working'].includes(h.status) && h.text).slice(0, 5);
  const summary = require('./recap').buildRecap({ actions: recorded, history: [], now: now.getTime() });
  const lines = ['Close of day — based on Relay records and currently available sources.'];
  lines.push(recorded.length ? `Recorded successful Relay actions: ${summary.parts.join(', ')}.` : 'No successful Relay actions were recorded today.');
  lines.push(unfinished.length ? `Requests not completed: ${unfinished.map((h) => String(h.text).replace(/\s+/g, ' ').slice(0, 100)).join('; ')}.` : 'No unfinished requests were found in Relay history.');
  lines.push('Possible carryovers for tomorrow (check dates and priorities):');
  lines.push(planToday({ ...facts, events: [] }).replace('Suggested priorities for today:', 'Items still visible in checked sources:'));
  if (facts.tomorrow) {
    const events = facts.tomorrow.events || [];
    if (events.length) lines.push(`Tomorrow’s calendar: ${events.slice(0, 5).map((e) => `${e.title}${e.allDay ? ' (all day)' : ` at ${e.start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`}`).join('; ')}${events.length > 5 ? '; more events available in Calendar' : ''}.`);
    else if (!(facts.tomorrow.missing || []).length) lines.push('No events were found on tomorrow’s checked calendars.');
    if (facts.tomorrow.missing?.length) lines.push(`Could not check tomorrow’s ${facts.tomorrow.missing.join(' and ')}.`);
  } else lines.push('Tomorrow’s calendar was not checked.');
  lines.push('Work outside Relay may not appear in its records.');
  return lines.join('\n');
}

module.exports = { planToday, closeDay };
