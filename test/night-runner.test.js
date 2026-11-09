const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path'),os=require('os');
const {fileTools,runRestrictedNight}=require('../src/main/nightRunner');
test('overnight file tools cannot escape the proposal or execute commands',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'relay-night-tools-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));fs.mkdirSync(path.join(dir,'src'));fs.writeFileSync(path.join(dir,'src','a.js'),'// safe');
 const tools=fileTools(dir),read=tools[1].run,write=tools[2].run;assert.equal(read({file:'src/a.js'}),'// safe');
 for(const file of ['../secret','/etc/passwd','.git/config','src/../../secret','src/.env','package.json'])assert.throws(()=>write({file,text:'x'}));
 fs.symlinkSync(os.tmpdir(),path.join(dir,'src','alias'));assert.throws(()=>write({file:'src/alias/out.js',text:'x'}),/links/);
 write({file:'test/new.js',text:'// draft'});assert.equal(read({file:'test/new.js'}),'// draft');assert.match(tools[0].run(),/test\/new.js/);
 assert.throws(()=>fileTools(dir,{isPrivate:()=>true})[1].run({file:'src/a.js'}),/private/);
});
test('private mode prevents even locating Claude',async()=>{const r=await runRestrictedNight({isPrivate:()=>true,findClaude:()=>assert.fail('called')});assert.equal(r.code,1);});
test('runner uses strict existing Claude session with bounded turns, clean environment and only scoped tools',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'relay-night-runner-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));let stopped=false,seen;
 class Host{async start(){}stop(){stopped=true;}}
 const r=await runRestrictedNight({cwd:dir,prompt:'fixture',findClaude:async()=>'/claude',Host,spawnFn:(bin,args,opts)=>{seen={args,opts};},runClaude:async options=>{assert.equal(options.tools.length,3);assert.equal(options.timeoutMs,600000);options.spawnFn('/claude',['--tools',''],{env:{API_KEY:'must-not-pass'}});return{status:'done',reply:'SUMMARY: fixture'};}});
 assert.equal(r.code,0);assert.equal(stopped,true);assert.ok(seen.args.includes('--max-turns'));assert.equal(seen.opts.env.API_KEY,undefined);assert.equal(seen.opts.cwd,dir);
});
