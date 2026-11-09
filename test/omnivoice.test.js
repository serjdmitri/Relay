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
test('cancelling an OmniVoice reply drops only that reply and keeps the loaded model, and its late file is deleted', async () => {
  const { EventEmitter } = require('node:events'), fs = require('node:fs'), { PassThrough } = require('node:stream');
  const child = new EventEmitter(); child.stdin = new EventEmitter(); child.stdout = new PassThrough(); child.kill = () => { child.killed = true; };
  let sent; child.stdin.write = (line) => { sent = JSON.parse(line); return true; };
  const o = new OmniVoice({ python: process.execPath, spawnFn: () => child });
  const abort = new AbortController();
  const pending = o.synthesize('hello', { signal: abort.signal });
  abort.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(child.killed, undefined, 'the model stays loaded: restarting it costs about 4.5 seconds');
  fs.writeFileSync(sent.path, 'x');
  child.stdout.write(JSON.stringify({ id: sent.id, ok: true }) + '\n'); await new Promise((r) => setImmediate(r));
  assert.equal(fs.existsSync(sent.path), false, 'the answer nobody waits for is cleaned up');
  o.stop();
});

test('the voice is warmed before it is needed, and a reply carries its step count', async () => {
  const { EventEmitter } = require('node:events'), { PassThrough } = require('node:stream');
  const sent = []; const child = new EventEmitter(); child.stdin = new EventEmitter(); child.stdout = new PassThrough(); child.kill = () => {};
  child.stdin.write = (line) => { const r = JSON.parse(line); sent.push(r); setImmediate(() => child.stdout.write(JSON.stringify({ id: r.id, ok: true }) + '\n')); return true; };
  const o = new OmniVoice({ python: process.execPath, spawnFn: () => child });
  assert.equal(await o.warm(), true); assert.equal(sent[0].text, 'Ready.'); assert.equal(sent[0].steps, 8);
  assert.equal(await o.warm(), false, 'already running');
  await o.synthesize('A reply'); assert.equal(sent[1].steps, 10, 'ten steps by default');
  await o.synthesize('A careful reply', { steps: 16 }); assert.equal(sent[2].steps, 16);
  await o.synthesize('x', { steps: 999 }); assert.equal(sent[3].steps, 32, 'bounded');
  o.stop();
});

test('a long first sentence is cut short so the first sound comes sooner, and short ones are left alone', () => {
  const { firstShort } = require('../src/main/voice');
  const long = 'You have three unread emails from your school, one reminder from the dentist, and a meeting that starts at two this afternoon.';
  const out = firstShort([long, 'Anything else?']);
  assert.ok(out[0].length <= 90 && out.length === 3 && out.join(' ').replace(/\s+/g, ' ') === long + ' Anything else?');
  assert.deepEqual(firstShort(['On it, Sir.', 'Done.']), ['On it, Sir.', 'Done.']);
  assert.deepEqual(firstShort([]), []);
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


test('cancelled queued speech never reaches the worker and foreground replies beat prewarming',async()=>{
 const {EventEmitter}=require('events'),{PassThrough}=require('stream');const child=new EventEmitter();child.stdin=new EventEmitter();child.stdout=new PassThrough();child.kill=()=>{};const sent=[];child.stdin.write=line=>{sent.push(JSON.parse(line));};
 const voice=new OmniVoice({python:process.execPath,spawnFn:()=>child});const active=voice.synthesize('first');const ac=new AbortController();const obsolete=voice.synthesize('obsolete',{signal:ac.signal});ac.abort();await assert.rejects(obsolete,{name:'AbortError'});
 const warm=voice.synthesize('warm',{background:true}),reply=voice.synthesize('reply');assert.equal(sent.length,1);
 child.stdout.write(JSON.stringify({id:sent[0].id,ok:true})+'\n');await active;assert.equal(sent[1].text,'reply');
 child.stdout.write(JSON.stringify({id:sent[1].id,ok:true})+'\n');await reply;assert.equal(sent[2].text,'warm');
 child.stdout.write(JSON.stringify({id:sent[2].id,ok:true})+'\n');await warm;assert.equal(sent.some(m=>m.text==='obsolete'),false);voice.stop();
});
