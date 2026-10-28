const test = require('node:test');
const assert = require('node:assert/strict');
const { parseAssistCommand, findQuestion, QuestionWatcher, Assistant, parseQuick, parseResearch, quickPrompt, SYSTEM } = require('../src/main/assist');

test('the phrases that start, stop and test the assistant, and "end the meeting" is not one of them', () => {
  const P = parseAssistCommand;
  for (const t of ['meeting assistant', 'start the meeting assistant', 'answer questions in this meeting', 'listen for questions', 'turn on private answers', 'quietly answer questions for me']) assert.deepEqual(P(t), { type: 'assist-start' }, t);
  for (const t of ['stop the meeting assistant', 'stop answering', 'stop answering questions', 'turn off the assistant', 'meeting assistant off']) assert.deepEqual(P(t), { type: 'assist-stop' }, t);
  for (const t of ['test the private window', 'test the hidden window', 'is the private window hidden']) assert.deepEqual(P(t), { type: 'assist-test' }, t);
  for (const t of ['end the meeting', 'take meeting notes', 'what is the weather', 'answer my email', 'start a timer']) assert.equal(P(t), null, t);
});

test('a question put to you is found, with filler and your name stripped, and chatter and statements are not', () => {
  const Q = (t, o) => findQuestion(t, o);
  assert.equal(Q('Thanks everyone. So, what is the speed of light in a vacuum?'), 'what is the speed of light in a vacuum?');
  assert.equal(Q('Okay. Sergey, how long does it take sunlight to reach Earth?', { names: ['Sergey'] }), 'how long does it take sunlight to reach Earth?');
  assert.equal(Q('we should talk about the schedule can you walk me through the budget for the robot'), 'can you walk me through the budget for the robot', 'no punctuation at all');
  assert.equal(Q('That is great work. Do not forget the deadline.'), null);
  assert.equal(Q('Can you all hear me?'), null);
  assert.equal(Q('Does that make sense?'), null);
  assert.equal(Q('Any questions?'), null);
  assert.equal(Q('Right?'), null);
  assert.equal(Q('what?'), null, 'too short to be worth answering');
  assert.equal(Q('The robot weighs 120 pounds.'), null);
  assert.equal(Q('We talked about it. Is the deadline on the fifth or the sixth?'), 'Is the deadline on the fifth or the sixth?');
  assert.equal(Q('Why is the sky blue? Anyway moving on.'), 'Why is the sky blue?', 'a question a sentence back still counts');
  // name-only mode: the question has to be to you
  const o = { names: ['Sergey', 'Serge'], mode: 'name' };
  assert.equal(Q('How does a PID loop work?', o), null);
  assert.equal(Q('Sergey, how does a PID loop work?', o), 'how does a PID loop work?');
  assert.equal(Q('Sergey. How does a PID loop work?', o), 'How does a PID loop work?', 'the name in the sentence before');
  assert.equal(Q('How does a PID loop work, Sergey?', o), 'How does a PID loop work?');
});

function clock() {
  const timers = []; let now = 0;
  return { setTimer: (f, ms) => { const t = { f, ms, on: true }; timers.push(t); return t; }, clearTimer: (t) => { if (t) t.on = false; }, now: () => now, advance: (ms) => { now += ms; }, fire: () => { const t = [...timers].reverse().find((x) => x.on); if (t) { t.on = false; t.f(); } }, last: () => [...timers].reverse().find((x) => x.on) };
}

test('the watcher waits for a pause, answers each question once, and starts over when the recognizer does', () => {
  const c = clock();
  const got = [];
  const w = new QuestionWatcher({ ...c, onQuestion: (x) => got.push(x.question) });
  w.push('so what is the');
  w.push('so what is the speed of light');
  assert.equal(got.length, 0, 'still talking');
  assert.equal(c.last().ms, 800);
  w.push('so what is the speed of light in a vacuum?');
  assert.equal(c.last().ms, 450, 'a question mark is a quicker pause');
  c.fire();
  assert.deepEqual(got, ['what is the speed of light in a vacuum?']);
  w.push('so what is the speed of light in a vacuum? And the second one.');
  c.fire();
  assert.equal(got.length, 1, 'the same question is not asked twice');
  w.push('so what is the speed of light in a vacuum? And the second one. How far is the moon?');
  c.fire();
  assert.deepEqual(got, ['what is the speed of light in a vacuum?', 'How far is the moon?']);
  w.flush('How far is the moon?');
  w.push('Why is the sky blue?');
  c.fire();
  assert.equal(got.at(-1), 'Why is the sky blue?', 'after a new stretch begins');
  const late = new QuestionWatcher({ ...c, onQuestion: (x) => got.push(`late:${x.question}`) });
  late.push('Tell me about the robot design');
  late.flush('Tell me about the robot design for this season?');
  assert.equal(got.at(-1), 'late:Tell me about the robot design for this season?', 'a question cut by the end of a stretch is still caught');
});

test('model replies are read: the local tag, need-to-check, and the verdict with its sources', () => {
  assert.deepEqual(parseQuick('[local] We planned Friday.\n- from the call'), { text: 'We planned Friday.\n- from the call', local: true, needsCheck: false });
  assert.equal(parseQuick('Need to check.').needsCheck, true);
  assert.deepEqual(parseResearch('CORRECTION: it is 8 minutes 20 seconds\nSources: https://nasa.gov/x, wikipedia.org'), { verdict: 'correction', text: 'it is 8 minutes 20 seconds', sources: ['nasa.gov', 'wikipedia.org'] });
  assert.deepEqual(parseResearch('CONFIRMED: yes'), { verdict: 'confirmed', text: 'yes', sources: [] });
  assert.equal(parseResearch('something else').verdict, 'new');
  assert.match(quickPrompt({ question: 'why?', context: 'a b c' }), /The question put to them: why\?/);
  assert.match(SYSTEM('Sergey', 'likes robots'), /Sergey's private assistant[^]*likes robots/);
});

test('the assistant streams the first answer, then checks it, and a newer question cancels the older one', async () => {
  const ui = []; const answerer = {
    quick: async (p, { onDelta }) => { for (const d of ['It is ', '299,792 km/s.']) onDelta(d); return 'It is 299,792 km/s.\n- in a vacuum'; },
    research: async () => 'CONFIRMED: yes\nSources: nasa.gov'
  };
  const a = new Assistant({ answerer, ui: { update: (s) => ui.push(s) } });
  const r = await a.handle({ question: 'what is the speed of light?', context: '' });
  assert.deepEqual(ui.map((u) => u.stage), ['thinking', 'quick', 'quick', 'checking', 'checked']);
  assert.equal(ui[1].text, 'It is');
  assert.deepEqual([ui.at(-1).verdict, ui.at(-1).sources], ['confirmed', ['nasa.gov']]);
  assert.equal(r.checked, true);

  const ui2 = []; let release;
  const slow = new Assistant({ ui: { update: (s) => ui2.push(s) }, answerer: { quick: (p, { signal }) => new Promise((res, rej) => { const q = p.includes('first'); if (q) { release = res; signal.addEventListener('abort', () => rej(new Error('aborted'))); } else res('Second answer.'); }), research: async () => 'CONFIRMED: ok' } });
  const p1 = slow.handle({ question: 'first question here?', context: '' });
  const p2 = slow.handle({ question: 'second question here?', context: '' });
  assert.equal(await p1, null, 'the older one is dropped');
  assert.equal((await p2).answer, 'Second answer.');
  assert.ok(ui2.filter((u) => u.question === 'first question here?').every((u) => u.stage === 'thinking'), 'nothing from the old question shows after the new one');

  const local = []; const l = new Assistant({ ui: { update: (s) => local.push(s.stage) }, answerer: { quick: async () => '[local] We said Friday.', research: async () => { throw new Error('should not run'); } } });
  assert.equal((await l.handle({ question: 'when did we say?', context: 'friday' })).checked, false);
  assert.equal(local.at(-1), 'done', 'a question about the conversation is not searched');

  const bad = []; const b = new Assistant({ ui: { update: (s) => bad.push(s.stage) }, log: { error() {} }, answerer: { quick: async () => 'Answer.', research: async () => { throw new Error('offline'); } } });
  await b.handle({ question: 'q q q?', context: '' });
  assert.equal(bad.at(-1), 'unchecked', 'the first answer stays up when the check fails');
  const dead = []; const d = new Assistant({ ui: { update: (s) => dead.push(s.stage) }, log: { error() {} }, answerer: { quick: async () => { throw new Error('no claude'); } } });
  await d.handle({ question: 'q q q?', context: '' });
  assert.equal(dead.at(-1), 'error');
});

const Module = require('node:module');
test('in a meeting, a question heard on the microphone is answered in the private window, quietly, and stopping cleans up', async () => {
  const real = Module._load;
  Module._load = function (req, ...rest) { return req === 'electron' ? { app: {}, screen: {}, BrowserWindow: class {}, ipcMain: {}, Notification: class {}, systemPreferences: {}, desktopCapturer: {}, clipboard: {}, shell: {} } : real.call(this, req, ...rest); };
  let AskController;
  try { ({ AskController } = require('../src/main/askController')); } finally { Module._load = real; }
  const data = { 'settings.meeting.names': 'Sergey, Serge', 'settings.briefing.name': 'Sergey', 'settings.meeting.nameOnly': false, 'settings.model.provider': 'claude' };
  const c = Object.create(AskController.prototype);
  const panel = []; let warmed = 0, closed = 0, started = 0;
  Object.assign(c, {
    store: { get: (k) => data[k] }, assistOn: false, onChange() {}, memoryText: () => '', makeTools: () => [],
    assistPanel: { update: (s) => panel.push(['update', s.stage, s.question]), status: (t) => panel.push(['status', t]), hide: () => panel.push(['hide']), test: async () => panel.push(['test']) },
    meeting: { active: false, recentText: () => 'we are talking about the budget', start: async () => { started++; c.meeting.active = true; } },
    micAllowed: async () => true, overlay: { setArmed() {} }, wake: { disarm() {} }, barge: { disarm() {} }, speaker: { stop() {} }
  });
  c.watcher = new QuestionWatcher({ getNames: () => c.assistNames(), getMode: () => 'any', onQuestion: ({ question }) => c.assistQuestion(question) });
  c.makeAnswerer = () => ({ warm: async () => { warmed++; }, close: () => { closed++; }, quick: async (p, { onDelta }) => { onDelta('Two moons.'); return 'Two moons.'; }, research: async () => 'CONFIRMED: yes\nSources: nasa.gov' });
  assert.deepEqual(c.assistNames(), ['Sergey', 'Serge']);
  const r = await c.assistCommand({ type: 'assist-start' });
  assert.match(r.reply, /Private answers are on/);
  assert.equal(started, 1);
  assert.equal(c.assistOn, true);
  assert.equal(warmed, 1, 'the models start while the microphone opens');
  assert.deepEqual(panel[0], ['status', 'Listening for questions']);
  c.watcher.push('Okay. How many moons does Mars have?');
  c.watcher.check();
  await new Promise((res) => setTimeout(res, 30));
  assert.deepEqual(panel.filter((x) => x[0] === 'update').map((x) => x[1]), ['thinking', 'quick', 'checking', 'checked']);
  assert.equal(panel.find((x) => x[0] === 'update')[2], 'How many moons does Mars have?');
  assert.match((await c.assistCommand({ type: 'assist-test' })).reply, /test box is showing/);
  assert.match((await c.assistCommand({ type: 'assist-stop' })).reply, /off\. I am still taking notes/);
  assert.equal(c.assistOn, false);
  assert.equal(closed, 1);
  assert.deepEqual(panel.at(-2).slice(0, 1), ['test']);
  assert.deepEqual(panel.at(-1), ['hide']);
  c.watcher.push('How many moons does Phobos have?');
  c.watcher.check();
  await new Promise((res) => setTimeout(res, 20));
  assert.equal(panel.filter((x) => x[0] === 'update' && x[2] === 'How many moons does Phobos have?').length, 0, 'nothing is answered once it is off');
  assert.match((await c.assistCommand({ type: 'assist-stop' })).reply, /were not on/);
});
