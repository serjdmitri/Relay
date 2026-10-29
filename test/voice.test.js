const test = require('node:test');
const assert = require('node:assert/strict');

// ---- engines: the voice chosen in Speech settings
const { Speaker: Spk, speakable } = require('../src/main/voice');
const { EventEmitter } = require('node:events');
function fakeSpawn(calls) {
  return (cmd, args) => {
    const c = new EventEmitter();
    c.kill = () => c.emit('exit');
    c.stdin = { on() {}, end(t) { c.said = t; } };
    calls.push({ cmd, args, c });
    setImmediate(() => c.emit('exit'));
    return c;
  };
}
const okFetch = (log) => async (url, init) => { log.push([url, JSON.parse(init.body).input]); return { ok: true, arrayBuffer: async () => new Uint8Array([9]).buffer }; };

test('spoken answers read link labels without reading markup or addresses', () => {
  assert.equal(speakable('See [the guide](https://example.com/guide) for details.'), 'See the guide for details.');
  assert.equal(speakable('Visit https://example.com'), 'Visit a link');
});

test('an online voice speaks sentence by sentence through afplay, and temp files are removed', async () => {
  const calls = [], fetched = [];
  const sp = new Spk({ spawnFn: fakeSpawn(calls), exec: (c, a, o, cb) => cb(null, ''), getTts: () => ({ engine: 'openai', openai: { key: 'k' } }), fetchFn: okFetch(fetched) });
  await sp.speak('First thing. Second thing.');
  assert.deepEqual(fetched.map((f) => f[1]), ['First thing. Second thing.'], 'short replies are one piece');
  await sp.speak('a'.repeat(200) + '. ' + 'b'.repeat(200) + '.');
  assert.equal(fetched.length, 3, 'a longer reply is made in two pieces');
  assert.ok(calls.filter((c) => c.cmd === 'afplay').length === 3);
  assert.ok(calls.every((c) => c.cmd !== 'say'));
  assert.ok(!sp.speaking);
});

test('without a key, or when the online voice fails, the system voice answers', async () => {
  const calls = [], problems = [];
  const noKey = new Spk({ spawnFn: fakeSpawn(calls), exec: (c, a, o, cb) => cb(null, ''), getTts: () => ({ engine: 'elevenlabs', elevenlabs: { key: '' } }) });
  await noKey.speak('Hello there');
  assert.equal(calls[0].cmd, 'say');
  const failing = new Spk({ spawnFn: fakeSpawn(calls), exec: (c, a, o, cb) => cb(null, ''), onProblem: (m) => problems.push(m), getTts: () => ({ engine: 'openai', openai: { key: 'k' } }), fetchFn: async () => ({ ok: false, status: 401, text: async () => '{"error":{"message":"bad key"}}' }) });
  await failing.speak('Hello again');
  assert.match(problems[0], /OpenAI rejected the key/);
  assert.equal(calls.at(-1).cmd, 'say', 'it still answers out loud');
});

test('stop() drops a reply that is still being made', async () => {
  const calls = [];
  let release;
  const slow = () => new Promise((res) => { release = () => res({ ok: true, arrayBuffer: async () => new Uint8Array([1]).buffer }); });
  const sp = new Spk({ spawnFn: fakeSpawn(calls), exec: (c, a, o, cb) => cb(null, ''), getTts: () => ({ engine: 'openai', openai: { key: 'k' } }), fetchFn: slow });
  const p = sp.speak('Hello there.');
  await new Promise((r) => setImmediate(r));
  assert.ok(sp.speaking);
  sp.stop();
  release();
  await p;
  assert.ok(calls.every((c) => c.cmd !== 'afplay'), 'nothing is played after stop');
  assert.ok(!sp.speaking);
});

test('stopping while the system voice is being selected prevents stale speech', async () => {
  const calls = [];
  let finish;
  const sp = new Spk({ spawnFn: fakeSpawn(calls), exec: (_c, _a, _o, cb) => { finish = cb; } });
  const pending = sp.speak('A reply');
  sp.stop();
  finish(null, '');
  await pending;
  assert.equal(calls.length, 0);
  assert.equal(sp.speaking, false);
});
