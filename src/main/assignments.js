// The assignment dashboard's logic: turns what the school page showed ({ title, due, course? }) into rows you can filter by class, due date and
// priority. Pure. Honest about what it knows: a due date is only used when it can be read without guessing (an exact 2026-11-07, or a month name
// and day such as "Nov 7" or "Friday, November 7, 2026"; numeric dates like 11/07 are ambiguous between countries and are shown as written, not
// ranked). A priority is worked out from the due date alone, because a school page has no priority field.

const DAY = 86400e3;
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const valid = (y, m, d) => { const x = new Date(y, m, d); return x.getFullYear() === y && x.getMonth() === m && x.getDate() === d ? x : null; };
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// { date, assumedYear } or null.
function parseDue(text, now = new Date()) {
  const s = String(text || '').trim().replace(/\s+/g, ' ');
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) { const d = valid(+m[1], +m[2] - 1, +m[3]); return d ? { date: d, assumedYear: false } : null; }
  m = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.? (\d{1,2})(?:st|nd|rd|th)?(?:,? (\d{4}))?\b/i.exec(s);
  if (!m) return null;
  const month = MONTHS.indexOf(m[1].toLowerCase()), day = +m[2];
  if (m[3]) { const d = valid(+m[3], month, day); return d ? { date: d, assumedYear: false } : null; }
  const today = startOfDay(now); let d = valid(today.getFullYear(), month, day);
  if (!d) return null;
  if (today - d > 60 * DAY) d = valid(today.getFullYear() + 1, month, day); // no year on the page: the nearest likely one, said out loud in the note
  return d ? { date: d, assumedYear: true } : null;
}

const PRIORITY_LABEL = { high: 'High', medium: 'Medium', low: 'Low', unknown: 'No date' };
const BUCKETS = ['overdue', 'today', 'week', 'later', 'nodate'];

function enrich(list, now = new Date()) {
  const today = startOfDay(now);
  const rows = (Array.isArray(list) ? list : []).filter((a) => a && a.title).map((a, i) => {
    const p = parseDue(a.due, now), days = p ? Math.round((p.date - today) / DAY) : null;
    const priority = days === null ? 'unknown' : days <= 1 ? 'high' : days <= 7 ? 'medium' : 'low';
    const bucket = days === null ? 'nodate' : days < 0 ? 'overdue' : days === 0 ? 'today' : days <= 7 ? 'week' : 'later';
    const when = days === null ? (a.due ? `Due ${a.due}` : 'No due date shown') : days < 0 ? `Overdue by ${-days} day${days === -1 ? '' : 's'}` : days === 0 ? 'Due today' : days === 1 ? 'Due tomorrow' : `Due in ${days} days`;
    const note = days === null ? (a.due ? 'The page gave no date that can be read without guessing, so it is not ranked by date.' : '') : p.assumedYear ? `The page showed no year; read as ${iso(p.date)}.` : '';
    return { id: `a${i + 1}`, title: String(a.title), course: a.course ? String(a.course) : '', due: a.due ? String(a.due) : '', dueDate: p ? iso(p.date) : null, days, priority, priorityLabel: PRIORITY_LABEL[priority], bucket, when, note };
  });
  return rows.sort((a, b) => (a.days === null) - (b.days === null) || (a.days ?? 0) - (b.days ?? 0) || a.title.localeCompare(b.title));
}

const NO_CLASS = '__none';
const courses = (rows) => [...new Set(rows.map((r) => r.course).filter(Boolean))].sort((a, b) => a.localeCompare(b));

function filterAssignments(rows, { course = 'all', due = 'all', priority = 'all', query = '' } = {}) {
  const q = String(query || '').trim().toLowerCase();
  return rows.filter((r) => (course === 'all' || (course === NO_CLASS ? !r.course : r.course === course))
    && (due === 'all' || (due === 'soon' ? ['overdue', 'today', 'week'].includes(r.bucket) : r.bucket === due))
    && (priority === 'all' || r.priority === priority)
    && (!q || `${r.title} ${r.course}`.toLowerCase().includes(q)));
}

function counts(rows) {
  const by = (k, v) => rows.filter((r) => r[k] === v).length;
  return { total: rows.length, overdue: by('bucket', 'overdue'), today: by('bucket', 'today'), week: by('bucket', 'week'), later: by('bucket', 'later'), nodate: by('bucket', 'nodate'), high: by('priority', 'high') };
}

// "assignment dashboard", "open the assignments dashboard". ("show my assignments" already gives the quick card.)
function parseAssignmentsDashboardCommand(text) {
  const n = String(text || '').trim().replace(/[“”"]/g, '').replace(/[.!?]+$/, '').replace(/^(?:hey |ok |okay )?(?:relay|jarvis)[, ]+/i, '').replace(/^please /i, '').replace(/\s+/g, ' ').toLowerCase();
  return /^(?:open|show|bring up|pull up|display)(?: me)?(?: my| the)? (?:assignment|assignments|homework|school) (?:dashboard|board|menu|tracker)$/.test(n)
    || /^(?:assignment|assignments|homework) (?:dashboard|board|tracker)$/.test(n)
    || /^(?:filter|sort) my (?:assignments|homework)(?: by (?:class|course|subject|due date|priority))?$/.test(n)
    || /^(?:assignments|homework) by (?:class|course|subject|due date|priority)$/.test(n);
}

module.exports = { parseDue, enrich, filterAssignments, courses, counts, parseAssignmentsDashboardCommand, NO_CLASS, BUCKETS, PRIORITY_LABEL };
