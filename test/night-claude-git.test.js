const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path'),cp=require('child_process');
const {runNight}=require('../src/main/nightClaude'),{ProposalWorkspace}=require('../src/main/selfImprove');
for(const scenario of ['large','many','failed','small','symlink'])test('real Git proposal: '+scenario,async t=>{
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'relay-night-regression-'));t.after(()=>fs.rmSync(tmp,{recursive:true,force:true}));
 const repo=path.join(tmp,'repo');fs.mkdirSync(repo);const run=async(args,{cwd})=>{try{return{code:0,stdout:cp.execFileSync(args[0],args.slice(1),{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']}),stderr:''};}catch(e){return{code:e.status||1,stdout:String(e.stdout||''),stderr:String(e.stderr||'')}}};
 for(const a of [['git','init','-b','main'],['git','config','user.name','Test'],['git','config','user.email','test@example.invalid']])await run(a,{cwd:repo});
 fs.mkdirSync(path.join(repo,'src'));fs.writeFileSync(path.join(repo,'src','a.js'),'module.exports=1;\n');await run(['git','add','.'],{cwd:repo});await run(['git','commit','-m','fixture'],{cwd:repo});
 const data={};const proposals=new ProposalWorkspace({run,store:{get:k=>data[k],set:(k,v)=>data[k]=v},getConfig:()=>({repo,base:'main'})});
 const r=await runNight({proposals,brief:'fixture',key:scenario,runClaude:async({cwd})=>{
  fs.mkdirSync(path.join(cwd,'test'));
  if(scenario==='many')for(let i=0;i<20;i++)fs.writeFileSync(path.join(cwd,'test',i+'.js'),'// one\n');
  else if(scenario==='symlink')fs.symlinkSync('/tmp',path.join(cwd,'src','link'));
  else fs.writeFileSync(path.join(cwd,'test','new file\nname.js'),'// test\n'.repeat(scenario==='large'?1000:1));
  return{code:scenario==='failed'?1:0,stdout:'SUMMARY: fixture'};
 }});
 const p=proposals.list()[0];
 if(scenario==='small'){assert.equal(r.status,'ready');assert.equal(r.files.length,1);assert.equal(r.lines,1);assert.equal(p.reviewed,false);}
 else{assert.equal(r.status,'discarded');assert.ok(p.discarded);assert.equal(fs.existsSync(p.dir),false);}
});
