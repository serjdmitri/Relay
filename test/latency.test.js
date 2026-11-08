const test = require('node:test'), assert = require('node:assert/strict');
const { Latency, parseLatencyCommand: p, describe } = require('../src/main/latency');

const mkStore = () => { const d = {}; return { d, get: (k) => d[k], set: (k, v) => { d[k] = v; } }; };

test('a spoken request is timed in four steps, from letting go of the key to the first sound', () => {
  let t = 1000; const store = mkStore(); const l = new Latency({ store, now: () => t });
  l.mark('released', 1000); l.mark('text', 1400); l.mark('thinking', 1410); l.mark('firstWords', 3000); l.mark('firstSound', 3700);
  const [r] = store.get('latencyLog');
  assert.deepEqual([r.listen, r.think, r.speak, r.total, r.at], [0.4, 1.6, 0.7, 2.7, 3700]);
  l.mark('firstSound', 9000); assert.equal(store.get('latencyLog').length, 1, 'the same request is not counted twice');
});

test('typed requests, late text, long tasks and an answer with no streamed words are handled', () => {
  const store = mkStore(); const l = new Latency({ store });
  l.mark('text', 5000); l.mark('firstSound', 6000); assert.equal(store.get('latencyLog'), undefined, 'no key release: not a spoken request');
  l.mark('released', 10000); l.mark('text', 40000); l.mark('firstSound', 41000); assert.equal(store.get('latencyLog'), undefined, 'text more than 20 s after the key is not this request');
  l.mark('released', 100000); l.mark('text', 100300); l.mark('firstSound', 101500);
  const [r] = store.get('latencyLog'); assert.deepEqual([r.listen, r.think, r.speak, r.total], [0.3, 1.2, 0, 1.5], 'with no streamed words the first sound is the end of thinking');
  l.mark('released', 200000); l.mark('text', 200100); l.mark('firstSound', 400000); assert.equal(store.get('latencyLog').length, 1, 'a task over two minutes is not a reaction');
  const many = new Latency({ store }); for (let i = 0; i < 130; i++) { many.mark('released', i * 1e6); many.mark('text', i * 1e6 + 100); many.mark('firstSound', i * 1e6 + 900); }
  assert.equal(store.get('latencyLog').length, 100, 'only the last 100 are kept');
});

test('the report names the slowest step in plain words, and needs a few requests first', () => {
  assert.match(describe([]), /only 0 spoken requests/);
  assert.match(describe([{ listen: 0.4, think: 1, speak: 0.5, total: 1.9 }]), /only 1 spoken request so far/);
  const log = Array.from({ length: 5 }, () => ({ listen: 0.5, think: 2.4, speak: 0.7, total: 3.6 }));
  const said = describe(log);
  assert.match(said, /last 5 spoken requests/); assert.match(said, /3\.6 seconds/); assert.match(said, /slowest part is thinking up the first words/);
  assert.match(describe(Array.from({ length: 4 }, () => ({ listen: 1.5, think: 0.5, speak: 0.5, total: 2.5 }))), /slowest part is hearing you/);
});

test('"how fast are you" and "clear the speed numbers" are understood, and ordinary requests are left alone', () => {
  for (const t of ['how fast are you', 'Jarvis, how fast are you?', 'speed report', 'latency report', 'what is your reaction time', 'give me the timing numbers']) assert.deepEqual(p(t), { type: 'latency-report' }, t);
  assert.deepEqual(p('clear the speed numbers'), { type: 'latency-clear' });
  for (const t of ['what is the weather', 'speed up the music', 'how fast is a cheetah', 'open notes']) assert.equal(p(t), null, t);
});
