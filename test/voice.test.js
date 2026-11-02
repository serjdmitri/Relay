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

test('local model mode does not send voice text to a cloud speech provider', async () => {
  const calls = [], fetched = [];
  const sp = new Spk({ spawnFn: fakeSpawn(calls), exec: (c, a, o, cb) => cb(null, ''), getLocalOnly: () => true, getTts: () => ({ engine: 'openai', openai: { key: 'k' } }), fetchFn: okFetch(fetched) });
  await sp.speak('Private answer');
  assert.equal(fetched.length, 0);
  assert.equal(calls[0].cmd, 'say');
  assert.match((await sp.test('test')).message, /Cloud voices are paused/);
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

test('interrupted speech removes a prefetched sentence even if synthesis finishes later', async () => {
  let finishNext, finishPlay, count = 0;
  const discarded = [];
  const sp = new Spk({ kokoro: { installed: () => true, synthesize: () => ++count === 1 ? Promise.resolve('first') : new Promise((resolve) => { finishNext = resolve; }) }, getTts: () => ({ engine: 'kokoro' }) });
  sp.play = () => new Promise((resolve) => { finishPlay = resolve; });
  sp.discard = (file) => discarded.push(file);
  const pending = sp.speak('a'.repeat(200) + '. ' + 'b'.repeat(200) + '.');
  await new Promise((resolve) => setImmediate(resolve));
  sp.stop();
  finishPlay();
  await pending;
  finishNext('second');
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(discarded, ['first', 'second']);
});

test('Speaking starts with playback, not synthesis, and stops when audio exits', async () => {
  let release, child; const states=[];
  const sp=new Spk({getTts:()=>({engine:'kokoro'}),kokoro:{installed:()=>true,synthesize:()=>new Promise(resolve=>{release=resolve})},spawnFn:()=>{child=new EventEmitter();child.kill=()=>child.emit('exit',0);return child}});
  sp.discard=()=>{};sp.onState=on=>states.push(on);
  const done=sp.speak('Hello Sir');
  assert.equal(sp.speaking,true);assert.deepEqual(states,[]);
  release('test.wav');await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(states,[]);
  child.emit('spawn');assert.deepEqual(states,[true]);
  child.emit('exit',0);await done;
  assert.deepEqual(states,[true,false]);assert.equal(sp.speaking,false);
});

test('failed audio playback falls back to the Mac voice instead of silently succeeding', async () => {
  const commands=[],problems=[];
  const spawnFn=(cmd)=>{commands.push(cmd);const child=new EventEmitter();child.stdin={on(){},end(){}};child.kill=()=>{};setImmediate(()=>{child.emit('spawn');child.emit('exit',cmd==='afplay'?1:0)});return child};
  const sp=new Spk({spawnFn,exec:(_c,_a,_o,cb)=>cb(null,''),log:{error(){}},onProblem:m=>problems.push(m),getTts:()=>({engine:'kokoro'}),kokoro:{installed:()=>true,synthesize:async()=>'test.wav'}});
  sp.discard=()=>{};await sp.speak('Your notes are open, Sir.');
  assert.deepEqual(commands,['afplay','say']);assert.match(problems[0],/playback failed/);assert.equal(sp.talking,false);
});

test('the system voice test reports device/process failures and clears Speaking', async()=>{
 const sp=new Spk({exec:(_c,_a,_o,cb)=>cb(null,''),spawnFn:()=>{const c=new EventEmitter();c.stdin={on(){},end(){}};setImmediate(()=>c.emit('error',new Error('Output unavailable')));return c}});
 assert.deepEqual(await sp.test('Hello'),{ok:false,message:'Output unavailable'});
 assert.equal(sp.talking,false);assert.equal(sp.speaking,false);
});

test('prepared local acknowledgements reuse audio without restarting synthesis', async()=>{
 const fs=require('fs'),path=require('path'),os=require('os');
 let made=0;const calls=[];
 const sp=new Spk({spawnFn:fakeSpawn(calls),exec:(_c,_a,_o,cb)=>cb(null,''),getTts:()=>({engine:'omnivoice'}),omni:{installed:()=>true,synthesize:async()=>{made++;const file=path.join(os.tmpdir(),`relay-ack-test-${process.pid}.wav`);fs.writeFileSync(file,'audio');return file;}}});
 await sp.prepare({rate:'faster'});
 await sp.speak('On it, Sir.',{rate:'faster',quick:true});
 await sp.speak('On it, Sir.',{rate:'faster',quick:true});
 assert.equal(made,1);assert.deepEqual(calls.map(c=>c.cmd),['afplay','afplay']);
});

test('cold acknowledgements start with a Mac voice without launching slow synthesis', async()=>{
 const calls=[];let made=0;
 const sp=new Spk({spawnFn:fakeSpawn(calls),exec:(_c,_a,_o,cb)=>cb(null,''),getTts:()=>({engine:'omnivoice'}),omni:{installed:()=>true,synthesize:()=>{made++;throw Error('Should not run');}}});
 await sp.speak('On it, Sir.',{quick:true});
 assert.equal(made,0);assert.equal(calls[0].cmd,'say');
});

test('voice warmup never sends text to a cloud service',async()=>{
 let fetched=0;
 const sp=new Spk({exec:(_c,_a,_o,cb)=>cb(null,''),getTts:()=>({engine:'openai',openai:{key:'test'}}),fetchFn:()=>{fetched++;throw Error('No background cloud request')}});
 await sp.prepare();assert.equal(fetched,0);
});

test('voice preparation has its own state and clears before playback',async()=>{
 let release,child;const states=[];
 const sp=new Spk({getTts:()=>({engine:'kokoro'}),kokoro:{installed:()=>true,synthesize:()=>new Promise(r=>{release=r})},spawnFn:()=>{child=new EventEmitter();return child}});
 sp.discard=()=>{};sp.onPreparing=on=>states.push(['preparing',on]);sp.onState=on=>states.push(['playing',on]);
 const done=sp.speak('Ready');assert.deepEqual(states,[['preparing',true]]);
 release('test.wav');await new Promise(r=>setImmediate(r));child.emit('spawn');child.emit('exit',0);await done;
 assert.deepEqual(states,[['preparing',true],['preparing',false],['playing',true],['playing',false]]);
});
test('stalled playback clears its speaking state and reports an actionable error', async () => {
  let expire;const child=new EventEmitter();child.kill=()=>{};
  const speaker=new Spk({spawnFn:()=>child,setTimer:fn=>{expire=fn;return 1;},clearTimer(){}});
  const states=[];speaker.onState=on=>states.push(on);
  const playing=speaker.play('fixture.wav',speaker.token);child.emit('spawn');assert.equal(speaker.talking,true);
  expire();await assert.rejects(playing,/stalled/);assert.equal(speaker.speaking,false);assert.deepEqual(states,[true,false]);
});
test('stop settles playback even if an audio subprocess never emits exit', async () => {
  const child=new EventEmitter();let killed=false,cleared=false;child.kill=()=>{killed=true;};
  const speaker=new Spk({spawnFn:()=>child,setTimer:()=>1,clearTimer:()=>{cleared=true;}});
  const playing=speaker.play('fixture.wav',speaker.token);speaker.stop();await playing;
  assert.equal(killed,true);assert.equal(cleared,true);assert.equal(speaker.speaking,false);
});
