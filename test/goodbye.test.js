const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const { parseGoodbye, goodbyeReply } = require('../src/main/dismiss');
const { AskController } = require('../src/main/askController');

test('goodbyes are recognised when said alone, never as part of a request', () => {
  for (const t of ['goodbye', 'Bye!', 'bye jarvis', 'okay bye', "that's all", 'see you later', 'good night', 'thanks, bye', 'Goodbye, Jarvis.', "I'm done", 'bye for now']) assert.equal(parseGoodbye(t), true, t);
  for (const t of ['what is bye in spanish', 'say goodbye to mom', 'goodbye email draft', 'play the song goodbye', 'ok', 'thanks', 'close', 'bye the way what time is it']) assert.equal(parseGoodbye(t), false, t);
});

test('it says goodbye back in the same register', () => {
  assert.equal(goodbyeReply('goodbye'), 'Goodbye, Sir.'); assert.equal(goodbyeReply('good night'), 'Good night, Sir.');
  assert.equal(goodbyeReply('see you later'), 'See you later, Sir.'); assert.equal(goodbyeReply("that's all"), 'Very good, Sir. Goodbye.');
});

function rig(over = {}) {
  const calls = [];
  const c = Object.create(AskController.prototype);
  Object.assign(c, { state: 'listening', voiceAsk: true, runningTask: null, followFor: { x: 1 }, store: { get: (k) => (k === 'settings.speakReplies' ? true : undefined) },
    ensureWindow() {}, cardPanel: { hide: () => calls.push('card-hide') }, push: (m) => calls.push('push:' + m.label),
    speaker: { speak: async (t) => calls.push('speak:' + t), stop() {} }, close() { calls.push('close'); this.state = 'idle'; }, ...over });
  return { c, calls };
}

test('goodbye by voice: speaks it back, drops the follow-up, and closes instead of waiting for another command', async () => {
  const { c, calls } = rig();
  const r = await c.handleText('goodbye', { voice: true });
  assert.deepEqual(calls.filter((x) => /^(speak|close)/.test(x)), ['speak:Goodbye, Sir.', 'close']);
  assert.equal(c.followFor, null); assert.equal(c.state, 'idle'); assert.equal(r.reply, 'Goodbye, Sir.'); assert.equal(r.dismissed, true);
});

test('typed goodbye closes silently; a goodbye from the phone, a schedule, or during a quiz is left alone', async () => {
  const typed = rig({ voiceAsk: false }); await typed.c.handleText('bye');
  assert.deepEqual(typed.calls.filter((x) => /^(speak|close)/.test(x)), ['close']);
  for (const over of [{ quiz: {} }, { checklist: {} }]) {
    const x = rig(over); x.c.currentRequest = null; x.c.handleText('goodbye').catch(() => {});
    assert.ok(!x.calls.some((k) => /^speak:Goodbye/.test(k)), JSON.stringify(Object.keys(over)));
  }
  const src = fs.readFileSync(path.join(__dirname, '../src/main/askController.js'), 'utf8');
  assert.match(src, /!opts\.remote && !this\.quiz && !this\.checklist && parseGoodbye\(text\)/);
});
