// A deterministic draft: only suggest items present in checked sources.
function planToday(facts) {
  const items = [];
  for (const r of facts.due || []) if (r.title) items.push({ title: r.title, source: 'Reminders', rank: r.overdue ? 0 : 1, detail: r.overdue ? 'overdue' : 'due today' });
  for (const a of facts.school?.assignments || []) if (a.title) items.push({ title: a.title, source: 'School', rank: 2, detail: a.due ? `due ${a.due}` : 'due date not identified' });
  for (const e of facts.events || []) if (e.title && (!e.start || e.start >= facts.now)) items.push({ title: e.title, source: 'Calendar', rank: 3, detail: e.start ? `at ${e.start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}` : 'all day or time unavailable' });
  items.sort((a, b) => a.rank - b.rank);
  const seen = new Set();
  const selected = items.filter((item) => { const key = item.title.toLowerCase().trim(); if (seen.has(key)) return false; seen.add(key); return true; }).slice(0, 3);
  const lines = selected.length ? selected.map((item, i) => `${i + 1}. ${item.title} — ${item.source}, ${item.detail}.`) : ['No priorities could be identified from the checked sources.'];
  const unavailable = [...(facts.missing || []), ...(facts.school?.problem ? ['school'] : [])];
  if (unavailable.length) lines.push(`Sources unavailable or not configured: ${unavailable.join(', ')}.`);
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
  lines.push('Tomorrow’s calendar was not checked. Work outside Relay may not appear in its records.');
  return lines.join('\n');
}

module.exports = { planToday, closeDay };
