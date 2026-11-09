const test = require('node:test');
const assert = require('node:assert/strict');
const { shouldGreet, canDeliverWelcome, buildWelcome, awayWords, greetingFor, briefingCard, showWelcomeReactor } = require('../src/main/welcome');

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
  assert.match(w.spoken, /^Good afternoon, Sir\. You were away about 45 minutes\. One did not work: email Dana\./);
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

test('an interrupted scheduled task is reported as an unknown outcome', () => {
  const w = buildWelcome({ lockedAt: T - 30 * MIN, now: T, history: [{ text: 'Scheduled: send report', status: 'unknown', ts: T - MIN }] });
  assert.match(w.spoken, /outcome of a scheduled task is unknown: send report/);
  assert.equal(briefingCard(w, '').items[0].title, 'Check outcome');
});

test('an older unresolved outcome remains visible until reviewed', () => {
  const w = buildWelcome({ lockedAt: T - 10 * MIN, now: T, history: [
    { text: 'Scheduled: send report', status: 'unknown', ts: T - 2 * 60 * MIN },
    { text: 'Scheduled: reviewed', status: 'resolved', ts: T - MIN },
    { text: 'future', status: 'unknown', ts: T + MIN }
  ] });
  assert.match(w.spoken, /outcome of a scheduled task is unknown: send report/);
  assert.doesNotMatch(w.spoken, /reviewed|future/);
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
  assert.ok(!/Finished while|finished while/.test(w.spoken), 'urgent items are spoken before completed work');
  assert.match(w.lines.join(' '), /battery/);
});

test('unlock greeting does not interrupt work, a meeting, or a re-locked Mac', () => {
  assert.equal(canDeliverWelcome({ state: 'idle' }), true);
  assert.equal(canDeliverWelcome({ state: 'done' }), true);
  for (const state of ['working', 'listening', 'input', 'confirm', 'finishing']) assert.equal(canDeliverWelcome({ state }), false);
  assert.equal(canDeliverWelcome({ locked: true }), false);
  assert.equal(canDeliverWelcome({ meeting: true }), false);
});

test('unlock reactor never replaces or dismisses a newer request', () => {
  let callback;
  const messages = [];
  const overlay = { hudEntry: null, hudState: {}, hud(msg) { messages.push(msg); this.hudState = msg; this.hudEntry = msg.hide ? null : {}; } };
  assert.equal(showWelcomeReactor(overlay, 'Good morning, Sir.', { setTimer: (fn) => { callback = fn; } }), true);
  assert.equal(messages[0].reply, 'Good morning, Sir.');
  assert.equal(showWelcomeReactor(overlay, 'Second'), false);
  overlay.hudState = { state: 'listening' }; // a new ask replaced the welcome
  callback();
  assert.equal(messages.length, 1, 'the timer does not hide the new request');
  overlay.hudEntry = null;
  showWelcomeReactor(overlay, 'Good evening, Sir.', { setTimer: (fn) => { callback = fn; } });
  callback();
  assert.deepEqual(messages.at(-1), { hide: true });
});

test('welcome reactor can remain visible until its briefing is dismissed', () => {
  let timerCalls = 0;
  const overlay = { hudEntry: null, hudState: {}, hud(msg) { this.hudState = msg; this.hudEntry = {}; } };
  assert.equal(showWelcomeReactor(overlay, 'Good morning, Sir.', { duration: null, setTimer: () => { timerCalls++; } }), true);
  assert.equal(timerCalls, 0);
  assert.match(overlay.hudState.welcomeToken, /^welcome-/);
});

test('plain wording for long absences and a meeting later today', () => {
  assert.equal(awayWords(25 * MIN), 'about 25 minutes');
  assert.equal(awayWords(3 * 3600e3), 'about 3 hours');
  assert.equal(awayWords(50 * 3600e3), 'about 2 days');
  const w = buildWelcome({ lockedAt: T - 20 * MIN, now: T, events: [{ title: 'Lab', start: T + 2 * 3600e3 }] });
  assert.match(w.spoken, /Next up: Lab at 2 PM\./);
});

test('unlock begins greeting before a slow briefing and waits for it before details',async()=>{
 const {deliverInStages}=require('../src/main/welcome');const order=[];let release,voiceDone;
 const pending=deliverInStages({canDeliver:()=>true,begin:()=>{order.push('greeting');return new Promise(r=>voiceDone=r);},collect:()=>{order.push('checking');return new Promise(r=>release=r);},finish:()=>order.push('details')});
 assert.deepEqual(order,['greeting','checking']);release({});await new Promise(r=>setImmediate(r));assert(!order.includes('details'));voiceDone();assert.equal(await pending,true);assert.deepEqual(order,['greeting','checking','details']);
});
test('a newly locked or busy Mac receives no late briefing',async()=>{
 const {deliverInStages}=require('../src/main/welcome');let allowed=true,release,finished=false;
 const pending=deliverInStages({canDeliver:()=>allowed,begin:()=>{},collect:()=>new Promise(r=>release=r),finish:()=>{finished=true;}});allowed=false;release({});await pending;assert.equal(finished,false);
});

test('the welcome-back card closes by itself (it must not inherit the daily briefing menu\'s "stay until closed"), which also releases the reactor held behind it', () => {
  const facts = { now: new Date('2026-11-02T12:00:00Z'), missing: [] };
  const w = { priorities: [{ label: 'Next', text: 'Class at 3.' }] };
  const card = briefingCard(w, 'All good.', 'Sir', facts);
  assert.equal(card.hold, false); assert.match(card.title, /Welcome back, Sir/);
  assert.equal(require('../src/main/briefing').briefingCard(facts, '').hold, true, 'the daily briefing itself still stays until you close it');
});

test('welcome cleanup waits for the details voice to finish', async () => {
 const {deliverInStages}=require('../src/main/welcome'); let finishVoice, cleaned=false;
 const pending=deliverInStages({canDeliver:()=>true,begin:()=>{},collect:async()=>({}),finish:()=>new Promise(r=>finishVoice=r)}).finally(()=>cleaned=true);
 await new Promise(r=>setImmediate(r)); assert.equal(cleaned,false);finishVoice();await pending;assert.equal(cleaned,true);
});
