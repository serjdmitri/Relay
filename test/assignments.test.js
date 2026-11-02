const test = require('node:test'), assert = require('node:assert/strict');
const { parseDue, enrich, filterAssignments, courses, counts, parseAssignmentsDashboardCommand, NO_CLASS } = require('../src/main/assignments');
const { extractSchoolAssignments } = require('../src/main/school');

const NOW = new Date(2026, 10, 4, 9); // Wed 4 Nov 2026
const ymd = (r) => (r && r.date ? `${r.date.getFullYear()}-${String(r.date.getMonth() + 1).padStart(2, '0')}-${String(r.date.getDate()).padStart(2, '0')}` : null);

test('due dates are read only when that needs no guess; a missing year is assumed and said so', () => {
  assert.deepEqual([ymd(parseDue('2026-11-07', NOW)), parseDue('2026-11-07', NOW).assumedYear], ['2026-11-07', false]);
  assert.deepEqual([ymd(parseDue('Friday, November 7, 2026', NOW)), parseDue('Friday, November 7, 2026', NOW).assumedYear], ['2026-11-07', false]);
  assert.deepEqual([ymd(parseDue('Due Nov 7', NOW)), parseDue('Nov 7', NOW).assumedYear], ['2026-11-07', true]);
  assert.equal(ymd(parseDue('Dec 1st', NOW)), '2026-12-01');
  assert.equal(ymd(parseDue('Oct 20', NOW)), '2026-10-20', 'a recent past date stays this year, so it shows as overdue');
  assert.equal(ymd(parseDue('Jun 1', NOW)), '2027-06-01', 'long past means next year');
  assert.equal(ymd(parseDue('Jan 5', new Date(2026, 11, 20))), '2027-01-05', 'rolls into the new year');
  for (const none of ['11/07', '11/07/2026', 'Friday', 'tomorrow', 'next week', 'Feb 30', '2026-02-31', '', null, undefined, 'soon']) assert.equal(parseDue(none, NOW), null, String(none));
});

const LIST = [
  { title: 'Essay draft', due: '2026-11-03', course: 'English 10' },
  { title: 'Lab report', due: 'Nov 4', course: 'Biology' },
  { title: 'Quiz prep', due: 'Nov 7', course: 'Biology' },
  { title: 'Read chapter 5', due: '11/09' },
  { title: 'Project', due: '2026-12-15', course: 'History' },
  { title: 'Worksheet', due: 'Nov 5', course: 'Math' },
  { title: 'Poster', due: '' }
];

test('rows are dated, ranked by what is due first, given a priority from the date alone, and explained honestly', () => {
  const rows = enrich(LIST, NOW), by = (t) => rows.find((r) => r.title === t);
  assert.deepEqual(rows.map((r) => r.title), ['Essay draft', 'Lab report', 'Worksheet', 'Quiz prep', 'Project', 'Poster', 'Read chapter 5']);
  assert.deepEqual([by('Essay draft').bucket, by('Essay draft').priority, by('Essay draft').when], ['overdue', 'high', 'Overdue by 1 day']);
  assert.deepEqual([by('Lab report').bucket, by('Lab report').when, by('Lab report').priority], ['today', 'Due today', 'high']);
  assert.deepEqual([by('Worksheet').when, by('Worksheet').priority], ['Due tomorrow', 'high']);
  assert.deepEqual([by('Quiz prep').bucket, by('Quiz prep').when, by('Quiz prep').priority], ['week', 'Due in 3 days', 'medium']);
  assert.deepEqual([by('Project').bucket, by('Project').priority], ['later', 'low']);
  assert.deepEqual([by('Read chapter 5').bucket, by('Read chapter 5').priority, by('Read chapter 5').when], ['nodate', 'unknown', 'Due 11/09']);
  assert.match(by('Read chapter 5').note, /without guessing/); assert.equal(by('Poster').when, 'No due date shown'); assert.equal(by('Poster').note, '');
  assert.match(by('Lab report').note, /showed no year; read as 2026-11-04/); assert.equal(by('Essay draft').note, '');
  assert.equal(by('Project').priorityLabel, 'Low'); assert.equal(by('Read chapter 5').priorityLabel, 'No date');
  assert.deepEqual(enrich(null, NOW), []); assert.deepEqual(enrich([{ due: 'Nov 4' }, null, {}], NOW), []);
  assert.equal(new Set(rows.map((r) => r.id)).size, rows.length);
});

test('filters combine: class, due date, priority and a search, including "no class listed" and "due soon"', () => {
  const rows = enrich(LIST, NOW), f = (o) => filterAssignments(rows, o).map((r) => r.title);
  assert.equal(f({}).length, 7);
  assert.deepEqual(f({ course: 'Biology' }), ['Lab report', 'Quiz prep']);
  assert.deepEqual(f({ course: NO_CLASS }), ['Poster', 'Read chapter 5']);
  assert.deepEqual(f({ due: 'overdue' }), ['Essay draft']); assert.deepEqual(f({ due: 'today' }), ['Lab report']);
  assert.deepEqual(f({ due: 'soon' }), ['Essay draft', 'Lab report', 'Worksheet', 'Quiz prep']);
  assert.deepEqual(f({ due: 'nodate' }), ['Poster', 'Read chapter 5']); assert.deepEqual(f({ due: 'later' }), ['Project']);
  assert.deepEqual(f({ priority: 'high' }), ['Essay draft', 'Lab report', 'Worksheet']);
  assert.deepEqual(f({ priority: 'unknown' }), ['Poster', 'Read chapter 5']);
  assert.deepEqual(f({ course: 'Biology', priority: 'high' }), ['Lab report']);
  assert.deepEqual(f({ query: 'LAB' }), ['Lab report']); assert.deepEqual(f({ query: 'history' }), ['Project']);
  assert.deepEqual(f({ course: 'Math', due: 'overdue' }), []);
  assert.deepEqual(courses(rows), ['Biology', 'English 10', 'History', 'Math']);
  assert.deepEqual(counts(rows), { total: 7, overdue: 1, today: 1, week: 2, later: 1, nodate: 2, high: 3 });
});

test('"assignment dashboard" opens the dashboard; "show my assignments" is left to the quick card', () => {
  for (const t of ['assignment dashboard', 'open the assignments dashboard', 'show my homework board', 'Jarvis, bring up the assignment tracker', 'filter my assignments', 'sort my assignments by due date', 'assignments by class', 'show me my school dashboard']) assert.equal(parseAssignmentsDashboardCommand(t), true, t);
  for (const t of ['show my assignments', 'what assignments are due', "what's my homework", 'open the dashboard', 'show the weather dashboard', 'do my homework', 'security audit', '']) assert.equal(parseAssignmentsDashboardCommand(t), false, t);
});

test('the school reader also takes the class name, only when the page really shows it', async () => {
  const text = 'English 10 Essay draft due Friday. Biology Lab report due Monday. Quiz prep due Tuesday.';
  const ask = async () => JSON.stringify([{ title: 'Essay draft', due: 'Friday', course: 'English 10' }, { title: 'Lab report', due: 'Monday', course: 'Chemistry' }, { title: 'Quiz prep', due: 'Tuesday', course: '' }]);
  assert.deepEqual(await extractSchoolAssignments(text, ask), [{ title: 'Essay draft', due: 'Friday', course: 'English 10' }, { title: 'Lab report', due: 'Monday' }, { title: 'Quiz prep', due: 'Tuesday' }], 'a class name the page does not contain is dropped, the assignment is kept');
  assert.equal(await extractSchoolAssignments(text, async () => '[{"title":"Made up","due":"Friday","course":"English 10"}]'), null, 'an invented assignment still rejects the whole result');
  assert.deepEqual(await extractSchoolAssignments(text, async () => '[{"title":"Essay draft","due":"Friday"}]'), [{ title: 'Essay draft', due: 'Friday' }], 'old-shaped answers still work');
  assert.deepEqual(await extractSchoolAssignments(text, async () => JSON.stringify([{ title: 'Essay draft', due: 'Friday', course: 'x'.repeat(200) }])), [{ title: 'Essay draft', due: 'Friday' }]);
});
