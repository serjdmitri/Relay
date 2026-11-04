const test = require('node:test');
const assert = require('node:assert/strict');

const load = () => import('../src/remote/wakeword.js');

function harness(opts = {}) {
  const timers = []; const recs = []; const log = [];
  const makeRecognizer = () => { const r = { started: 0, aborted: 0, start() { this.started++; }, abort() { this.aborted++; }, say(text) { this.onresult({ results: [[{ transcript: text }]] }); } }; recs.push(r); return r; };
  const setTimer = (fn, ms) => { const t = { fn, ms, cancelled: false }; timers.push(t); return t; };
  const clearTimer = (t) => { if (t) t.cancelled = true; };
  const advance = () => { const live = timers.splice(0).filter((t) => !t.cancelled); live.forEach((t) => t.fn()); return live.length; };
  return { recs, log, timers, advance, make: (WakeLoop) => new WakeLoop({ makeRecognizer, setTimer, clearTimer, onWake: () => log.push('wake'), onCommand: (t) => log.push('cmd:' + t), onGiveUp: () => log.push('giveup'), onState: (s, d) => log.push('state:' + s + (d ? '/' + d : '')), ...opts }) };
}

test('the wake phrase is found as the recogniser tends to hear it, and the command after it is cut out', async () => {
  const { extractWake } = await load();
  assert.deepEqual(extractWake('hey Jarvis what time is it'), { woke: true, command: 'what time is it' });
  assert.deepEqual(extractWake('Hey, Jarvis. Lock my Mac!'), { woke: true, command: 'Lock my Mac!' });
  assert.deepEqual(extractWake('hey jarvus'), { woke: true, command: '' });
  assert.deepEqual(extractWake('okay harvis open notes'), { woke: true, command: 'open notes' });
  assert.deepEqual(extractWake('Jarvis take me to Starbucks'), { woke: true, command: 'take me to Starbucks' });
  assert.deepEqual(extractWake('a jarvis volume down'), { woke: true, command: 'volume down' });
  assert.equal(extractWake('I was talking about travis and the service').woke, false);
  assert.equal(extractWake('tell Jarvis I said hi').woke, false); // a name in the middle of a sentence is not a call
  assert.equal(extractWake('').woke, false);
});

test('a whole command in one breath is sent after a short silence', async () => {
  const { WakeLoop } = await load(); const h = harness(); const loop = h.make(WakeLoop);
  loop.start();
  const r = h.recs[0]; assert.equal(r.started, 1);
  r.say('what is the weather'); assert.ok(!h.log.includes('wake'));
  r.say('hey Jarvis'); r.say('hey Jarvis what is the weather');
  assert.deepEqual(h.log.filter((x) => x.startsWith('wake') || x.startsWith('cmd')), ['wake']);
  h.advance();
  assert.deepEqual(h.log.filter((x) => x.startsWith('wake') || x.startsWith('cmd')), ['wake', 'cmd:what is the weather']);
  assert.equal(r.aborted, 1, 'the used session is closed so those words are not heard twice');
});

test('"Hey Jarvis" alone waits for the command; silence after it gives up', async () => {
  const { WakeLoop } = await load(); const h = harness(); const loop = h.make(WakeLoop);
  loop.start();
  h.recs[0].say('hey jarvis');
  assert.ok(h.timers.some((t) => !t.cancelled && t.ms === 6000), 'waits the long time for a command');
  h.recs[0].say('hey jarvis lock my mac');
  assert.ok(h.timers.some((t) => !t.cancelled && t.ms === 1400), 'a command shortens it to the quiet time');
  h.advance();
  assert.ok(h.log.includes('cmd:lock my mac'));
  const h2 = harness(); const l2 = h2.make(WakeLoop); l2.start(); h2.recs[0].say('hey jarvis'); h2.advance();
  assert.ok(h2.log.includes('giveup') && !h2.log.some((x) => x.startsWith('cmd')));
});

test('the recogniser ending by itself is restarted, and listening goes on after a command', async () => {
  const { WakeLoop } = await load(); const h = harness(); const loop = h.make(WakeLoop);
  loop.start();
  h.recs[0].onend();
  h.advance();
  assert.equal(h.recs.length, 2);
  h.recs[1].say('jarvis volume down'); h.advance(); h.advance();
  assert.equal(h.recs.length, 3, 'a fresh session opens after the command');
  assert.ok(loop.enabled);
});

test('it pauses while the phone speaks or you hold to talk, then listens again', async () => {
  const { WakeLoop } = await load(); const h = harness(); const loop = h.make(WakeLoop);
  loop.start(); loop.setPaused(true);
  assert.equal(h.recs[0].aborted, 1);
  h.advance(); assert.equal(h.recs.length, 1, 'nothing opens while paused');
  loop.setPaused(false); assert.equal(h.recs.length, 2);
});

test('a refused microphone turns it off and says why instead of retrying forever', async () => {
  const { WakeLoop } = await load(); const h = harness(); const loop = h.make(WakeLoop);
  loop.start(); h.recs[0].onerror({ error: 'not-allowed' });
  assert.equal(loop.enabled, false);
  assert.ok(h.log.includes('state:blocked/not-allowed'));
  h.advance(); assert.equal(h.recs.length, 1);
});

test('repeated recogniser failures stop it instead of looping, and stopping closes the microphone', async () => {
  const { WakeLoop } = await load(); const h = harness(); const loop = h.make(WakeLoop);
  loop.start();
  for (let i = 0; i < 9 && loop.enabled; i++) { const r = h.recs.at(-1); r.onerror({ error: 'network' }); r.onend(); h.advance(); }
  assert.equal(loop.enabled, false);
  assert.ok(h.log.some((x) => x.startsWith('state:error')));
  const h2 = harness(); const l2 = h2.make(WakeLoop); l2.start(); l2.stop();
  assert.equal(h2.recs[0].aborted, 1); assert.equal(l2.enabled, false);
});
