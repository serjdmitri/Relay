const test = require('node:test');
const assert = require('node:assert/strict');
const { parseMemory, isSecret, addFact, removeFacts, memoryContext } = require('../src/main/memory');

test('remember, forget and recall are understood, the way speech writes them', () => {
  assert.deepEqual(parseMemory('Remember that my name is Sergey.'), { type: 'remember', fact: 'my name is Sergey' });
  assert.deepEqual(parseMemory('hey Jarvis, remember I am vegetarian'), { type: 'remember', fact: 'I am vegetarian' });
  assert.deepEqual(parseMemory('Please remember my sister is Anna'), { type: 'remember', fact: 'my sister is Anna' });
  assert.deepEqual(parseMemory('forget that I am vegetarian'), { type: 'forget', query: 'I am vegetarian' });
  assert.deepEqual(parseMemory('Forget about my sister.'), { type: 'forget', query: 'my sister' });
  assert.deepEqual(parseMemory('forget everything you know about me'), { type: 'forget-all' });
  assert.deepEqual(parseMemory('What do you remember about me?'), { type: 'recall' });
});

test('things that only look like memory commands are left alone', () => {
  assert.equal(parseMemory('remember to call mom at 5'), null); // a reminder
  assert.equal(parseMemory('remember this as morning setup'), null); // a saved routine
  assert.equal(parseMemory('remember that as morning setup'), null);
  assert.equal(parseMemory('open Notes'), null);
  assert.equal(parseMemory('forget it'), null);
});

test('secrets are not kept', () => {
  assert.equal(isSecret('my wifi password is hunter2'), true);
  assert.equal(isSecret('my card number is 4111 1111 1111 1111'), true);
  assert.equal(isSecret('my ssn is 123-45-6789'), true);
  assert.equal(isSecret('I am vegetarian'), false);
  assert.equal(isSecret('my phone number is 305 555 0100'), false);
});

test('facts are added once, a fuller version replaces a shorter one, and forgetting matches by words', () => {
  let list = [];
  ({ list } = addFact(list, 'my sister is Anna', { id: 'a' }));
  assert.equal(addFact(list, 'My sister is Anna').added, false);
  ({ list } = addFact(list, 'my sister is Anna and she lives in Boston', { id: 'b' }));
  assert.deepEqual(list.map((f) => f.id), ['b']);
  ({ list } = addFact(list, 'I prefer Firefox', { id: 'c' }));
  const r = removeFacts(list, 'sister boston');
  assert.deepEqual(r.removed.map((f) => f.id), ['b']);
  assert.deepEqual(r.list.map((f) => f.id), ['c']);
  assert.deepEqual(removeFacts(list, '').removed, []);
});

test('the model sees the newest facts within a budget', () => {
  const list = Array.from({ length: 100 }, (_, i) => ({ id: String(i), text: `fact number ${i} ${'x'.repeat(40)}`, ts: i }));
  const ctx = memoryContext(list, 500);
  assert.match(ctx, /^What the user has told Relay to remember/);
  assert.ok(ctx.length < 700);
  assert.equal(memoryContext([]), '');
});
