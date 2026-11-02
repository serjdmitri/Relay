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

test('OmniVoice receives the chosen synthesis speed rather than changing playback pitch',async()=>{
 const {EventEmitter}=require('node:events'),{PassThrough}=require('node:stream');
 let sent;const child=new EventEmitter();child.stdin=new EventEmitter();child.stdout=new PassThrough();child.kill=()=>{};
 child.stdin.write=line=>{sent=JSON.parse(line);setImmediate(()=>child.stdout.write(JSON.stringify({id:sent.id,ok:true})+'\n'));};
 const voice=new OmniVoice({python:process.execPath,spawnFn:()=>child});
 await voice.synthesize('A quick reply',{rate:'faster'});assert.equal(sent.speed,1.15);
 await voice.synthesize('A calm report',{rate:'slower'});assert.equal(sent.speed,.9);
 voice.stop();
});
