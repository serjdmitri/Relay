const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const { Interview, parseStart, parseReply, factFor, QUESTIONS } = require('../src/main/interview');
const { buildCenter, parseCommandCenter } = require('../src/main/commandCenter');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('the interview starts on request, asks one question at a time and remembers each answer as a labelled fact', () => {
  assert.deepEqual(parseStart('Jarvis, interview me'), { type: 'interview-start' });
  assert.deepEqual(parseStart('get to know me'), { type: 'interview-start' });
  assert.equal(parseStart('interview me about the job'), null);
  let t = 0; const iv = new Interview({ now: () => t });
  assert.equal(iv.active, false);
  assert.match(iv.start(), /^Question 1 of 7/);
  let out = iv.step({ type: 'answer', text: 'Call me Sergey, I build Relay.' });
  assert.equal(out.fact, 'About me: Call me Sergey, I build Relay'); assert.match(out.say, /^Question 2 of 7/);
  out = iv.step({ type: 'skip' }); assert.equal(out.fact, null); assert.match(out.say, /^Question 3 of 7/);
  for (let i = 0; i < QUESTIONS.length - 2; i++) out = iv.step({ type: 'answer', text: 'something' });
  assert.equal(out.done, true); assert.match(out.say, /remembered 6 things/); assert.equal(iv.active, false);
});

test('during an interview: skip, stop, a question or a command leaves it, anything else is an answer; it lapses after ten idle minutes', () => {
  assert.equal(parseReply('skip').type, 'skip'); assert.equal(parseReply("that's enough").type, 'stop');
  assert.equal(parseReply('what time is it').type, 'leave'); assert.equal(parseReply('play some music').type, 'leave');
  assert.equal(parseReply('I like mornings for meetings').type, 'answer');
  let t = 0; const iv = new Interview({ now: () => t }); iv.start();
  assert.equal(iv.active, true); t = 11 * 60000; assert.equal(iv.active, false);
  const s = new Interview(); s.start(); assert.match(s.step({ type: 'stop' }).say, /Okay, I stopped. I remembered 0 things/);
  assert.equal(factFor(0, 'x'.repeat(500)).length, 240);
});

test('the interview is routed before other commands, saves answers without one file each, and writes one file for Sentient OS at the end', () => {
  const ask = read('src/main/askController.js');
  assert.ok(ask.indexOf("require('./interview')") < ask.indexOf('parseSessionCommand(effective)'), 'checked first, so an answer is not taken for a command');
  assert.match(ask, /rememberFact\(out\.fact, \{ noExport: true \}\)/);
  assert.match(ask, /rememberFact\(fact, \{ noExport = false, layer = 'durable' \} = \{\}\)/);
  assert.match(ask, /one text file for Sentient OS/);
});

test('the command center card shows only what could be read, and marks what can be undone', () => {
  const card = buildCenter({ events: [{ title: 'Dentist', start: Date.UTC(2026, 10, 9, 15) }], due: [{ title: 'Call mom' }], tasks: [], guard: { on: true, armed: true, keepAwake: true }, pages: [{ label: 'example.com' }],
    actions: [{ id: 'a1', tool: 'calendar_create', ok: true }, { id: 'a2', tool: 'web_search', ok: false }], undoable: new Set(['a1']) });
  assert.equal(card.title, 'Command center');
  assert.deepEqual(card.items.map((i) => i.title), ['Today', 'Due', 'Running or waiting', 'Owner guard', 'Watching pages', 'Recently']);
  assert.match(card.items[0].note, /Dentist/); assert.equal(card.items[3].subtitle, 'On and watching');
  const recent = card.items.at(-1).note; assert.match(recent, /Did? ?|Web search \(did not work\)/); assert.match(recent, /Created a calendar event \(can be undone\)/);
  const bare = buildCenter({ guard: { on: false } });
  assert.deepEqual(bare.items.map((i) => i.title), ['Owner guard'], 'a source that could not be read is left out, not shown as empty');
  assert.equal(parseCommandCenter('Jarvis, show the command center'), true); assert.equal(parseCommandCenter("what's going on"), true);
  assert.equal(parseCommandCenter('show the dashboard'), false); assert.equal(parseCommandCenter('what is going on with my taxes'), false);
});
