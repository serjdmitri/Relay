// The command center: one card that answers "what is going on?" from things Relay already knows: today's calendar, what is due, jobs running or
// waiting overnight, whether the owner guard is on, the pages being watched, and the last things Relay did (and which of them can be undone).
// Pure: the caller gathers the facts; anything it could not read is left out, never shown as empty.

const clock = (ms) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const short = (s, n = 90) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);

const TOOL_WORDS = { reminders_add: 'Added a reminder', calendar_create: 'Created a calendar event', drive_apply: 'Moved files', drive_make: 'Made a file', reminders_complete: 'Completed a reminder' };
const describeAction = (a) => `${TOOL_WORDS[a.tool] || String(a.tool || 'Did something').replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())}${a.ok === false ? ' (did not work)' : ''}`;

function buildCenter({ events, due, tasks, guard, pages, actions, undoable = new Set(), now = Date.now() } = {}) {
  const items = [];
  if (Array.isArray(events)) {
    const todays = events.filter((e) => Number.isFinite(+e.start)).sort((a, b) => a.start - b.start);
    items.push({ title: 'Today', subtitle: todays.length ? `${todays.length} event${todays.length === 1 ? '' : 's'}` : 'Nothing on the calendar', note: todays.slice(0, 6).map((e) => `${clock(+e.start)}  ${short(e.title, 60)}`).join('\n') });
  }
  if (Array.isArray(due)) items.push({ title: 'Due', subtitle: due.length ? `${due.length} reminder${due.length === 1 ? '' : 's'}` : 'Nothing due', note: due.slice(0, 6).map((r) => short(r.title || r, 70)).join('\n') });
  if (Array.isArray(tasks)) items.push({ title: 'Running or waiting', subtitle: tasks.length ? `${tasks.length} job${tasks.length === 1 ? '' : 's'}` : 'No jobs', note: tasks.slice(0, 5).map((t) => short(t.title || t.name || t.text || t, 70)).join('\n') });
  if (guard) items.push({ title: 'Owner guard', subtitle: guard.on ? (guard.armed ? 'On and watching' : 'On, waiting to recognise you') : 'Off', note: guard.keepAwake ? 'Keeps the Mac awake while it watches.' : '' });
  if (Array.isArray(pages) && pages.length) items.push({ title: 'Watching pages', subtitle: `${pages.length} page${pages.length === 1 ? '' : 's'}`, note: pages.slice(0, 6).map((p) => short(p.label, 50)).join('\n') });
  const recent = (actions || []).slice(-6).reverse();
  if (recent.length) items.push({ title: 'Recently', subtitle: `${recent.length} thing${recent.length === 1 ? '' : 's'} Relay did`, note: recent.map((a) => `${describeAction(a)}${undoable.has(a.id) ? ' (can be undone)' : ''}`).join('\n') });
  return { kind: 'list', hold: true, title: 'Command center', summary: items.length ? 'What is going on right now.' : 'Nothing to show yet.', items, facts: [], links: [] };
}

const parseCommandCenter = (text) => /^(?:hey |ok |okay )?(?:(?:jarvis|relay)[, ]+)?(?:please )?(?:show (?:me )?(?:the |my )?(?:command center|status board)|open (?:the |my )?(?:command center|status board)|(?:command center|status board)|what(?:'s| is) going on(?: right now)?|give me (?:the |a )?status(?: report)?)[.!?]*$/i.test(String(text || '').trim());

module.exports = { buildCenter, parseCommandCenter, describeAction };
