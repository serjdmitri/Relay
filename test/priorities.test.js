const test = require('node:test'), assert = require('node:assert/strict');
const { buildPriorities, resolveOpen, parsePrioritiesCommand } = require('../src/main/priorities');

const at = (h, m = 0, day = 4) => new Date(2026, 10, day, h, m);
const NOW = at(9, 0);
const facts = (over = {}) => ({
  now: NOW, weather: { city: 'Miami', tempNow: 78, high: 84, low: 72, rain: 40 },
  events: [{ title: 'Standup', start: at(9, 30) }, { title: 'Lunch with Sam', start: at(12, 0) }, { title: 'Already over', start: at(8, 0) }, { title: 'Holiday', start: null, allDay: true }],
  due: [{ title: 'Pay phone bill', overdue: true }, { title: 'Buy notebook', overdue: false }],
  mail: [{ from: '"Ms. Lee" <lee@school.edu>', subject: 'Field trip form needed', id: 'abc123' }],
  school: { assignments: [{ title: 'Essay draft', due: '2026-11-03' }, { title: 'Lab report', due: '2026-11-04' }, { title: 'Quiz prep', due: '2026-11-07' }, { title: 'Read chapter 5', due: 'next Friday' }, { title: 'Project', due: '2026-12-15' }] },
  unfinished: [{ text: 'organize my downloads', status: 'failed' }], missing: [], ...over
});
const titles = (r, g) => r.items.filter((i) => i.group === g).map((i) => i.title);

test('items are ranked into now, today, soon and later, most pressing first', () => {
  const r = buildPriorities(facts(), { schoolUrl: 'https://school.example/assignments' });
  assert.deepEqual(titles(r, 'now'), ['Pay phone bill', 'Essay draft', 'Standup']);
  assert.deepEqual(titles(r, 'today').slice(0, 3), ['Buy notebook', 'Lab report', 'Lunch with Sam']);
  assert.ok(titles(r, 'today').includes('Holiday'));
  assert.deepEqual(titles(r, 'soon'), ['Quiz prep', 'Field trip form needed', 'Review: organize my downloads', 'Read chapter 5']);
  assert.deepEqual(titles(r, 'later'), ['Project']);
  assert.ok(!r.items.some((i) => i.title === 'Already over'), 'an event that has started is not a next step');
  assert.match(r.headline, /^3 things need attention now\./);
});

test('wording of when things are due is plain, and a date that is not exact is shown as written and never guessed', () => {
  const r = buildPriorities(facts());
  const by = (t) => r.items.find((i) => i.title === t);
  assert.equal(by('Pay phone bill').when, 'overdue');
  assert.equal(by('Essay draft').when, 'overdue, was due 2026-11-03');
  assert.equal(by('Lab report').when, 'due today');
  assert.equal(by('Quiz prep').when, 'due in 3 days (2026-11-07)');
  assert.equal(by('Read chapter 5').when, 'due next Friday');
  assert.match(by('Read chapter 5').detail, /no exact date/);
  assert.equal(by('Standup').when, 'in 30 min, 9:30 AM');
  assert.equal(by('Lunch with Sam').when, 'at 12:00 PM');
  assert.equal(by('Holiday').when, 'all day');
  assert.equal(by('Field trip form needed').when, 'from Ms. Lee');
  assert.equal(buildPriorities(facts({ school: { assignments: [{ title: 'Tomorrow thing', due: '2026-11-05' }] } })).items.find((i) => i.title === 'Tomorrow thing').when, 'due tomorrow');
  assert.equal(buildPriorities(facts({ school: { assignments: [{ title: 'Bad date', due: '2026-02-31' }] } })).items.find((i) => i.title === 'Bad date').when, 'due 2026-02-31');
});

test('a source that could not be read is listed as unavailable, never as empty, and the headline says so', () => {
  const r = buildPriorities(facts({ missing: ['reminders', 'mail', 'weather'], due: [], mail: [], weather: null, school: { problem: 'Open your assignment center in signed-in Firefox.' } }));
  const state = (n) => r.sources.find((s) => s.name === n);
  assert.equal(state('Reminders').state, 'unavailable');
  assert.equal(state('Email').state, 'unavailable');
  assert.equal(state('Weather').note, 'Set your city in Settings.');
  assert.equal(state('School assignments').state, 'unavailable');
  assert.match(state('School assignments').note, /signed-in Firefox/);
  assert.equal(state('Mac calendar').state, 'ok');
  assert.match(r.headline, /4 sources could not be checked\.$/);
  assert.equal(r.weather, null);
  const none = buildPriorities({ now: NOW, events: [], due: [], mail: [], school: { assignments: [] }, unfinished: [], missing: [], weather: { city: 'X', tempNow: 70, high: 80, low: 60, rain: 5 } });
  assert.equal(none.headline, 'Nothing is pressing in the sources I could check.');
  assert.equal(none.weather, 'X: 70° now, high 80°, low 60°');
  assert.equal(buildPriorities({ now: NOW }).sources.find((s) => s.name === 'School assignments').note, 'Could not be checked.');
});

test('weather is a one-line summary and mentions rain only when it is likely', () => {
  assert.equal(buildPriorities(facts()).weather, 'Miami: 78° now, high 84°, low 72°, 40% chance of rain');
  assert.equal(buildPriorities(facts({ weather: { city: 'Miami', tempNow: 78, high: 84, low: 72, rain: 10 } })).weather, 'Miami: 78° now, high 84°, low 72°');
});

test('what a button may open comes from the item, and only Calendar, Reminders, Mail or an https page are allowed', () => {
  const r = buildPriorities(facts(), { schoolUrl: 'https://school.example/assignments' });
  const by = (t) => r.items.find((i) => i.title === t);
  assert.deepEqual(resolveOpen(by('Standup')), { app: 'Calendar' });
  assert.deepEqual(resolveOpen(by('Pay phone bill')), { app: 'Reminders' });
  assert.deepEqual(resolveOpen(by('Essay draft')), { url: 'https://school.example/assignments' });
  assert.deepEqual(resolveOpen(by('Field trip form needed')), { url: 'https://mail.google.com/mail/u/0/#all/abc123' });
  assert.equal(resolveOpen(by('Review: organize my downloads')), null);
  assert.equal(resolveOpen(buildPriorities(facts(), { schoolUrl: 'http://school.example' }).items.find((i) => i.title === 'Essay draft')), null, 'plain http is not opened');
  for (const bad of [{ open: { app: 'Terminal' } }, { open: { url: 'javascript:alert(1)' } }, { open: { url: 'file:///etc/passwd' } }, { open: { url: 'https://a b' } }, {}, null, undefined]) assert.equal(resolveOpen(bad), null);
  assert.deepEqual(resolveOpen(buildPriorities(facts({ mail: [{ from: 'x', subject: 'No id' }] })).items.find((i) => i.title === 'No id')), { app: 'Mail' });
  assert.ok(!JSON.stringify(buildPriorities(facts({ mail: [{ from: 'x', subject: '<b>Hi</b> "there"' }] })).items).includes('<b>'));
});

test('"show my priorities" and similar are understood, and other requests are left alone', () => {
  for (const t of ['show my priorities', 'priority menu', 'what should I do today', 'Jarvis, what needs my attention', 'what are my priorities', "what's my top priority", "what's most important today", 'what do I need to do first', 'open my priority list', "today's priorities", "what's due soon", 'what should I work on next', 'bring up my priorities']) assert.equal(parsePrioritiesCommand(t), true, t);
  for (const t of ['good morning', 'give me my briefing', 'plan today', 'close the day', "what's the weather", 'what should I eat for dinner', 'priorities of the Roman empire in 50 words please explain thoroughly', 'what is the priority queue in computer science', 'what is the capital of France', 'security audit', 'show network radar', '']) assert.equal(parsePrioritiesCommand(t), false, t);
});
