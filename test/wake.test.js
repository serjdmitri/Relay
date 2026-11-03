const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { WakeWord, ClapGate, heardWake } = require('../src/main/wake');

test('heardWake matches the phrase, its greeting variants and one-letter mishearings, near the end of what was heard', () => {
  for (const t of ['Hey Jarvis', 'hey, jarvis!', 'okay jarvis', 'Hi Jarvis open notes', 'um so hey jarvus', 'hey jervis what time is it', 'a jarvis']) assert.ok(heardWake(t, 'hey jarvis'), t);
  for (const t of ['', 'jarvis', 'hey travis', 'hello there', 'service', 'hey jar', 'my jarvis is broken']) assert.ok(!heardWake(t, 'hey jarvis'), t);
  assert.ok(heardWake('hey computer', 'hey computer'));
  assert.ok(!heardWake('hey compost', 'hey computer'), 'a different word is not a match');
  assert.ok(heardWake('jarvis', 'jarvis'), 'a phrase with no greeting is just the name');
  assert.ok(!heardWake('anything', ''), 'no phrase set');
  assert.ok(heardWake('I said hey Jarvis now', 'hey jarvis'));
});

test('the default Jarvis phrase also accepts an explicit wake-up request', () => {
  for (const text of ['Jarvis wake up', 'Jarvis, wake up!', 'jarvus wake up please']) assert.equal(heardWake(text, 'hey jarvis'), true, text);
  for (const text of ['jarvis wake', 'wake up jarvis', 'jarvis wake down']) assert.equal(heardWake(text, 'hey jarvis'), false, text);
  assert.equal(heardWake('jarvis wake up', 'hey computer'), false, 'a custom wake phrase is not broadened');
});

test('a wake-up request activates the listener through the normal wake path', async () => {
  const r = rig();
  await r.w.refresh();
  r.speech.emit('partial', 'Jarvis wake up');
  assert.deepEqual(r.woke, ['Jarvis wake up']);
  assert.equal(r.w.armed, false);
});

test('two distinct impulses open a short wake window, not one sustained sound', () => {
  const gate = new ClapGate();
  assert.equal(gate.level(0.8, 1000), false);
  assert.equal(gate.level(0.8, 1200), false, 'continuous sound is one impulse');
  gate.level(0.1, 1250);
  assert.equal(gate.level(0.8, 1400), false,'a long sound is not a clap');gate.reset();gate.level(.8,1400);gate.level(.03,1450);assert.equal(gate.level(.8,1650),false);assert.equal(gate.level(.03,1700),true);
  assert.equal(gate.ready(6000), true);
  assert.equal(gate.ready(6701), false);
  gate.reset();
  gate.level(0.8, 7000); gate.level(0.1, 7050);
  assert.equal(gate.level(0.8, 7100), false, 'too close together');
});

test('clap mode requires the wake phrase after both claps', async () => {
  const realNow = Date.now;
  let now = 10000;
  Date.now = () => now;
  try {
    const r = rig(); r.cfg.requireClaps = true;
    await r.w.refresh();
    r.speech.emit('partial', 'hey jarvis');
    assert.equal(r.woke.length, 0);
    r.speech.emit('level', 0.9); now += 80; r.speech.emit('level', 0.1); now += 120; r.speech.emit('level', 0.9); now += 60; r.speech.emit('level',0.03);
    r.speech.emit('partial', 'hey jarvis');
    assert.equal(r.woke.length, 0, 'an old wake phrase cannot activate after the claps');
    r.speech.emit('partial', 'hey jarvis jarvis wake up');
    assert.equal(r.woke.length, 1);
  } finally { Date.now = realNow; }
});

function rig(over = {}) {
  const speech = new EventEmitter();
  const log = [];
  speech.listen = async () => { log.push('listen'); };
  speech.cancel = () => log.push('cancel');
  const timers = [];
  const cfg = { enabled: true, phrase: 'hey jarvis' };
  let can = true;
  const woke = [];
  const armed = [];
  const w = new WakeWord({ handoffMs: 0, speech, getConfig: () => cfg, canListen: () => can, onWake: (t) => woke.push(t), onArmed: (a) => armed.push(a), setTimer: (f, ms) => { timers.push({ f, ms }); return timers.length; }, clearTimer: () => {}, ...over });
  return { w, speech, log, cfg, woke, armed, timers, setCan: (v) => { can = v; } };
}

test('it listens only when enabled and Relay is free, and stops when either changes', async () => {
  const r = rig();
  await r.w.refresh();
  assert.deepEqual(r.log, ['listen']);
  assert.deepEqual(r.armed, [true]);
  await r.w.refresh();
  assert.deepEqual(r.log, ['listen'], 'already listening');
  r.setCan(false);
  await r.w.refresh();
  assert.deepEqual(r.log, ['listen', 'cancel']);
  assert.deepEqual(r.armed, [true, false]);
  r.cfg.enabled = false;
  r.setCan(true);
  await r.w.refresh();
  assert.deepEqual(r.log, ['listen', 'cancel'], 'switched off: it stays quiet');
});

test('hearing the phrase stops listening and wakes Relay once', async () => {
  const r = rig();
  await r.w.refresh();
  r.speech.emit('partial', 'hello');
  assert.equal(r.woke.length, 0);
  r.speech.emit('partial', 'hey jarvis');
  assert.equal(r.woke.length, 1);
  assert.ok(!r.w.armed);
  r.speech.emit('partial', 'hey jarvis hey jarvis');
  assert.equal(r.woke.length, 1, 'not armed any more, so nothing more happens');
});

test('a session is renewed now and then, and a failing microphone keeps retrying with bounded backoff', async () => {
  const r = rig();
  await r.w.refresh();
  assert.equal(r.timers.at(-1).ms, 90000);
  r.timers.at(-1).f(); // the renewal fires: it stops, then starts again shortly
  assert.deepEqual(r.log.slice(-1), ['cancel']);
  const again = r.timers.at(-1);
  assert.equal(again.ms, 400);
  await again.f();
  assert.deepEqual(r.log.slice(-1), ['listen']);

  const bad = rig();
  bad.speech.listen = async () => { throw new Error('mic busy'); };
  bad.w.log = { error() {} };
  for (let i = 0; i < 7; i++) await bad.w.arm();
  assert.equal(bad.w.errors, 7);
  assert.equal(bad.timers.filter((t) => t.ms >= 2000).length, 7);assert.ok(bad.timers.every(t=>t.ms<=30000));
});

test('quieter separated clap impulses work without treating sustained sound as two claps', () => {
  const gate = new ClapGate();
  for(let t=0;t<500;t+=50) gate.level(.03,t);
  assert.equal(gate.level(.28,600),false); gate.level(.04,660);
  assert.equal(gate.level(.3,850),false);assert.equal(gate.level(.03,900),true);
  gate.reset();for(let t=0;t<1000;t+=50) assert.equal(gate.level(.8,t),false);
  assert.equal(gate.level(NaN,1200),false);
});
test('wake handoff retains inline words and is cancelled when listening is disabled', async () => {
  const r=rig({handoffMs:300}); await r.w.refresh();
  r.speech.emit('partial','hey jarvis');r.speech.emit('partial','hey jarvis open notes');
  assert.equal(r.woke.length,0);r.timers.filter(t=>t.ms===300).at(-1).f();
  assert.deepEqual(r.woke,['hey jarvis open notes']);
  const stopped=rig({handoffMs:300});await stopped.w.refresh();stopped.speech.emit('partial','hey jarvis');stopped.cfg.enabled=false;stopped.w.disarm();stopped.timers.find(t=>t.ms===300).f();assert.equal(stopped.woke.length,0);
});
test('inline wake commands exclude the wake phrase and preceding room transcript', () => {
  const {commandAfterWake}=require('../src/main/wake');
  assert.equal(commandAfterWake('the television hey Jarvis open my calculator','hey jarvis'),'open my calculator');
  assert.equal(commandAfterWake('Jarvis wake up show my battery','hey jarvis'),'show my battery');
  assert.equal(commandAfterWake('hey jarvis','hey jarvis'),'');
});

test('revised wake partials extend handoff instead of executing an incomplete command',async()=>{const r=rig({handoffMs:450});await r.w.refresh();r.speech.emit('partial','hey jarvis');const old=r.timers.at(-1);r.speech.emit('partial','hey jarvis open my notes');old.f();assert.equal(r.woke.length,0);r.timers.at(-1).f();assert.deepEqual(r.woke,['hey jarvis open my notes']);});

test('wake re-arms after the speech helper ends or exits instead of staying falsely armed',async()=>{for(const event of ['final','error-event','exit']){const r=rig();await r.w.refresh();r.speech.emit(event,{});assert.equal(r.w.armed,false);await r.timers.at(-1).f();assert.equal(r.w.armed,true);assert.equal(r.log.filter(x=>x==='listen').length,2);}});
test('two brief acoustic transients arm claps but a sustained second sound does not',()=>{const g=new ClapGate();g.level(.8,1000);g.level(.02,1040);g.level(.8,1300);assert.equal(g.ready(1300),false);g.level(.8,1500);assert.equal(g.level(.02,1600),false);assert.equal(g.ready(1600),false);});
test('activation modes keep claps-only separate from phrase-only',async()=>{
 const real=Date.now;let now=20000;Date.now=()=>now;
 try{for(const mode of ['voice','claps','claps-voice']){const r=rig();r.cfg.mode=mode;await r.w.refresh();if(mode==='claps'){r.speech.emit('partial','hey jarvis');assert.equal(r.woke.length,0);}for(const [rms,peak,step] of [[.01,.4,0],[.005,.01,50],[.01,.4,220],[.005,.01,50]]){now+=step;r.speech.emit('acoustic',{rms,peak});}assert.equal(r.woke.length,mode==='claps'?1:0);if(mode!=='claps'){r.speech.emit('partial','hey jarvis');assert.equal(r.woke.length,1);}}}finally{Date.now=real;}
});

test('a final wake transcript hands off the latest command exactly once',async()=>{const r=rig({handoffMs:450});await r.w.refresh();r.speech.emit('partial','hey jarvis');r.speech.emit('final',{text:'hey jarvis open notes'});assert.deepEqual(r.woke,['hey jarvis open notes']);for(const t of r.timers.filter(t=>t.ms===450))t.f();assert.equal(r.woke.length,1);});
test('a final revision without the wake phrase does not execute a pending guess',async()=>{const r=rig({handoffMs:450});await r.w.refresh();r.speech.emit('partial','hey jarvis');r.speech.emit('final',{text:'a service'});assert.deepEqual(r.woke,[]);});
test('claps-only does not require a configured wake phrase or execute final speech',async()=>{const r=rig({handoffMs:450});r.cfg.mode='claps';r.cfg.phrase='';await r.w.refresh();assert.equal(r.w.armed,true);r.speech.emit('final',{text:'hey jarvis open notes'});assert.deepEqual(r.woke,[]);});
