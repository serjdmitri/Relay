const test = require('node:test');
const assert = require('node:assert/strict');
const { applyReplacements, applyDictationCommands, applyStyle, styleFor } = require('../src/main/dictation');

test('word fixes: whole words, any case, capitalization carried over', () => {
  const rules = [{ from: 'superbase', to: 'Supabase' }, { from: 'open ai', to: 'OpenAI' }, { from: 'gonna', to: 'going to' }];
  assert.equal(applyReplacements('We use superbase and Superbase.', rules), 'We use Supabase and Supabase.');
  assert.equal(applyReplacements('I asked open ai about it', rules), 'I asked OpenAI about it');
  assert.equal(applyReplacements('Gonna be great, gonna', rules), 'Going to be great, going to');
  assert.equal(applyReplacements('superbases are not superbase-d', [{ from: 'superbase', to: 'X' }]), 'superbases are not X-d'.replace('X-d', 'X-d'));
  assert.equal(applyReplacements('SUPERBASE', [{ from: 'superbase', to: 'supabase' }]), 'SUPABASE');
  assert.equal(applyReplacements('nothing to fix', rules), 'nothing to fix');
  assert.equal(applyReplacements('x', [{ from: '', to: 'y' }]), 'x');
});

test('new line and new paragraph', () => {
  assert.equal(applyDictationCommands('Hello. New line. How are you?').text, 'Hello.\nHow are you?');
  assert.equal(applyDictationCommands('first thing new paragraph second thing').text, 'first thing\n\nSecond thing');
  assert.equal(applyDictationCommands('Dear Sam, new line thanks for the update.').text, 'Dear Sam,\nThanks for the update.');
});

test('scratch that: drops what came before in the same breath, alone it asks to undo', () => {
  assert.deepEqual(applyDictationCommands('Send it tomorrow. Scratch that. Send it Friday.'), { text: 'Send it Friday.', scratchOnly: false });
  assert.deepEqual(applyDictationCommands('Scratch that.'), { text: '', scratchOnly: true });
  assert.deepEqual(applyDictationCommands('delete that'), { text: '', scratchOnly: true });
  assert.deepEqual(applyDictationCommands('one scratch that two scratch that'), { text: '', scratchOnly: true });
  assert.deepEqual(applyDictationCommands('plain sentence'), { text: 'plain sentence', scratchOnly: false });
  assert.deepEqual(applyDictationCommands('   '), { text: '', scratchOnly: false });
});

test('app styles', () => {
  assert.deepEqual(applyStyle('Sounds good, see you at 5.', 'casual'), { text: 'sounds good, see you at 5', pressReturn: false });
  assert.deepEqual(applyStyle("I'm on my way.", 'chat'), { text: "I'm on my way", pressReturn: true });
  assert.deepEqual(applyStyle('Are you coming?', 'casual'), { text: 'are you coming?', pressReturn: false });
  assert.deepEqual(applyStyle('Hello.', 'default'), { text: 'Hello.', pressReturn: false });
  assert.deepEqual(applyStyle('NASA launched it.', 'casual'), { text: 'NASA launched it', pressReturn: false });
  assert.equal(styleFor([{ app: 'Messages', style: 'chat' }], 'messages'), 'chat');
  assert.equal(styleFor([{ app: 'Messages', style: 'chat' }], 'Notes'), 'default');
  assert.equal(styleFor([], null), 'default');
});
