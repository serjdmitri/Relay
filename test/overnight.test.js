const test = require('node:test'), assert = require('node:assert/strict');
const { OvernightQueue, parseOvernightCommand, verifyRun, buildReport, inWindow, windowBounds } = require('../src/main/overnight');

const at = (day, h, m = 0) => new Date(2026, 10, day, h, m);
function make(clock, settings = {}) {
  let data = null; const now = { t: clock };
  const store = { get: (k) => (k === 'overnight' ? data : null), set: (k, v) => { if (k === 'overnight') data = JSON.parse(JSON.stringify(v)); } };
  const q = new OvernightQueue({ store, now: () => now.t, settings: () => settings });
  return { q, now, data: () => data };
}

test('what you say: assign, list, cancel, clear and ask for the report; ordinary requests are left alone', () => {
  for (const [t, want] of [
    ['tonight, organize my Downloads', { type: 'add', task: 'organize my Downloads' }],
    ['Jarvis, overnight: make flashcards from my biology notes', { type: 'add', task: 'make flashcards from my biology notes' }],
    ['while I sleep, back up my documents folder.', { type: 'add', task: 'back up my documents folder' }],
    ['do this tonight: clean up my Desktop', { type: 'add', task: 'clean up my Desktop' }],
    ['queue sort my photos for tonight', { type: 'add', task: 'sort my photos' }],
    ["what's on tonight's list", { type: 'list' }], ['show my overnight tasks', { type: 'list' }], ['what is queued for tonight', { type: 'list' }],
    ["clear tonight's list", { type: 'clear' }], ['cancel overnight task 2', { type: 'cancel', n: 2 }], ['remove task 3 from tonight\'s list', { type: 'cancel', n: 3 }],
    ['what happened overnight', { type: 'report' }], ['overnight report', { type: 'report' }], ['how did last night go', { type: 'report' }], ['did my overnight tasks finish', { type: 'report' }]
  ]) assert.deepEqual(parseOvernightCommand(t), want, t);
  for (const t of ["what's the weather tonight", 'tonight at 9 remind me to call mom', 'remind me tonight to take out the trash', 'tonight will it rain', 'tonight, what time is the game', 'every night at 11 organize downloads', 'good night', 'overnight oats recipe', 'security audit', 'show my priorities', '']) assert.equal(parseOvernightCommand(t), null, t);
});

test('the overnight window, including one that crosses midnight, and the most recent window that has ended', () => {
  assert.equal(inWindow(at(5, 1), { from: 1, to: 6 }), true);
  assert.equal(inWindow(at(5, 6), { from: 1, to: 6 }), false);
  assert.equal(inWindow(at(5, 0, 59), { from: 1, to: 6 }), false);
  assert.equal(inWindow(at(5, 23), { from: 22, to: 6 }), true);
  assert.equal(inWindow(at(5, 3), { from: 22, to: 6 }), true);
  assert.equal(inWindow(at(5, 12), { from: 22, to: 6 }), false);
  assert.deepEqual(windowBounds(at(5, 12), { from: 1, to: 6 }), { start: at(5, 1).getTime(), end: at(5, 6).getTime() });
  assert.deepEqual(windowBounds(at(5, 23), { from: 22, to: 6 }), { start: at(5, 22).getTime(), end: at(6, 6).getTime() });
  assert.deepEqual(windowBounds(at(5, 3), { from: 22, to: 6 }), { start: at(4, 22).getTime(), end: at(5, 6).getTime() });
});

const run = (over = {}) => ({ status: 'done', reply: 'Done.', ...over });
const act = (tool, over = {}) => ({ tool, input: {}, result: 'ok', ok: true, ...over });

test('a run is only "checked" when Relay could look itself; otherwise it says what it could not check', () => {
  const home = '/Users/me';
  const gone = verifyRun(run(), [act('trash_path', { input: { path: '~/Downloads/a.zip' } })], { exists: () => false, home });
  assert.equal(gone.verdict, 'checked'); assert.deepEqual(gone.checks, [{ label: '~/Downloads/a.zip is no longer where it was', ok: true }]);
  const still = verifyRun(run(), [act('trash_path', { input: { path: '~/Downloads/a.zip' } })], { exists: (p) => { assert.equal(p, '/Users/me/Downloads/a.zip'); return true; }, home });
  assert.equal(still.verdict, 'partial'); assert.equal(still.checks[0].ok, false);
  assert.equal(verifyRun(run(), [act('drive_apply'), act('drive_make')], { exists: () => true }).verdict, 'recorded');
  assert.match(verifyRun(run(), [act('drive_apply'), act('drive_make')]).notes[0], /2 steps ran and each reported success; Relay could not look at the result itself/);
  const text = verifyRun(run({ reply: 'All tidy!' }), []);
  assert.equal(text.verdict, 'unconfirmed'); assert.match(text.notes[0], /No actions were recorded/);
  assert.equal(verifyRun(run(), [act('drive_apply'), act('save_files', { ok: false, result: 'Error: disk full' })]).verdict, 'partial');
  assert.equal(verifyRun(run({ status: 'failed', reply: 'Could not reach the page.' }), [act('web')]).verdict, 'failed');
  assert.equal(verifyRun(run({ status: 'stopped', reply: 'Stopped.' }), []).verdict, 'failed');
  assert.equal(verifyRun({ status: 'unknown' }, []).verdict, 'unknown');
  const needs = verifyRun(run({ status: 'stopped' }), [act('trash_path', { ok: false, result: 'declined' })]);
  assert.equal(needs.verdict, 'needs-you'); assert.match(needs.notes[0], /Nothing risky was done/);
  assert.equal(verifyRun(run(), [act('run_shell', { ok: false, result: 'Not done: your file permission rule for high risk is "never"' })]).verdict, 'needs-you');
});

test('the queue: add, reject empty, duplicates and a full list; cancel by number; clear', () => {
  const { q } = make(at(5, 22));
  assert.ok(q.add('organize my Downloads').task);
  assert.match(q.add('  ').error, /Tell me what/);
  assert.match(q.add('Organize my downloads').error, /already on tonight/);
  q.add('make flashcards');
  assert.deepEqual(q.queued().map((t) => t.text), ['organize my Downloads', 'make flashcards']);
  assert.equal(q.cancel(1).text, 'organize my Downloads');
  assert.equal(q.cancel(9), null);
  assert.equal(q.clear(), 1);
  assert.equal(q.list().length, 0);
  for (let i = 0; i < 20; i++) assert.ok(q.add(`task number ${i}`).task);
  assert.match(q.add('one too many').error, /full/);
});

test('tasks run only inside the window, one at a time, when Relay is free', () => {
  const { q, now } = make(at(5, 22));
  q.add('organize my Downloads'); q.add('make flashcards');
  assert.equal(q.next({ canRun: true }).run, null, 'not before the window opens');
  now.t = at(6, 1, 5);
  assert.equal(q.next({ canRun: false }).run, null, 'not while Relay is busy');
  assert.equal(q.next({ canRun: true, activeRunId: 'overnight:x' }).run, null, 'not while another run is active');
  const first = q.next({ canRun: true }).run;
  assert.equal(first.text, 'organize my Downloads');
  const runId = q.begin(first);
  assert.equal(runId, `overnight:${first.id}`);
  assert.equal(q.next({ canRun: true, activeRunId: runId }).run, null);
  q.update(first.id, { status: 'done', verdict: 'recorded', finishedAt: now.t.getTime() });
  assert.equal(q.next({ canRun: true }).run.text, 'make flashcards');
  assert.equal(make(at(6, 2), { enabled: false }).q.next({}).run, null);
});

test('the report waits for the morning, covers everything, and is written once', () => {
  const { q, now } = make(at(5, 22));
  const a = q.add('organize my Downloads').task, b = q.add('make flashcards').task;
  now.t = at(6, 1, 5);
  for (const t of [a, b]) { const id = q.begin(t); q.update(t.id, { status: 'done', verdict: 'recorded', finishedAt: now.t.getTime(), notes: ['ok'] }); assert.equal(id, `overnight:${t.id}`); }
  assert.equal(q.next({}).report, null, 'not at 1 AM: the window is still open');
  now.t = at(6, 6, 1);
  const n = q.next({});
  assert.deepEqual(n.report.sort(), [a.id, b.id].sort());
  const report = buildReport(q.list().filter((t) => n.report.includes(t.id)), [], { now: now.t.getTime() });
  q.markReported(q.list().filter((t) => n.report.includes(t.id)), report);
  assert.equal(q.next({}).report, null, 'reported once');
  assert.equal(q.state.report.counts.recorded, 2);
});

test('a window the Mac slept through skips what was waiting and says so; an interrupted run is never retried', () => {
  const { q, now } = make(at(5, 22));
  const a = q.add('organize my Downloads').task;
  now.t = at(6, 8);
  const n = q.next({});
  assert.deepEqual(n.skip.map((t) => t.id), [a.id]);
  assert.equal(n.run, null);
  assert.deepEqual(n.report, [a.id]);
  q.skip(n.skip, 'The Mac was asleep or Relay was closed during the overnight window.');
  assert.equal(q.list()[0].status, 'skipped');
  const m = make(at(5, 22));
  const b = m.q.add('make flashcards').task;
  m.now.t = at(6, 1, 10); m.q.begin(m.q.next({}).run);
  m.now.t = at(6, 3);
  const n2 = m.q.next({ activeRunId: null });
  assert.deepEqual(n2.interrupted.map((t) => t.id), [b.id]);
  assert.equal(n2.run, null, 'an interrupted run is not started again');
  assert.equal(m.q.next({ activeRunId: `overnight:${b.id}` }).interrupted.length, 0, 'a run that is still going is not interrupted');
});

test('the report is plain, honest about what was and was not checked, and includes planned routines', () => {
  const tasks = [
    { text: 'trash old installers', status: 'done', verdict: 'checked', checks: [{ label: '~/Downloads/a.dmg is no longer where it was', ok: true }], notes: [], reply: 'Moved it to the Trash.' },
    { text: 'tidy my photos', status: 'done', verdict: 'recorded', checks: [], notes: ['3 steps ran and each reported success; Relay could not look at the result itself.'], reply: 'Sorted 40 photos.' },
    { text: 'email my teacher', status: 'stopped', verdict: 'needs-you', checks: [], notes: ['Needed an approval nobody was there to give: messages_send. Nothing risky was done.'] },
    { text: 'back up documents', status: 'skipped', verdict: 'skipped', checks: [], notes: ['The Mac was asleep.'] }
  ];
  const r = buildReport(tasks, [{ text: 'Scheduled: nightly tidy', status: 'done' }, { text: 'Scheduled: backup', status: 'missed' }], { now: at(6, 7).getTime() });
  assert.match(r.text, /^Overnight report, Friday, November 6\./);
  assert.match(r.text, /1\. trash old installers\n   ✓ Checked\n   ✓ ~\/Downloads\/a\.dmg is no longer where it was/);
  assert.match(r.text, /2\. tidy my photos\n   • Done, not independently checked: 3 steps ran/);
  assert.match(r.text, /! Needs you: Needed an approval nobody was there to give/);
  assert.match(r.text, /– Not run: The Mac was asleep\./);
  assert.match(r.text, /• nightly tidy: completed/);
  assert.match(r.text, /• backup: missed \(the Mac was asleep or Relay was closed\)/);
  assert.match(r.text, /only "checked" when Relay could look at it itself/);
  assert.deepEqual(r.counts, { checked: 1, recorded: 1, problem: 1, skipped: 1 });
  assert.equal(r.summary, '1 checked, 1 done but not independently checked, 1 needs attention, 1 not run');
  assert.match(buildReport([], []).text, /Nothing was assigned for the night\./);
  assert.equal(buildReport([], []).summary, 'nothing ran');
});
