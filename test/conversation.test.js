const test = require('node:test');
const assert = require('node:assert/strict');
const { heardStop, interruption, shouldFollowUp, wakeAllowedIn } = require('../src/main/conversation');
const { jobFor, profileFor, pickJarvis, LONG_REPLY } = require('../src/main/voiceProfile');
const { pickVoice } = require('../src/main/voice');

test('stop words are heard near the start of what was said', () => {
  assert.equal(heardStop('stop'), true);
  assert.equal(heardStop('okay stop it'), true);
  assert.equal(heardStop('jarvis quiet please'), true);
  assert.equal(heardStop('the bus stop is down the road for a long way'), false, 'a stop word late in a long sentence is not a command');
});

test('talking over Relay is told apart from Relay\'s own voice', () => {
  const said = 'The Eiffel Tower is about three hundred thirty metres tall and was finished in eighteen eighty nine';
  assert.equal(interruption('the eiffel tower is about three hundred', said), null, 'its own words coming back through the microphone');
  assert.equal(interruption('the eiffel tower is about three hundrid thirty', said), null, 'a misheard word of its own');
  assert.equal(interruption('the eiffel tower and actually show me the louvre', said), 'talk');
  assert.equal(interruption('stop', said), 'stop');
  assert.equal(interruption('wait', said), 'stop');
  assert.equal(interruption('and actually show me the louvre now', said, { mode: 'word' }), null, 'word mode only listens for stop words');
  assert.equal(interruption('stop', said, { mode: 'word' }), 'stop');
  assert.equal(interruption('the next stop is four hundred metres on', 'The next stop is four hundred metres on the left.'), null, 'Relay saying the word stop is not the person');
});

test('follow-up listening: only after a spoken ask, once it has finished, and not forever', () => {
  const ok = { enabled: true, byVoice: true, state: 'done', speaking: false, suspended: false, chain: 0 };
  assert.equal(shouldFollowUp(ok), true);
  for (const bad of [{ enabled: false }, { byVoice: false }, { state: 'working' }, { speaking: true }, { suspended: true }, { chain: 5 }]) assert.equal(shouldFollowUp({ ...ok, ...bad }), false, JSON.stringify(bad));
});

test('the wake phrase can be limited to some apps, and is everywhere when none are named', () => {
  assert.equal(wakeAllowedIn([], 'Safari'), true);
  assert.equal(wakeAllowedIn('', 'Safari'), true);
  assert.equal(wakeAllowedIn(['Xcode', 'Terminal'], 'Terminal'), true);
  assert.equal(wakeAllowedIn('xcode, terminal', 'Google Chrome'), false);
  assert.equal(wakeAllowedIn(['chrome'], 'Google Chrome'), false, 'names must match from the start, not anywhere inside');
  assert.equal(wakeAllowedIn(['Google Chrome'], 'google chrome'), true);
  assert.equal(wakeAllowedIn(['Xcode'], null), false);
});

test('voices by job: soft confirmations, slower long answers, and the Jarvis voice', () => {
  assert.equal(jobFor('Timer set for 5 minutes.'), 'reply');
  assert.equal(jobFor('x'.repeat(LONG_REPLY + 1)), 'reading');
  assert.equal(jobFor('short', 'quiet'), 'quiet');
  const settings = { voice: 'auto', voiceRate: 'normal', voices: { quiet: { volume: 0.55 }, reading: {} } };
  assert.deepEqual(profileFor('quiet', settings), { job: 'quiet', voice: 'auto', rate: 'normal', volume: 0.55, kokoroVoice: undefined });
  assert.equal(profileFor('reading', settings).rate, 'slower');
  assert.equal(profileFor('reply', settings).volume, 1);
  assert.equal(profileFor('reply', { ...settings, voices: { quiet: { volume: 0 } } }).volume, 1);
  assert.equal(profileFor('quiet', { ...settings, voices: { quiet: { volume: 0 } } }).volume, 0.1, 'never silent');
  const j = profileFor('reply', { ...settings, voice: 'jarvis' });
  assert.equal(j.kokoroVoice, 'bm_george');
  assert.equal(profileFor('reply', { ...settings, voice: 'jarvis', voices: { reply: { kokoroVoice: 'bm_lewis' } } }).kokoroVoice, 'bm_lewis');
});

test('the Jarvis voice picks the best Daniel, else another British voice, else nothing', () => {
  const v = (name, lang = 'en_GB', kind = 'Standard') => ({ name, lang, kind });
  assert.equal(pickJarvis([v('Daniel'), v('Daniel (Premium)', 'en_GB', 'Premium'), v('Samantha', 'en_US')]), 'Daniel (Premium)');
  assert.equal(pickJarvis([v('Daniel'), v('Daniel (Enhanced)', 'en_GB', 'Enhanced')]), 'Daniel (Enhanced)');
  assert.equal(pickJarvis([v('Kate'), v('Oliver')]), 'Oliver');
  assert.equal(pickJarvis([v('Samantha', 'en_US')]), null);
  assert.equal(pickVoice([v('Daniel'), v('Samantha', 'en_US')], 'jarvis', 'en_US'), 'Daniel');
  assert.equal(pickVoice([v('Samantha', 'en_US')], 'jarvis', 'en_US'), 'Samantha', 'no British voice: the normal choice');
});

const { EventEmitter } = require('node:events');
const { BargeIn } = require('../src/main/barge');
const { WakeWord } = require('../src/main/wake');
const { Speaker } = require('../src/main/voice');

function bargeRig(cfg = { enabled: true, mode: 'talk' }, spoken = 'The weather today is sunny with a light breeze from the west') {
  const speech = new EventEmitter();
  const log = [];
  speech.listen = async () => { log.push('listen'); };
  speech.cancel = () => log.push('cancel');
  const hits = [];
  const b = new BargeIn({ speech, getConfig: () => cfg, getSpoken: () => spoken, onInterrupt: (k, t) => hits.push([k, t]), settleMs: 0, log: { error() {} } });
  return { b, speech, log, hits };
}

test('interrupt by talking: it listens while speaking, ignores its own words, and stops for a person', async () => {
  const r = bargeRig();
  await r.b.arm();
  assert.deepEqual(r.log, ['listen']);
  r.speech.emit('partial', 'the weather today is sunny');
  assert.deepEqual(r.hits, []);
  r.speech.emit('partial', 'the weather today and could you also check my calendar');
  assert.equal(r.hits.length, 1);
  assert.equal(r.hits[0][0], 'talk');
  assert.deepEqual(r.log, ['listen', 'cancel'], 'the microphone is closed once it has fired');
  r.speech.emit('partial', 'more words that are not its own at all');
  assert.equal(r.hits.length, 1, 'only once');
});

test('interrupt by talking: "stop" works at once, and nothing happens when it is turned off', async () => {
  const r = bargeRig();
  await r.b.arm();
  r.speech.emit('partial', 'stop');
  assert.equal(r.hits[0][0], 'stop');
  const off = bargeRig({ enabled: false });
  await off.b.arm();
  assert.deepEqual(off.log, [], 'the microphone is not opened');
  const word = bargeRig({ enabled: true, mode: 'word' });
  await word.b.arm();
  word.speech.emit('partial', 'could you also check my calendar please now');
  assert.deepEqual(word.hits, []);
  word.speech.emit('partial', 'okay stop');
  assert.equal(word.hits[0][0], 'stop');
});

test('the wake phrase listens everywhere by default and only in the chosen apps when limited', async () => {
  const speech = new EventEmitter();
  speech.listen = async () => {}; speech.cancel = () => {};
  let front = 'Safari';
  const cfg = { enabled: true, phrase: 'hey jarvis', apps: [] };
  const w = new WakeWord({ speech, getConfig: () => cfg, canListen: () => true, getFront: () => front, onWake() {}, setTimer: () => 1, clearTimer() {} });
  assert.equal(w.wanted, true, 'no apps named: everywhere');
  cfg.apps = ['Xcode'];
  assert.equal(w.wanted, false, 'Safari is in front');
  front = 'Xcode';
  assert.equal(w.wanted, true);
});

test('the speaker uses the loudness and voice it is given: system voice gets a volume command, afplay gets -v, and Kokoro gets the chosen voice', async () => {
  const calls = [];
  const spawnFn = (cmd, args) => { const c = new EventEmitter(); c.stdin = Object.assign(new EventEmitter(), { end: (t) => calls.push({ cmd, args, said: t }) }); setImmediate(() => c.emit('exit')); calls.push({ cmd, args }); return c; };
  const exec = (cmd, args, o, cb) => cb(null, 'Daniel   en_GB    # Hello!\nSamantha   en_US    # Hi\n');
  const s = new Speaker({ spawnFn, exec, log: { error() {} } });
  await s.speak('Timer set.', { voice: 'jarvis', volume: 0.5 });
  const say = calls.find((c) => c.cmd === 'say');
  assert.deepEqual(say.args.slice(0, 2), ['-v', 'Daniel']);
  assert.equal(calls.find((c) => c.said).said, '[[volm 0.5]] Timer set.');
  assert.equal(s.currentText, 'Timer set.');
  const made = [];
  const kokoro = { installed: () => true, synthesize: async (piece, o) => { made.push(o); return '/tmp/x.wav'; } };
  const k = new Speaker({ spawnFn, exec, log: { error() {} }, getTts: () => ({ engine: 'kokoro', kokoro: { voice: 'af_heart' } }), kokoro });
  calls.length = 0;
  await k.speak('Hello there.', { kokoroVoice: 'bm_george', volume: 0.5, rate: 'slower' });
  assert.equal(made[0].voice, 'bm_george');
  assert.equal(made[0].rate, 'slower');
  assert.deepEqual(calls.find((c) => c.cmd === 'afplay').args.slice(0, 2), ['-v', '0.5']);
});
