const test=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('events');const {GodsEyeServer}=require('../src/main/godsEyeServer');
test('an existing healthy server is reused without spawning',async()=>{const s=new GodsEyeServer({configFile:'none',spawnFn:()=>assert.fail('spawned'),fetchFn:async()=>({ok:true,text:async()=>"<title>God’s Eye View</title>"})});assert.equal((await s.ensure()).started,false);});
test('startup is shared, loopback only and strips credential environment',async()=>{let calls=0,health=0;const child=new EventEmitter();child.kill=()=>calls++;const s=new GodsEyeServer({configFile:'none',wait:async()=>{},spawnFn:(_bin,args,opts)=>{calls++;assert.ok(args.includes('127.0.0.1'));assert.ok(args.includes('--strictPort'));assert.equal(opts.env.OPENAI_API_KEY,undefined);return child;}});s.config=()=>({repo:'/repo',node:'/runtime/node'});s.health=async()=>++health>2;await Promise.all([s.ensure(),s.ensure()]);assert.equal(calls,1);s.stop();assert.equal(calls,2);});
test('missing runtime and custom URLs do not execute arbitrary commands',async()=>{const s=new GodsEyeServer({configFile:'none'});s.health=async()=>false;await assert.rejects(s.ensure(),/setup/);await assert.rejects(s.ensure('http://localhost:9999'),/custom/);});

test('startup has a real deadline including slow health checks, and stop cancels it',async()=>{
 let now=0,calls=0;const child=new EventEmitter();child.kill=()=>{};
 const s=new GodsEyeServer({configFile:'none',now:()=>now,startupMs:3000,wait:async n=>now+=n,spawnFn:()=>child});s.config=()=>({repo:'/r',node:'/n'});
 s.health=async(_u,{timeoutMs})=>{calls++;now+=timeoutMs;return false;};
 await assert.rejects(s.start('http://127.0.0.1:4173/'),/still starting/);assert.equal(now,3000);assert.equal(calls,2);
 s.wait=async()=>s.stop();now=0;await assert.rejects(s.start('http://127.0.0.1:4173/'),{name:'AbortError'});
});
test('startup diagnoses port/dependency failures without returning raw server output',async()=>{
 for(const [raw,expected] of [['secret-token EADDRINUSE',/Port 4173/],['secret-token ERR_MODULE_NOT_FOUND',/dependencies/],['secret-token EACCES',/permissions/]]){
  const child=new EventEmitter();child.stderr=new EventEmitter();child.kill=()=>{};
  const s=new GodsEyeServer({configFile:'none',spawnFn:()=>child,wait:async()=>{child.stderr.emit('data',Buffer.from(raw));child.emit('exit',1);}});
  s.config=()=>({repo:'/r',node:'/n'});s.health=async()=>false;
  await assert.rejects(s.start('http://127.0.0.1:4173/'),e=>expected.test(e.message)&&!e.message.includes('secret-token'));
 }
});
