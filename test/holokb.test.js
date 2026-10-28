const test = require('node:test');
const assert = require('node:assert/strict');
const { KeyState, ROWS, LABEL, SPECIAL } = require('../src/remote/holokb');

const type = (s, text) => { for (const ch of text) s.press(ch === ' ' ? '{space}' : ch); return s.text; };

test('the first letter is a capital, then lower case, and a capital again after a full stop', () => {
  const s = new KeyState();
  assert.equal(type(s, 'what time is it? and now'), 'What time is it? And now');
  const t = new KeyState();
  assert.equal(type(t, 'hi. ok'), 'Hi. Ok');
  assert.equal(type(new KeyState(), 'a.b'), 'A.b', 'no capital without a space');
});

test('shift once, caps lock on a quick second tap, and off again', () => {
  const s = new KeyState('x');
  s.shift = 'off';
  s.press('{shift}', 1000);
  assert.equal(s.shift, 'once');
  s.press('{shift}', 1200);
  assert.equal(s.shift, 'lock', 'a quick second tap');
  assert.equal(type(s, 'ab'), 'xAB');
  s.press('{shift}', 5000);
  assert.equal(s.shift, 'off');
  s.press('{shift}', 9000);
  s.press('{shift}', 12000);
  assert.equal(s.shift, 'off', 'slow taps toggle');
});

test('backspace, the number and symbol layers, and enter', () => {
  const s = new KeyState();
  type(s, 'cat');
  s.press('{back}');
  assert.equal(s.text, 'Ca');
  s.press('{num}');
  assert.equal(s.layer, 'numbers');
  s.press('7');
  s.press('{sym}');
  s.press('#');
  assert.equal(s.text, 'Ca7#');
  s.press('{abc}');
  assert.equal(s.layer, 'letters');
  s.press('{back}'); s.press('{back}'); s.press('{back}'); s.press('{back}'); s.press('{back}');
  assert.equal(s.text, '');
  assert.equal(s.shift, 'once', 'empty again, so a capital to start');
  assert.deepEqual(s.press('{send}'), { send: true });
  assert.equal(new KeyState().press('{shift}').send, undefined);
});

test('every layer has a send key and a space, every special key has a label, and letters are all there', () => {
  for (const [name, rows] of Object.entries(ROWS)) {
    const keys = rows.flat();
    assert.ok(keys.includes('{send}') && keys.includes('{space}'), name);
    assert.ok(keys.filter((k) => SPECIAL.test(k)).every((k) => k in LABEL), name);
  }
  assert.ok(ROWS.letters.flat().includes('{back}') && ROWS.numbers.flat().includes('{back}'));
  assert.ok(ROWS.symbols.flat().includes('{') && !SPECIAL.test('{'), 'a curly bracket is a letter key, not a special one');
  assert.equal(ROWS.letters.flat().filter((k) => /^[a-z]$/.test(k)).length, 26);
});
