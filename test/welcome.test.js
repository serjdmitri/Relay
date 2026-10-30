const test = require('node:test');
const assert = require('node:assert/strict');
const { shouldGreet, buildWelcome, awayWords, greetingFor, briefingCard } = require('../src/main/welcome');

const T = Date.parse('2026-06-10T12:00:00');
const MIN = 60000;

test('it greets only after a real absence, not twice in a row, and not while something else is using the screen', () => {
  assert.equal(shouldGreet({ awayMs: 10 * MIN }), true);
  assert.equal(shouldGreet({ awayMs: 2 * MIN }), false, 'a quick lock and unlock');
  assert.equal(shouldGreet({ awayMs: 10 * MIN, sinceLastMs: 3 * MIN }), false, 'greeted a moment ago');
  assert.equal(shouldGreet({ awayMs: 10 * MIN, busy: true }), false, 'a meeting is being recorded');
  assert.equal(shouldGreet({ awayMs: 10 * MIN, enabled: false }), false);
  assert.equal(shouldGreet({ awayMs: 3 * MIN, minAwayMs: MIN }), true, 'the wait is a setting');
  assert.equal(shouldGreet({ awayMs: 1000, minAwayMs: 0 }), true, '0 greets every unlock');
  assert.equal(shouldGreet({ awayMs: 10 * MIN, sinceLastMs: 3 * MIN, minGapMs: 2 * MIN }), true, 'the gap between greetings is a setting too');
  assert.equal(shouldGreet({ awayMs: 10 * MIN, sinceLastMs: 30 * MIN, minGapMs: 60 * MIN }), false);
});

test('nothing happened: a greeting and "nothing needs your attention"', () => {
  const w = buildWelcome({ name: 'Sir', lockedAt: T - 10 * MIN, now: T });
  assert.equal(w.spoken, 'Good afternoon, Sir. Nothing needs your attention.');
  assert.deepEqual(w.lines, ['Nothing needs your attention.']);
});

test('what finished while you were away, what failed, the next meeting and a low battery', () => {
  const w = buildWelcome({
    name: 'Sir', lockedAt: T - 45 * MIN, now: T,
    history: [{ text: 'Agent: research swerve drives', status: 'done', ts: T - 30 * MIN }, { text: 'tidy downloads', status: 'done', ts: T - 20 * MIN }, { text: 'email Dana', status: 'failed', ts: T - 10 * MIN }, { text: 'before I left', status: 'done', ts: T - 50 * MIN }],
    events: [{ title: 'Robotics meeting', start: T + 25 * MIN }, { title: 'Dentist', start: T + 5 * 3600e3 }],
    battery: { present: true, onBattery: true, charging: false, percent: 14 }
  });
  assert.match(w.spoken, /^Good afternoon, Sir\. You were away about 45 minutes\. 2 things finished while you were away, including research swerve drives\./);
  assert.match(w.spoken, /One did not work: email Dana\./);
  assert.match(w.spoken, /Robotics meeting starts in 25 minutes\./);
  assert.ok(!/before I left/.test(w.spoken) && !/Dentist/.test(w.spoken));
  assert.equal(w.lines.length, 4);
  assert.match(w.lines[3], /battery is at 14 percent/);
});

test('the greeting follows local time at each day and night boundary', () => {
  const local = (hour, minute = 0) => new Date(2026, 5, 10, hour, minute).getTime();
  for (const [hour, expected] of [[0, 'night'], [4, 'night'], [5, 'morning'], [11, 'morning'], [12, 'afternoon'], [16, 'afternoon'], [17, 'evening'], [21, 'evening'], [22, 'night'], [23, 'night']]) {
    assert.equal(greetingFor(local(hour), 'Sir'), `Good ${expected}, Sir.`);
  }
  assert.equal(greetingFor(local(9), 'Alex'), 'Good morning, Alex.');
});

test('the briefing includes work started before locking if it finished while away', () => {
  const w = buildWelcome({ lockedAt: T - 30 * MIN, now: T, history: [
    { text: 'long task', status: 'done', ts: T - 60 * MIN, finishedAt: T - 5 * MIN },
    { text: 'old task', status: 'done', ts: T - 60 * MIN, finishedAt: T - 31 * MIN },
    { text: 'future task', status: 'done', ts: T - 10 * MIN, finishedAt: T + MIN },
    { text: 'older version entry', status: 'done', ts: T - 2 * MIN },
  ] });
  assert.match(w.lines.join(' '), /2 things finished/);
  assert.match(w.lines.join(' '), /long task/);
  assert.doesNotMatch(w.lines.join(' '), /old task|future task/);
});

test('missed scheduled work is reported as missed, never as completed', () => {
  const w = buildWelcome({ lockedAt: T - 30 * MIN, now: T, history: [{ text: 'Scheduled: check homework', status: 'missed', ts: T - 20 * MIN, finishedAt: T - MIN }] });
  assert.match(w.spoken, /One scheduled task was missed: check homework/);
  assert.doesNotMatch(w.spoken, /Finished while/);
});

test('briefing card puts failed and missed work before meetings and completed work', () => {
  const w = buildWelcome({ lockedAt: T - 30 * MIN, now: T, history: [
    { text: 'finished', status: 'done', ts: T - MIN },
    { text: 'failed', status: 'failed', ts: T - MIN },
    { text: 'Scheduled: missed', status: 'missed', ts: T - MIN }
  ], events: [{ title: 'Class', start: T + 10 * MIN }] });
  const card = briefingCard(w, 'Rain expected today.', 'Sir');
  assert.deepEqual(card.items.map((x) => x.title), ['Needs attention', 'Missed', 'Coming up', 'Completed', 'Today']);
  assert.match(card.items.at(-1).subtitle, /Rain/);
  assert.equal(briefingCard(buildWelcome({ lockedAt: T - MIN, now: T }), ''), null);
});

test('the spoken version keeps to the top three items; the banner has all of them', () => {
  const w = buildWelcome({ lockedAt: T - 10 * MIN, now: T, history: [{ text: 'a', status: 'done', ts: T - 5 * MIN }, { text: 'b', status: 'failed', ts: T - 4 * MIN }], events: [{ title: 'Standup', start: T + MIN * 10 }], battery: { present: true, onBattery: true, charging: false, percent: 9 } });
  assert.equal(w.lines.length, 4);
  assert.ok(!/battery/.test(w.spoken));
  assert.match(w.lines.join(' '), /battery/);
});

test('plain wording for long absences and a meeting later today', () => {
  assert.equal(awayWords(25 * MIN), 'about 25 minutes');
  assert.equal(awayWords(3 * 3600e3), 'about 3 hours');
  assert.equal(awayWords(50 * 3600e3), 'about 2 days');
  const w = buildWelcome({ lockedAt: T - 20 * MIN, now: T, events: [{ title: 'Lab', start: T + 2 * 3600e3 }] });
  assert.match(w.spoken, /Next up: Lab at 2 PM\./);
});
