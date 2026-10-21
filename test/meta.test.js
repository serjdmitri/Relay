const test = require('node:test');
const assert = require('node:assert/strict');
const { isUndo, isAgain } = require('../src/main/meta');

test('undo phrases', () => {
  for (const t of ['Undo.', 'undo that', 'Undo it', 'take that back', 'revert that', 'undo the last thing', 'Relay, please undo that']) assert.equal(isUndo(t), true, t);
  for (const t of ['undo the last paragraph of my essay in Pages', 'open notes', 'go back', 'what is an undo']) assert.equal(isUndo(t), false, t);
});

test('do it again phrases', () => {
  for (const t of ['Again.', 'do it again', 'repeat that', 'one more time', 'Do that again', 'same again']) assert.equal(isAgain(t), true, t);
  for (const t of ['again and again until it works please', 'play it again sam', 'open notes']) assert.equal(isAgain(t), false, t);
});
