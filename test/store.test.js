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
  assert.equal(s.get('settings.look'), 'jarvis', 'the Jarvis look is the default');
  assert.equal(s.get('settings.buddy'), true);
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

test('the settings file is written readable by its owner only, even when an older loose one is replaced', () => {
  const dir = tmp();
  const s = new Store(dir);
  s.set('settings.look', 'jarvis'); s.flush();
  assert.equal(fs.statSync(path.join(dir, 'relay.json')).mode & 0o077, 0, 'no group or other access');
  fs.chmodSync(path.join(dir, 'relay.json'), 0o644);
  s.set('settings.look', 'jarvis2'); s.flush();
  assert.equal(fs.statSync(path.join(dir, 'relay.json')).mode & 0o777, 0o600, 'the next save tightens an older loose file');
});

test('routine persistence yields while writing and cannot overwrite a newer explicit flush',async()=>{
 const dir=tmp();let release,started;const writing=new Promise(r=>started=r);
 const io={...fs.promises,writeFile:async(...args)=>{started();await new Promise(r=>release=r);return fs.promises.writeFile(...args);}};
 const s=new Store(dir,{io});s.set('settings.look','old');const pending=s.saveAsync();await writing;
 s.set('settings.look','new');s.flush();release();await pending;
 assert.equal(new Store(dir).get('settings.look'),'new');assert.equal(fs.statSync(s.file).mode&0o777,0o600);
 assert.deepEqual(fs.readdirSync(dir),['relay.json']);fs.rmSync(dir,{recursive:true});
});
test('failed background saves preserve existing data and report a bounded error code',async()=>{
 const dir=tmp(),errors=[];const s=new Store(dir,{onError:e=>errors.push(e)});s.flush();const before=fs.readFileSync(s.file,'utf8');
 s.io={...fs.promises,writeFile:async()=>{throw Object.assign(Error('private path'),{code:'ENOSPC'});}};
 s.set('settings.look','new');await s.saveAsync();assert.equal(fs.readFileSync(s.file,'utf8'),before);assert.deepEqual(errors,['ENOSPC']);
 s.io=fs.promises;await s.saveAsync();assert.equal(new Store(dir).get('settings.look'),'new');assert.equal(s.lastError,null);fs.rmSync(dir,{recursive:true});
});
