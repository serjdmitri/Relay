const test = require('node:test');
const assert = require('node:assert/strict');
const { Speaker } = require('../src/main/voice');
const { OmniVoice } = require('../src/main/tts/omnivoice');
test('OmniVoice is local and falls back when unavailable', () => {
  const s = new Speaker({ omni: { installed: () => true }, getLocalOnly: () => true });
  assert.equal(s.engineFor({ engine: 'omnivoice' }), 'omnivoice');
  s.omni = { installed: () => false };
  assert.equal(s.engineFor({ engine: 'omnivoice' }), 'system');
});
test('cancelling an OmniVoice request rejects it and stops its worker', async () => {
  const { EventEmitter } = require('node:events');
  const child = new EventEmitter(); child.stdin = new EventEmitter(); child.stdin.write = () => true; child.stdout = new (require('stream').PassThrough)(); child.kill = () => { child.killed = true; };
  const o = new OmniVoice({ python: process.execPath, spawnFn: () => child });
  const abort = new AbortController();
  const pending = o.synthesize('hello', { signal: abort.signal });
  abort.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(child.killed, true);
});
