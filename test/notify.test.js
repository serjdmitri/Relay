const test = require('node:test');
const assert = require('node:assert/strict');
const { PhoneNotifier, shouldNotify, messageFor, newTopic } = require('../src/main/notify');
const { parseQuick, runQuick } = require('../src/main/quick');

const cfg = (o = {}) => ({ enabled: true, channel: 'ntfy', ntfyTopic: 'relay-abc', ntfyServer: 'https://ntfy.sh', imessageTo: '', minSeconds: 30, includeText: false, ...o });

test('who gets told: long jobs and agents, never short ones, stopped ones, or the phone that asked', () => {
  assert.equal(shouldNotify(cfg(), { seconds: 45, status: 'done' }), true);
  assert.equal(shouldNotify(cfg(), { seconds: 10, status: 'done' }), false);
  assert.equal(shouldNotify(cfg(), { seconds: 45, status: 'stopped' }), false);
  assert.equal(shouldNotify(cfg(), { seconds: 45, status: 'done', remote: 'x' }), false);
  assert.equal(shouldNotify(cfg(), { agent: true, status: 'done' }), true);
  assert.equal(shouldNotify(cfg({ enabled: false }), { seconds: 99, status: 'done' }), false);
  assert.equal(shouldNotify(cfg({ minSeconds: 120 }), { seconds: 100, status: 'done' }), false);
  assert.equal(shouldNotify(cfg({ minSeconds: 1 }), { seconds: 6, status: 'done' }), true);
  assert.equal(shouldNotify(cfg({ minSeconds: 1 }), { seconds: 3, status: 'done' }), false, 'never for something that took a few seconds');
});

test('the message carries the first words of the request, and the answer only if asked', () => {
  const job = { text: 'Research the best standing desks and write up a comparison with prices', reply: 'Here are the three best standing desks: …', status: 'done' };
  assert.deepEqual(messageFor(cfg(), job), { title: 'Relay finished', body: 'Done: Research the best standing desks and write up a comparison with prices' });
  assert.match(messageFor(cfg({ includeText: true }), job).body, /Here are the three best/);
  assert.match(messageFor(cfg(), { ...job, text: `${job.text} and also a lot more words than that` }).body, /…$/, 'a long request is cut');
  assert.equal(messageFor(cfg(), { ...job, status: 'failed' }).title, 'Relay hit a problem');
  assert.equal(messageFor(cfg(), { agent: true, text: 'Watch the build', status: 'done' }).title, 'Relay agent finished');
  assert.equal(messageFor(cfg(), { status: 'done' }).body, 'Your request is done.');
});

test('ntfy: posted to the topic, with a plain title; a bad server or a refusal is reported, not thrown from jobDone', async () => {
  const calls = [];
  const n = new PhoneNotifier({ getConfig: () => cfg(), fetchFn: async (url, init) => { calls.push([url, init]); return { ok: true }; }, log: { error() {} } });
  assert.equal(await n.jobDone({ text: 'Build it', seconds: 60, status: 'done' }), true);
  assert.equal(calls[0][0], 'https://ntfy.sh/relay-abc');
  assert.equal(calls[0][1].body, 'Done: Build it');
  assert.equal(calls[0][1].headers.Title, 'Relay finished');
  assert.deepEqual(await n.test(), { ok: true, via: 'ntfy' });
  const bad = new PhoneNotifier({ getConfig: () => cfg({ ntfyServer: 'http://example.com' }), fetchFn: async () => ({ ok: true }), log: { error() {} } });
  assert.match((await bad.test()).error, /must start with https/);
  const refused = new PhoneNotifier({ getConfig: () => cfg(), fetchFn: async () => ({ ok: false, status: 429 }), log: { error() {} } });
  assert.equal(await refused.jobDone({ text: 'x', seconds: 60, status: 'done' }), false, 'a failed message never breaks the request');
  assert.match((await refused.test()).error, /answered 429/);
  assert.match((await new PhoneNotifier({ getConfig: () => cfg({ ntfyTopic: '' }) }).test()).error, /Make a topic/);
});

test('iMessage: sent from this Mac to the number given', async () => {
  const sent = [];
  const n = new PhoneNotifier({ getConfig: () => cfg({ channel: 'imessage', imessageTo: '+15551234567' }), sendMessage: async (to, text) => { sent.push([to, text]); }, log: { error() {} } });
  assert.equal(await n.jobDone({ text: 'Tidy it', seconds: 90, status: 'done' }), true);
  assert.deepEqual(sent, [['+15551234567', 'Relay finished: Done: Tidy it']]);
  assert.match((await new PhoneNotifier({ getConfig: () => cfg({ channel: 'imessage' }) }).test()).error, /phone number or Apple ID/);
});

test('topics are long and different every time', () => {
  const a = newTopic(), b = newTopic();
  assert.match(a, /^relay-[0-9a-f]{24}$/);
  assert.notEqual(a, b);
});

test('"what\'s playing" names the track, or says nothing is', async () => {
  assert.equal(parseQuick("what's playing").type, 'now-playing');
  const mk = (running, state, track) => ({ listApps: async () => running, osa: async (s) => (/player state/.test(s) ? state : track) });
  assert.equal((await runQuick({ type: 'now-playing' }, mk(['Spotify'], 'playing', 'Intro by The xx'))).reply, 'Playing Intro by The xx (Spotify).');
  assert.equal((await runQuick({ type: 'now-playing' }, mk(['Music'], 'paused', 'Kids by MGMT'))).reply, 'Paused on Kids by MGMT (Music).');
  assert.equal((await runQuick({ type: 'now-playing' }, mk(['Safari'], '', ''))).reply, 'Nothing is playing.');
});
