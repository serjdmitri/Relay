const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Store } = require('../src/main/store');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'relay-dh-'));

test('dictation history can be turned off: new dictation is not kept', () => {
  const s = new Store(tmp());
  s.set('settings.saveDictation', false);
  s.addDictation({ id: 'a', text: 'hello there', ts: 1 });
  assert.equal(s.data.dictations.length, 0);
  s.set('settings.saveDictation', true);
  s.addDictation({ id: 'b', text: 'kept', ts: 2 });
  assert.equal(s.data.dictations.length, 1);
});

test('dictation history is on by default', () => {
  assert.equal(new Store(tmp()).get('settings.saveDictation'), true);
});

test('the Dictate shortcut is off by default and can be disabled', () => {
  const s = new Store(tmp());
  assert.equal(s.get('settings.dictation'), true);
  s.set('settings.dictation', false);
  assert.equal(s.get('settings.dictation'), false);
});
