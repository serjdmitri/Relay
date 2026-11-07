const test = require('node:test'), assert = require('node:assert/strict');
const { EarlyVoice } = require('../src/main/earlyVoice');
const { Speaker } = require('../src/main/voice');

test('the first complete sentence of a plain answer is spoken while the rest is still being written, and only once', () => {
  const said = []; const e = new EarlyVoice({ enabled: true, speak: (s) => said.push(s) });
  e.delta('You have three unread emails');
  assert.deepEqual(said, [], 'no complete sentence yet');
  e.delta('You have three unread emails and one meeting today. The meeting is at');
  assert.deepEqual(said, ['You have three unread emails and one meeting today.']);
  e.delta('You have three unread emails and one meeting today. The meeting is at two. Anything else?');
  assert.equal(said.length, 1, 'only the first sentence goes early');
  assert.deepEqual(e.finalize('You have three unread emails and one meeting today. The meeting is at two. Anything else?'), { text: 'The meeting is at two. Anything else?', append: true });
});

test('narration, tool use, a disabled voice, or a changed answer are never spoken early or twice', () => {
  const said = []; const mk = (o = {}) => new EarlyVoice({ enabled: true, speak: (s) => said.push(s), ...o });
  let e = mk(); e.delta('Let me check your calendar for you. One moment please.'); assert.deepEqual(said, [], 'narration is not the answer');
  assert.deepEqual(e.finalize('You have nothing today.'), { text: 'You have nothing today.', append: false });
  e = mk(); e.toolStarted(); e.delta('The weather in Hollywood is warm and sunny today. Enjoy.'); assert.deepEqual(said, [], 'a request that uses tools is spoken normally');
  e = mk({ enabled: false }); e.delta('The weather in Hollywood is warm and sunny today. Enjoy.'); assert.deepEqual(said, []);
  e = mk(); e.delta('The weather in Hollywood is warm and sunny today. Enjoy.'); assert.equal(said.length, 1);
  assert.deepEqual(e.finalize('It is warm in Hollywood today with sun all afternoon.'), { text: 'It is warm in Hollywood today with sun all afternoon.', append: false }, 'a different final answer replaces it');
  assert.deepEqual(new EarlyVoice({ enabled: true }).finalize('  Plain.  '), { text: 'Plain.', append: false });
  e = mk(); said.length = 0; e.delta('Short one. And more words here to be long enough later on.'); assert.deepEqual(said, [], 'too short to be a first sentence (under 20 characters)');
});

test('speaking after the first sentence waits for it, and is dropped if you spoke over it in between', async () => {
  const order = []; const s = Object.create(Speaker.prototype); s.stops = 0; s.current = null;
  s.stop = function () { this.stops++; };
  s._speakNow = async (text, _o, doStop) => { if (doStop) s.stop(); order.push('start ' + text); await new Promise((r) => setTimeout(r, 20)); order.push('end ' + text); };
  const first = s.speak('first');
  const rest = s.speak('rest', { append: true });
  await Promise.all([first, rest]);
  assert.deepEqual(order, ['start first', 'end first', 'start rest', 'end rest'], 'the rest starts after the first ends, without cutting it');
  order.length = 0; s.stops = 0;
  const a = s.speak('a'); const b = s.speak('b', { append: true });
  s.stop(); // you speak over it
  await Promise.all([a, b]);
  assert.ok(!order.includes('start b'), 'the appended words are dropped');
});
