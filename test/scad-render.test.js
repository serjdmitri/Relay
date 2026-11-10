const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path');const {renderScad}=require('../src/main/models/scadRender');
test('renders only via the sandbox and cleans up its temporary source',async t=>{
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'scad-test-'));t.after(()=>fs.rmSync(tmp,{recursive:true,force:true}));const engine=path.join(tmp,'OpenSCAD.app','Contents','MacOS','OpenSCAD');fs.mkdirSync(path.dirname(engine),{recursive:true});fs.writeFileSync(engine,'');let input;
 const result=await renderScad('cube(2);',{engine,tempRoot:tmp,run:async (bin,args,opts)=>{assert.equal(bin,'/usr/bin/sandbox-exec');assert.match(args[1],/deny default/);assert.equal(opts.env.HOME,opts.env.TMPDIR);assert.equal(opts.env.OPENAI_API_KEY,undefined);input=args.at(-1);fs.writeFileSync(args.at(-2),Buffer.alloc(100));}});
 assert.equal(result.length,100);assert.equal(fs.existsSync(input),false);
});
test('missing renderer and invalid source fail without execution',async()=>{await assert.rejects(renderScad('cube(2);',{engine:'/not-installed'}),/not installed/);await assert.rejects(renderScad('x'.repeat(1024*1024+1)),/too large/);});
