const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Store, merge } = require('../src/main/store');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'relay-'));

test('defaults, persistence and nested set/get', () => {
  const dir = tmp();
  const s = new Store(dir);
  assert.equal(s.get('settings.shortcuts.ask.code'), 'AltRight');
  s.set('settings.model.provider', 'ollama');
  s.flush();
  const s2 = new Store(dir);
  assert.equal(s2.get('settings.model.provider'), 'ollama');
  assert.equal(s2.get('settings.playSounds'), true);
});

test('older files missing new keys are filled from defaults', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'relay.json'), JSON.stringify({ settings: { playSounds: false } }));
  const s = new Store(dir);
  assert.equal(s.get('settings.playSounds'), false);
  assert.equal(s.get('settings.firefox.port'), 47831);
});

test('corrupt file falls back to defaults', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'relay.json'), '{nope');
  assert.equal(new Store(dir).get('onboardingDone'), false);
});

test('stats', () => {
  const s = new Store(tmp());
  s.addHistory({ id: '1', text: 'what apps do I have open', status: 'done', ts: 1 });
  s.addAction({ id: 'a' });
  assert.deepEqual([s.stats().requests, s.stats().actions, s.stats().words], [1, 1, 6]);
});

test('merge keeps arrays from the override', () => {
  assert.deepEqual(merge({ a: [1] }, { a: [2, 3] }), { a: [2, 3] });
});

test('version 1 files move to the Claude sign-in and gain dictation settings', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'relay.json'), JSON.stringify({ onboardingDone: true, settings: { model: { provider: 'ollama', ollamaModel: 'x' } } }));
  const s = new Store(dir);
  assert.equal(s.get('settings.model.provider'), 'claude');
  assert.equal(s.get('settings.model.ollamaModel'), 'x');
  assert.equal(s.get('settings.shortcuts.dictate.code'), 'MetaRight');
  assert.equal(s.get('onboardingDone'), false);
});

test('model service presets get defaults without touching an existing choice', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'relay.json'), JSON.stringify({ schema: 3, onboardingDone: true, settings: { model: { provider: 'anthropic', anthropicModel: 'x' } } }));
  const s = new Store(dir);
  assert.equal(s.get('settings.model.provider'), 'anthropic');
  assert.equal(s.get('settings.model.presets.openai.model'), 'gpt-4.1-mini');
  assert.equal(s.get('settings.model.presets.openai.keyEnc'), '');
  assert.equal(s.get('settings.model.presets.custom.url'), '');
  s.set('settings.model.presets.gemini.keyEnc', 'k');
  assert.equal(s.get('settings.model.presets.gemini.keyEnc'), 'k');
  assert.equal(s.get('settings.model.presets.groq.keyEnc'), '');
});

test('dictation counts toward words', () => {
  const s = new Store(tmp());
  s.addDictation({ id: 'd', text: 'can we move our call to Thursday', ts: 1 });
  assert.equal(s.stats().words, 7);
});
