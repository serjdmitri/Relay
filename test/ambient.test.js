const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const { isLookupQuestion, AmbientLimiter, answerOnce, parseAmbientCommand } = require('../src/main/ambient');
const { AskController } = require('../src/main/askController');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('only factual lookups count: not questions to you, to a person in the room, or chatter', () => {
  for (const q of ['how far is the moon from the earth', 'who wrote Dracula', 'what is the capital of Australia', 'how many ounces are in a pound', 'when was the Eiffel Tower built?', 'why is the sky blue']) assert.equal(isLookupQuestion(q), true, q);
  for (const q of ['what do you want for dinner', 'how was your day', 'can you pass the salt', 'what is wrong with you', 'where are my keys', 'who is that', 'what time is it', 'is it raining', 'do you know what', 'what', 'tell me about the thing you did yesterday at work with the guys and the other group of people'])
    assert.equal(isLookupQuestion(q), false, q);
});

test('it pops in rarely: a few an hour, not twice within 40 seconds, the same question once', () => {
  let t = 1e9; const l = new AmbientLimiter({ perHour: 3, now: () => t });
  assert.equal(l.allow('how far is the moon'), true);
  t += 10000; assert.equal(l.allow('who wrote Dracula'), false, 'too soon');
  t += 40000; assert.equal(l.allow('who wrote Dracula'), true);
  t += 60000; assert.equal(l.allow('How far is the moon?'), false, 'the same question again');
  t += 60000; assert.equal(l.allow('what is the capital of Peru'), true);
  t += 60000; assert.equal(l.allow('who painted the Mona Lisa'), false, 'three this hour');
  t += 3600000; assert.equal(l.allow('who painted the Mona Lisa'), true, 'an hour later');
});

test('the model is asked once, quietly; a SKIP, nothing, or a long ramble means stay quiet', async () => {
  const mk = (text) => ({ step: async (a) => { mk.seen = a; return { text }; } });
  assert.equal(await answerOnce({ provider: mk('About 384,000 kilometres.'), question: 'how far is the moon' }), 'About 384,000 kilometres.');
  assert.match(mk.seen.system, /reply with exactly: SKIP/); assert.deepEqual(mk.seen.tools, []);
  for (const bad of ['SKIP', 'skip.', '', '   ', 'x'.repeat(500)]) assert.equal(await answerOnce({ provider: mk(bad), question: 'q' }), '', JSON.stringify(bad.slice(0, 10)));
});

test('the words', () => {
  assert.deepEqual(parseAmbientCommand('turn on ambient answers'), { type: 'ambient-on' }); assert.deepEqual(parseAmbientCommand('Jarvis, answer questions you hear'), { type: 'ambient-on' });
  assert.deepEqual(parseAmbientCommand('turn off ambient answers'), { type: 'ambient-off' }); assert.deepEqual(parseAmbientCommand('stop answering questions around me'), { type: 'ambient-off' });
  assert.equal(parseAmbientCommand('turn on the lights'), null);
});

function ctl(over = {}) {
  const shown = []; const c = Object.create(AskController.prototype);
  const cfg = { enabled: true, localOnly: true }; const model = { ollamaModel: 'llama3', ollamaUrl: 'http://127.0.0.1:11434' };
  Object.assign(c, { ambient: { on: true, limiter: new AmbientLimiter({ perHour: 5 }), hideTimer: null, seq: 0 }, ambientWatcher: { reset() {} }, state: 'idle', speaker: { speaking: false }, meeting: { active: false }, assistOn: false, offline: false,
    store: { get: (k) => ({ 'settings.ambient': cfg, 'settings.model': model, 'settings.proactive': {}, 'settings.wake.enabled': true })[k], set: (k, v) => { if (k === 'settings.ambient') Object.assign(cfg, v); } }, onChange() {},
    assistPanel: { update: (s) => shown.push(s), hide() {} }, ensureOllama: () => {}, ambientProvider: () => ({ step: async () => ({ text: 'About 384,000 km.' }) }), ...over });
  return { c, shown };
}

test('a question heard while idle shows quietly; not during a meeting, a conversation, speech, or when switched off', async () => {
  const a = ctl(); await a.c.ambientQuestion('how far is the moon from the earth');
  assert.equal(a.shown.length, 1); assert.equal(a.shown[0].stage, 'done'); assert.equal(a.shown[0].text, 'About 384,000 km.'); clearTimeout(a.c.ambient.hideTimer);
  for (const over of [{ meeting: { active: true } }, { state: 'listening' }, { speaker: { speaking: true } }, { offline: true }, { assistOn: true }]) { const x = ctl(over); await x.c.ambientQuestion('how far is the moon from the earth'); assert.equal(x.shown.length, 0, JSON.stringify(Object.keys(over))); }
  const off = ctl(); off.c.ambient.on = false; await off.c.ambientQuestion('how far is the moon from the earth'); assert.equal(off.shown.length, 0);
  const none = ctl({ ambientProvider: () => null }); await none.c.ambientQuestion('how far is the moon from the earth'); assert.equal(none.shown.length, 0, 'no local model: quiet');
});

test('turning it on needs Hey Jarvis and a local model; and it is wired off by default, fed only by the wake listener, never saved', () => {
  const a = ctl({ store: { get: (k) => ({ 'settings.ambient': { enabled: false, localOnly: true }, 'settings.model': {}, 'settings.wake.enabled': true })[k], set() {} } });
  assert.match(a.c.ambientCommand({ type: 'ambient-on' }).reply, /no local model is set up/);
  const b = ctl({ store: { get: (k) => ({ 'settings.ambient': { enabled: false, localOnly: true }, 'settings.model': { ollamaModel: 'x' }, 'settings.wake.enabled': false })[k], set() {} } });
  assert.match(b.c.ambientCommand({ type: 'ambient-on' }).reply, /Hey Jarvis/);
  const c = ctl(); c.c.syncAmbient = function () { this.ambient.on = true; }; assert.match(c.c.ambientCommand({ type: 'ambient-on' }).reply, /Ambient answers are on/);
  assert.match(read('src/main/store.js'), /ambient: \{ enabled: false, localOnly: true/);
  assert.match(read('src/main/askController.js'), /this\.ambient\.on && this\.wake && this\.wake\.armed/);
  assert.match(read('src/main/main.js'), /settings\.ambient.*ask\.syncAmbient\(\)/);
});
