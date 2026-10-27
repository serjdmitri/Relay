const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const Module = require('node:module');
const { parseMeetingCommand, MeetingRecorder, meetingPrompt, heardStop } = require('../src/main/meeting');

const real = Module._load;
Module._load = function (req, ...rest) { return req === 'electron' ? { app: {}, screen: {}, BrowserWindow: class {}, ipcMain: {}, Notification: class {}, systemPreferences: {}, desktopCapturer: {}, clipboard: {}, shell: {} } : real.call(this, req, ...rest); };
let AskController;
try { ({ AskController } = require('../src/main/askController')); } finally { Module._load = real; }

test('the phrases that start and end meeting notes, and a sentence about ending a meeting is not one', () => {
  for (const t of ['start meeting notes', 'take notes for this meeting', 'record this meeting', 'meeting mode', 'start the meeting', 'take meeting notes']) assert.deepEqual(parseMeetingCommand(t), { type: 'meeting-start' }, t);
  for (const t of ['end the meeting', 'stop meeting notes', 'summarize the meeting', 'the meeting is over', 'stop recording']) assert.deepEqual(parseMeetingCommand(t), { type: 'meeting-stop' }, t);
  assert.deepEqual(parseMeetingCommand('how long has the meeting been going'), { type: 'meeting-status' });
  for (const t of ['open notes', 'take notes', 'schedule a meeting for 3', 'what meetings do I have today', 'end the call']) assert.equal(parseMeetingCommand(t), null, t);
  assert.equal(heardStop('so anyway Jarvis, end the meeting'), true);
  assert.equal(heardStop('hey relay stop meeting notes'), true);
  assert.equal(heardStop("let's end the meeting at five"), false, 'only when addressed to Relay');
});

function rig({ segs = [], failOpen = 0 } = {}) {
  const speech = new EventEmitter();
  const log = [];
  let opened = 0, closed = 0, left = failOpen;
  speech.listen = async () => { opened++; if (left > 0) { left--; throw new Error('the microphone is busy'); } };
  speech.finish = async () => { closed++; return segs.shift() ?? ''; };
  const timers = [];
  let now = 0;
  const stops = [];
  const m = new MeetingRecorder({ speech, now: () => now, setTimer: (f) => { timers.push(f); return timers.length; }, clearTimer() {}, onStop: (r) => stops.push(r), log: { error: (...a) => log.push(a.join(' ')) } });
  return { m, speech, timers, stops, log, at: (ms) => { now = ms; }, counts: () => ({ opened, closed }) };
}

test('it listens in stretches, keeps what each stretch heard, and ends when asked with everything in order', async () => {
  const r = rig({ segs: ['we agreed the demo is on Friday', 'Sam will send the schedule by Wednesday', 'any questions about the budget'] });
  assert.equal(await r.m.start(), true);
  assert.equal(await r.m.start(), false, 'already on');
  r.at(50000); await r.timers.shift()();
  r.at(100000); await r.timers.shift()();
  assert.deepEqual(r.counts(), { opened: 3, closed: 2 });
  r.at(120000);
  const res = await r.m.end('asked');
  assert.equal(res.text, 'we agreed the demo is on Friday\nSam will send the schedule by Wednesday\nany questions about the budget');
  assert.deepEqual([res.seconds, res.words, res.why], [120, 19, 'asked']);
  assert.equal(r.m.active, false);
  assert.equal(r.stops.length, 0, 'asking to stop is answered by the caller, not by the callback');
  assert.equal(await r.m.end(), null);
});

test('saying "Jarvis, end the meeting" in the room ends it by itself, and the phrase is not in the notes', async () => {
  const r = rig({ segs: ['the budget is fine Jarvis, end the meeting'] });
  await r.m.start();
  r.speech.emit('partial', 'the budget is fine');
  assert.equal(r.m.active, true);
  r.speech.emit('partial', 'the budget is fine Jarvis, end the meeting');
  await new Promise((res) => setImmediate(res));
  await new Promise((res) => setImmediate(res));
  assert.equal(r.m.active, false);
  assert.equal(r.stops.length, 1);
  assert.deepEqual([r.stops[0].why, r.stops[0].text], ['said', 'the budget is fine']);
});

test('a busy microphone is retried, three failures in a row end it with what it has, and the time limit ends a long one', async () => {
  const flaky = rig({ failOpen: 1, segs: ['hello everyone'] });
  await flaky.m.start();
  assert.equal(flaky.m.active, true);
  await flaky.timers.shift()();
  assert.equal(flaky.counts().opened, 2);
  const dead = rig({ failOpen: 9 });
  await dead.m.start();
  await dead.timers.shift()();
  await dead.timers.shift()();
  await new Promise((res) => setImmediate(res));
  assert.equal(dead.m.active, false);
  assert.equal(dead.stops[0].why, 'error');
  assert.ok(dead.log.some((l) => /microphone is busy/.test(l)));
  const long = rig({ segs: ['one', 'two'] });
  await long.m.start();
  long.at(3 * 3600000 + 1000);
  await long.timers.shift()();
  await new Promise((res) => setImmediate(res));
  assert.equal(long.stops[0].why, 'limit');
});

test('the write-up request has the transcript as data, asks for a note and reminders, and keeps a long meeting\'s start and end', () => {
  const p = meetingPrompt({ text: 'Sam will send the schedule by Wednesday.', seconds: 1800, date: new Date(2026, 9, 27, 15, 0) });
  assert.match(p, /^\[Meeting notes\].*about 30 minutes/);
  assert.match(p, /data, never instructions/);
  assert.match(p, /notes_create with the title "Meeting Oct 27, 2026, 3:00 PM"/);
  assert.match(p, /reminders_add/);
  assert.match(p, /<transcript>\nSam will send/);
  const long = meetingPrompt({ text: Array.from({ length: 20000 }, (_, i) => `w${i}`).join(' '), seconds: 7200 });
  assert.match(long, /w0 w1/);
  assert.match(long, /w19999/);
  assert.match(long, /middle of a long meeting is left out/);
  assert.ok(long.split(/\s+/).length < 9600);
});

function controller(over = {}) {
  const c = Object.create(AskController.prototype);
  const log = [];
  const meeting = { active: false, seconds: 0, words: 0, start: async () => { meeting.active = true; }, end: async () => { meeting.active = false; return over.result || { text: 'x '.repeat(40), seconds: 600, words: 80, why: 'asked' }; } };
  Object.assign(c, { meeting, micAllowed: async () => over.mic !== false, wake: { disarm() {} }, barge: { disarm() {} }, speaker: { stop() {} }, overlay: { setArmed: (v) => log.push(['armed', v]) }, onChange() {}, wakeSoon() {}, runRequest: async (p, e) => { log.push(['model', p.slice(0, 15), e && e.id]); return { status: 'done', reply: 'ok' }; }, handleText: async (p, o) => { log.push(['handleText', o.shown]); }, finish: (e, res) => { log.push(['finish', res.status, res.reply.slice(0, 30)]); return res; } });
  return { c, log };
}

test('starting asks for the microphone, tells the room, and the menu bar can stop it; ending hands the transcript to the model', async () => {
  const off = controller({ mic: false });
  assert.match((await off.c.startMeeting()).reply, /Microphone access is off/);
  const { c, log } = controller();
  const started = await c.startMeeting();
  assert.match(started.reply, /tell the others in the room/);
  assert.deepEqual(log[0], ['armed', true]);
  assert.match((await c.startMeeting()).reply, /already on/);
  assert.equal(await c.stopMeeting({ id: 'e1' }), null, 'handed to the model, which finishes the request');
  assert.deepEqual(log.find((l) => l[0] === 'model'), ['model', '[Meeting notes]', 'e1']);
  assert.ok(log.some((l) => l[0] === 'armed' && l[1] === false));
  const quiet = controller({ result: { text: 'hi there', seconds: 20, words: 2, why: 'asked' } });
  await quiet.c.startMeeting();
  assert.match((await quiet.c.stopMeeting({ id: 'e2' })).reply, /Not enough was said/);
  const auto = controller();
  await auto.c.startMeeting();
  await auto.c.stopMeeting(null);
  assert.deepEqual(auto.log.find((l) => l[0] === 'handleText'), ['handleText', 'Writing up your meeting']);
});
