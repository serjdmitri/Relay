const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../src/main/proactive');
const { Connectivity, needsInternet } = require('../src/main/connectivity');

const noon = new Date(2026, 5, 10, 12, 0).getTime();
const night = new Date(2026, 5, 10, 23, 30).getTime();
const cal = (minutes, title = 'Robotics meeting') => ({ type: 'calendar', title, start: 1, minutes });

test('scores: a meeting about to start and a nearly dead battery matter, a finished job a bit, far-off things do not', () => {
  assert.ok(P.scoreEvent(cal(1)) >= 0.9 && P.scoreEvent(cal(8)) >= 0.7 && P.scoreEvent(cal(60)) < 0.4);
  assert.ok(P.scoreEvent({ type: 'battery', percent: 8 }) >= 0.9 && P.scoreEvent({ type: 'battery', percent: 50 }) === 0);
  assert.ok(P.scoreEvent({ type: 'job', status: 'failed' }) > P.scoreEvent({ type: 'job', status: 'done' }));
  assert.equal(P.scoreEvent({ type: 'plugin', importance: 7 }), 1);
});

test('default mode: a quiet banner for ordinary things, spoken only when urgent, three spoken an hour at most', () => {
  const a = new P.Alerts({ now: () => noon });
  assert.equal(a.decide({ type: 'job', title: 'tidy', status: 'done', id: 1 }, { mode: 'silent-urgent' }).how, 'pill');
  assert.equal(a.decide(cal(2, 'A'), { mode: 'silent-urgent' }).how, 'speak');
  assert.equal(a.decide(cal(2, 'B'), { mode: 'silent-urgent' }).how, 'speak');
  assert.equal(a.decide(cal(2, 'C'), { mode: 'silent-urgent' }).how, 'speak');
  assert.equal(a.decide(cal(2, 'D'), { mode: 'silent-urgent' }).how, 'pill', 'over the cap: shown, not spoken');
});

test('"always silent" never speaks and "speak everything important" speaks things the default would only show', () => {
  assert.equal(new P.Alerts({ now: () => noon }).decide(cal(1), { mode: 'silent' }).how, 'pill');
  assert.equal(new P.Alerts({ now: () => noon }).decide({ type: 'job', title: 'x', status: 'done', id: 2 }, { mode: 'speak' }).how, 'speak');
});

test('quiet hours and busy moments: nothing is spoken; only the most urgent reaches the phone at night', () => {
  const q = { on: true, from: 22, to: 7 };
  const a = new P.Alerts({ now: () => night });
  const meeting = a.decide(cal(2, 'late'), { mode: 'speak', quiet: q });
  assert.deepEqual([meeting.how, meeting.phone, meeting.quiet], ['pill', true, true]);
  assert.equal(a.decide({ type: 'job', title: 'x', status: 'done', id: 3 }, { mode: 'speak', quiet: q }).phone, false);
  assert.equal(new P.Alerts({ now: () => noon }).decide(cal(1), { mode: 'speak', busy: true }).how, 'pill');
  assert.equal(P.inQuiet(q, new Date(2026, 5, 10, 6, 0)), true);
  assert.equal(P.inQuiet(q, new Date(2026, 5, 10, 8, 0)), false);
  assert.equal(P.inQuiet({ on: false, from: 22, to: 7 }, new Date(2026, 5, 10, 23, 0)), false);
});

test('away from the Mac the phone hears about important things; the same thing is not told twice', () => {
  const a = new P.Alerts({ now: () => noon });
  assert.equal(a.decide({ type: 'job', title: 'x', status: 'failed', id: 4 }, { mode: 'silent', away: true }).phone, true);
  assert.equal(a.decide({ type: 'job', title: 'x', status: 'failed', id: 4 }, { mode: 'silent', away: true }).how, 'drop');
  assert.equal(a.decide({ type: 'battery', percent: 50 }, {}).how, 'drop');
});

test('calendar lines become events within ten minutes; the battery event needs an unplugged low battery', () => {
  const now = Date.parse('2026-06-10 12:00:00');
  const evs = P.parseCalendar('Robotics meeting | Wednesday, June 10, 2026 at 12:05:00 PM\nDentist | Wednesday, June 10, 2026 at 4:00:00 PM\nnonsense');
  assert.equal(evs.length, 2);
  const soon = P.calendarEvents(evs, now);
  assert.equal(soon.length, 1);
  assert.deepEqual([soon[0].title, soon[0].minutes], ['Robotics meeting', 5]);
  assert.match(P.textFor(soon[0]), /Robotics meeting starts in 5 minutes/);
  assert.equal(P.batteryEvent({ present: true, onBattery: true, charging: false, percent: 12 }).percent, 12);
  assert.equal(P.batteryEvent({ present: true, onBattery: false, charging: true, percent: 12 }), null);
  assert.equal(P.batteryEvent({ present: false }), null);
});

test('offline: two bad rounds in a row to go offline, two good ones to come back, one blip changes nothing', async () => {
  const seq = [];
  const changes = [];
  const c = new Connectivity({ probe: async () => seq.shift(), onChange: (o) => changes.push(o), setTimer: (fn) => fn(), gapMs: 0 });
  seq.push(true); await c.check(); assert.equal(c.online, true);
  seq.push(false, true); await c.check(); assert.deepEqual([c.online, changes.length], [true, 0], 'one blip');
  seq.push(false, false); await c.check(); assert.deepEqual([c.online, changes], [false, [false]]);
  seq.push(false); await c.check(); assert.equal(c.online, false);
  seq.push(true, false, true, true); await c.check(); assert.deepEqual([c.online, changes], [false, [false]], 'flapping back is not trusted');
  seq.push(true, true); await c.check(); assert.deepEqual([c.online, changes], [true, [false, true]]);
});

test('offline, plain conversation goes to the local model and anything that needs the Mac or the web does not', () => {
  for (const t of ['open Safari and search for pizza', 'send a text to Dana', 'remind me at 9', 'turn off the wifi', 'play some music', 'delete that file']) assert.equal(needsInternet(t), true, t);
  for (const t of ['what is a derivative', 'explain how a swerve drive works', 'who wrote Othello', 'give me a synonym for happy']) assert.equal(needsInternet(t), false, t);
});
