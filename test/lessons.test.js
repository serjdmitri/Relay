const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../src/main/lessons');
const DAY = 86400e3;

test('the correction gate catches corrections and ignores normal requests', () => {
  for (const t of ["No, that's wrong", 'not what I asked', 'I meant the other folder', "that was the wrong file", 'not that one', "don't use that again", 'you got that wrong']) assert.equal(L.looksLikeCorrection(t), true, t);
  for (const t of ['open Safari', 'what is the weather', 'I wanted to ask about the weather', 'remember that I like tea', 'ok']) assert.equal(L.looksLikeCorrection(t), false, t);
});

test('a lesson reply parses; "once" scope, secrets and junk are dropped', () => {
  assert.deepEqual(L.parseLesson('{"trigger":"asks to open my notes","fix":"open the Obsidian vault, not Apple Notes","scope":"always","confidence":0.8}'), { trigger: 'asks to open my notes', fix: 'open the Obsidian vault, not Apple Notes', conf: 0.8 });
  assert.equal(L.parseLesson('{"trigger":"a","fix":"b","scope":"once"}'), null);
  assert.equal(L.parseLesson('{"trigger":"my password is hunter2","fix":"use it","scope":"always"}'), null);
  assert.equal(L.parseLesson('no idea'), null);
  assert.equal(L.parseLesson('{"trigger":"x"}'), null);
});

test('two corrections within 30 seconds make one lesson; a later copy reinforces it', () => {
  const a = L.addLesson([], { trigger: 'open my notes', fix: 'use the Obsidian vault' }, { id: 'a', now: 1000000 });
  assert.equal(a.added, true);
  const same = L.addLesson(a.list, { trigger: 'open notes', fix: 'use Obsidian vault' }, { now: 1000000 + 10000 });
  assert.equal(same.added, false); assert.equal(same.list.length, 1); assert.equal(same.list[0].conf, a.list[0].conf);
  const later = L.addLesson(a.list, { trigger: 'open my notes', fix: 'use the Obsidian vault' }, { now: 1000000 + 60000 });
  assert.equal(later.reinforced, true); assert.ok(later.list[0].conf > a.list[0].conf);
  const other = L.addLesson(a.list, { trigger: 'send an email', fix: 'ask who it goes to' }, { id: 'b', now: 1000000 + 5000 });
  assert.equal(other.added, false); // a different lesson but only 5 seconds later: still one correction
  assert.equal(L.addLesson(a.list, { trigger: 'send an email', fix: 'ask who it goes to' }, { id: 'b', now: 1000000 + 40000 }).added, true);
});

test('only lessons that match the request are picked, capped at 8 and by size', () => {
  const now = 10 * DAY;
  const list = Array.from({ length: 12 }, (_, i) => ({ id: `l${i}`, trigger: `open the ${'report'} number${i}`, fix: 'use the shared drive', conf: 0.9, ts: now, lastUsed: 0 }));
  list.push({ id: 'x', trigger: 'play music', fix: 'use Spotify', conf: 0.9, ts: now });
  const picked = L.pickLessons(list, 'please open the report from drive', { now });
  assert.equal(picked.length, 8);
  assert.ok(!picked.some((p) => p.id === 'x'));
  assert.deepEqual(L.pickLessons(list, 'zzzz qqqq', { now }), []);
  assert.equal(L.pickLessons([{ id: 'big', trigger: 'open report', fix: 'x'.repeat(2000), conf: 1, ts: now }], 'open report', { now }).length, 0);
  assert.match(L.lessonContext(L.pickLessons(list, 'play music', { now })), /Spotify/);
});

test('confidence halves every 45 days and a faded lesson stops being used', () => {
  const l = { id: 'a', trigger: 'open notes', fix: 'obsidian', conf: 0.8, ts: 0, lastUsed: 0 };
  assert.ok(Math.abs(L.currentConf(l, 45 * DAY) - 0.4) < 1e-9);
  assert.equal(L.pickLessons([l], 'open notes', { now: 45 * DAY }).length, 1);
  assert.equal(L.pickLessons([l], 'open notes', { now: 200 * DAY }).length, 0);
  const used = L.markUsed([l], [l], 40 * DAY);
  assert.equal(used[0].uses, 1);
  assert.ok(L.currentConf(used[0], 45 * DAY) > 0.7); // using it restarts the clock
});

test('inferred facts wait for approval, expire after 30 days, and only approved ones reach a request', () => {
  const now = 100 * DAY;
  let list = L.proposeInferred([], ['Usually codes in Python', 'Swims in the morning'], [{ text: 'I swim in the morning' }], { now, ids: (() => { let n = 0; return () => `i${n++}`; })() });
  assert.deepEqual(list.map((x) => x.text), ['Usually codes in Python']); // the second is already known
  assert.equal(L.inferredContext(list, { now }), '');
  list = L.approveInferred(list, 'i0', now);
  assert.match(L.inferredContext(list, { now }), /Python/);
  list = L.proposeInferred(list, ['Likes dark mode'], [], { now, ids: () => 'i1' });
  assert.equal(L.expireInferred(list, now + 31 * DAY).length, 1);
  assert.equal(L.expireInferred(list, now + 10 * DAY).length, 2);
  assert.equal(L.inferredContext(list, { now: now + 400 * DAY }), ''); // approved but faded
  assert.equal(L.editInferred(list, 'i0', 'my password is 1234').find((x) => x.id === 'i0').text, 'Usually codes in Python');
  assert.equal(L.editInferred(list, 'i0', 'Codes in Rust').find((x) => x.id === 'i0').text, 'Codes in Rust');
  assert.equal(L.removeById(list, 'i1').length, 1);
});

test('model replies for guesses parse and drop secrets', () => {
  assert.deepEqual(L.parseInferred('["Codes in Python", "my card number is 4111 1111 1111 1111", "x"]'), ['Codes in Python', 'x']);
  assert.deepEqual(L.parseInferred('nothing'), []);
  assert.equal(L.parseInferred('["a","b","c","d"]').length, 3);
});
