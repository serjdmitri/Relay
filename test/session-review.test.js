const test = require('node:test'), assert = require('node:assert/strict');
const { suggest, validatePicks, saveFacts, exportText } = require('../src/main/sessionReview');
const mem = require('../src/main/memory');

const entry = (id, request, reply, status = 'done') => ({ id, requestId: 'r' + id, ts: 1, status, request, reply });
const SESSION = {
  id: 's1', title: 'Biology study', entries: [
    entry('e1', "I'm studying for the AP Biology exam on May 8", 'Good luck! Want a study plan?'),
    entry('e2', 'What is the powerhouse of the cell?', 'The mitochondria are the powerhouse of the cell. They make ATP.'),
    entry('e3', 'What is my wifi password', 'Sorry, I do not keep passwords.'),
    entry('e4', 'My locker combination is 12 34 56 and my password is hunter2', 'Noted.'),
    entry('e5', 'Open Safari', 'Done.'),
    entry('e6', 'Do I like pizza?', 'I cannot know that.'),
    entry('e7', 'My teacher is Ms. Lee', 'Okay, got it.'),
    entry('e8', 'Explain photosynthesis', '**Photosynthesis** is how plants turn light, water and carbon dioxide into sugar and oxygen. It happens in chloroplasts.'),
    entry('e9', 'What is the capital of France', 'Paris is the capital of France.', 'failed'),
    entry('e10', 'Tell me about yourself', 'The key is sk-abcdefghijklmnopqrstuvwxyz0123456789 and that is all.'),
    entry('e11', 'Explain photosynthesis', '**Photosynthesis** is how plants turn light, water and carbon dioxide into sugar and oxygen.')
  ]
};

test('suggestions are short lines from your own statements and from replies, labelled, never secrets, never pre-selected', () => {
  const s = suggest(SESSION), by = (id) => s.find((x) => x.entryId === id);
  assert.deepEqual([by('e1').source, by('e1').text], ['you', "I'm studying for the AP Biology exam on May 8"]);
  assert.deepEqual([by('e7').source, by('e7').text], ['you', 'My teacher is Ms. Lee']);
  assert.deepEqual([by('e2').source, by('e2').text], ['relay', 'The mitochondria are the powerhouse of the cell']);
  assert.equal(by('e8').text, 'Photosynthesis is how plants turn light, water and carbon dioxide into sugar and oxygen', 'markdown is stripped and the closing full stop dropped, as memory does');
  for (const id of ['e3', 'e4', 'e5', 'e6', 'e9', 'e10', 'e11']) assert.equal(by(id), undefined, id);
  assert.ok(s.every((x) => x.text.length <= mem.MAX_LEN && !mem.isSecret(x.text) && x.context !== undefined));
  assert.ok(s.every((x) => !('selected' in x)), 'nothing is ticked for you');
  assert.deepEqual(suggest(null), []); assert.deepEqual(suggest({ entries: [null, {}, { id: 'x', status: 'done' }] }), []);
  assert.equal(suggest({ entries: Array.from({ length: 80 }, (_, i) => entry('n' + i, `My favorite number is ${i} and more words`, 'ok')) }).length, 40);
});

test('what you tick is checked again: it must belong to the session, fit, and not be a secret', () => {
  const r = validatePicks(SESSION, [
    { entryId: 'e1', text: '  I study AP Biology.  ' }, { entryId: 'e7', text: 'My teacher is Ms. Lee' }, { entryId: 'zzz', text: 'Not in this session' },
    { entryId: 'e2', text: '' }, { entryId: 'e4', text: 'My password is hunter2' }, { entryId: 'e8', text: 'x'.repeat(300) }, { entryId: 'e1', text: 'i study ap biology' }, null
  ]);
  assert.deepEqual(r.ok, [{ entryId: 'e1', text: 'I study AP Biology' }, { entryId: 'e7', text: 'My teacher is Ms. Lee' }]);
  assert.deepEqual(r.rejected.map((x) => x.why.slice(0, 22)), ['That note is not in th', 'The line is empty.', 'It looks like a passwo', 'A memory can be at mos', 'That note is not in th']);
  assert.deepEqual(validatePicks(SESSION, 'nope'), { ok: [], rejected: [] });
  assert.equal(validatePicks(SESSION, Array.from({ length: 200 }, () => ({ entryId: 'e1', text: 'same' }))).ok.length, 1);
});

test('saving adds only the ticked facts to memory, skips what is already remembered, and says what it did', () => {
  const start = [{ id: 'old', text: 'My teacher is Ms. Lee and she teaches biology', ts: 5 }];
  let n = 0; const id = () => 'id' + ++n;
  const r = saveFacts(start, [{ entryId: 'e1', text: 'I study AP Biology' }, { entryId: 'e7', text: 'My teacher is Ms. Lee' }, { entryId: 'e2', text: 'The mitochondria are the powerhouse of the cell' }], { now: 99, id });
  assert.deepEqual(r.added.map((f) => f.text), ['I study AP Biology', 'The mitochondria are the powerhouse of the cell']);
  assert.deepEqual(r.skipped, [{ text: 'My teacher is Ms. Lee', why: 'Relay already remembers that.' }]);
  assert.equal(r.list.length, 3); assert.ok(r.list.every((f) => f.text && f.id && f.ts));
  assert.equal(r.list.find((f) => f.id === 'old').text, 'My teacher is Ms. Lee and she teaches biology', 'existing memories are untouched');
  assert.deepEqual(start.map((f) => f.id), ['old'], 'the original list is not changed');
  const full = Array.from({ length: mem.MAX_FACTS }, (_, i) => ({ id: 'f' + i, text: 'fact number ' + i, ts: i }));
  assert.deepEqual(saveFacts(full, [{ entryId: 'e1', text: 'One too many' }]).skipped, [{ text: 'One too many', why: 'Memory is full.' }]);
  assert.deepEqual(saveFacts([], []).added, []);
});

test('the export holds only the chosen lines and says they are not verified', () => {
  const text = exportText(SESSION, [{ entryId: 'e1', text: 'I study AP Biology' }, { entryId: 'e2', text: 'The mitochondria are the powerhouse of the cell' }]);
  assert.match(text, /^Facts chosen from the session "Biology study" \(picked and edited by you; Relay's replies are not independently verified\):\n\n- I study AP Biology\n- The mitochondria/);
  assert.ok(!text.includes('Open Safari') && !text.includes('hunter2') && !text.includes('locker'));
});
