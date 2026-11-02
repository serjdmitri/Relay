const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs');
const os=require('os');
const path=require('path');
const {scanTree,StorageScan,isStorageRequest}=require('../src/main/drive/storageScan');
const {storageLayout}=require('../src/renderer/storage-layout');
function fixture(t){const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'relay-storage-test-')));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return root;}
test('metadata scan totals, drilldown structure and symbolic/protected folders are accurate',async t=>{
 const root=fixture(t);fs.mkdirSync(path.join(root,'Docs'));fs.writeFileSync(path.join(root,'Docs','a.txt'),'12345');fs.writeFileSync(path.join(root,'b.txt'),'12');fs.symlinkSync(path.join(root,'Docs'),path.join(root,'Alias'));fs.mkdirSync(path.join(root,'.hidden'));fs.writeFileSync(path.join(root,'.hidden','secret'),'hidden');
 const result=await scanTree(root);assert.equal(result.tree.bytes,7);assert.equal(result.files,2);assert.equal(result.partial,true);assert.equal(result.skipped,2);assert.equal(result.tree.children.find(n=>n.name==='Docs').children[0].bytes,5);
});
test('scan limits, permission failure and other mounts produce visible partial results',async t=>{
 const root=fixture(t);fs.mkdirSync(path.join(root,'Denied'));fs.mkdirSync(path.join(root,'Mount'));for(let i=0;i<8;i++)fs.writeFileSync(path.join(root,`file${i}`),'x');
 let r=await scanTree(root,{maxEntries:3});assert.equal(r.partial,true);assert.ok(r.entries<=3);
 const io=Object.create(fs.promises);io.opendir=async p=>{if(p.endsWith('Denied')){const e=Error();e.code='EACCES';throw e;}return fs.promises.opendir(p);};io.lstat=async p=>{const st=await fs.promises.lstat(p);if(p.endsWith('Mount'))return new Proxy(st,{get:(target,key)=>key==='dev'?st.dev+1:Reflect.get(target,key)});return st;};
 r=await scanTree(root,{io});assert.equal(r.unreadable,1);assert.match(r.tree.children.find(n=>n.name==='Mount').reason,/mounted/);assert.match(r.tree.children.find(n=>n.name==='Denied').reason,/EACCES/);
 r=await scanTree(root,{maxDepth:1});assert.ok(r.tree.children.some(n=>/Depth/.test(n.reason||'')));
 let time=0;r=await scanTree(root,{now:()=>time+=100,maxMs:1});assert.equal(r.partial,true);assert.equal(r.files,0);
});
test('worker-backed scans expose only scanned node IDs and reject revoked access or replaced paths',async t=>{
 const root=fixture(t);const file=path.join(root,'a.txt');fs.writeFileSync(file,'123');let revoked=false,revealed='';
 const access={require:()=>{if(revoked)throw Error('Access revoked');return {path:root};}};
 const scan=new StorageScan({access,reveal:p=>revealed=p});t.after(()=>scan.cancel());scan.start('root');
 for(let i=0;i<100&&scan.state.status==='scanning';i++)await new Promise(r=>setTimeout(r,20));
 assert.equal(scan.state.status,'ready');const view=scan.view();assert.equal(view.children[0].bytes,3);const id=view.children[0].id;
 assert.throws(()=>scan.view('../../etc'),/Choose/);scan.revealNode(id);assert.equal(revealed,file);
 fs.renameSync(file,file+'.old');fs.writeFileSync(file,'new');assert.throws(()=>scan.revealNode(id),/changed/);
 revoked=true;assert.throws(()=>scan.view(),/revoked/);scan.cancel();assert.equal(scan.state.status,'cancelled');assert.equal(scan.nodes.size,0);
});
test('cancelled and superseded worker results are ignored; early service failure is reported',()=>{
 const {EventEmitter}=require('events');const jobs=[];const scan=new StorageScan({access:{require:()=>({path:'/allowed'})},worker:()=>{const job=new EventEmitter();job.terminate=()=>{job.stopped=true;};jobs.push(job);return job;}});
 scan.start('one');scan.start('two');assert.equal(jobs[0].stopped,true);jobs[0].emit('message',{error:'stale'});assert.equal(scan.state.status,'scanning');jobs[1].emit('error',Error('Unavailable'));assert.equal(scan.state.status,'error');assert.equal(scan.state.error,'Unavailable');scan.cancel();
});
test('treemap preserves total area at narrow and wide sizes without overlaps or invalid blocks',()=>{
 const items=[1,3,10,7,2,0].map((bytes,id)=>({id,bytes}));for(const [w,h]of[[360,175],[780,220]]){const blocks=storageLayout(items,w,h);assert.equal(blocks.length,5);assert.ok(Math.abs(blocks.reduce((n,b)=>n+b.width*b.height,0)-w*h)<.01);for(const b of blocks){assert.ok(b.x>=0&&b.y>=0&&b.x+b.width<=w+.01&&b.y+b.height<=h+.01);assert.ok(b.width>0&&b.height>0);}for(let i=0;i<blocks.length;i++)for(let j=i+1;j<blocks.length;j++){const a=blocks[i],b=blocks[j];assert.ok(a.x+a.width<=b.x+.01||b.x+b.width<=a.x+.01||a.y+a.height<=b.y+.01||b.y+b.height<=a.y+.01);}}assert.deepEqual(storageLayout([],100,100),[]);
});
test('storage commands work independently of Claude or Codex; unrelated disk actions stay separate',()=>{
 for(const text of ['whats taking up my storage', 'what’s taking up my storage?', 'what is using my disk', 'check my storage', 'show my storage chart', 'show storage map','Open my disk map','Jarvis, what is filling up my space?','what\'s taking up my disk space','please show me the storage map'])assert.equal(isStorageRequest(text),true,text);
 for(const text of ['delete disk','weather in London','move my documents','show my storage and delete old files', 'what is taking up my storage then email my files'])assert.equal(isStorageRequest(text),false,text);
});
async function ready(scan,id){scan.start(id);for(let i=0;i<100&&scan.state.status==='scanning';i++)await new Promise(r=>setTimeout(r,15));assert.equal(scan.state.status,'ready');}
test('file-format boxes drill down to exactly their scanned files and expose real capacity',async t=>{
 const root=fixture(t);fs.writeFileSync(path.join(root,'a.mov'),'video');fs.writeFileSync(path.join(root,'b.jpg'),'photo');fs.writeFileSync(path.join(root,'c.txt'),'note');
 const scan=new StorageScan({access:{require:()=>({path:root})}});t.after(()=>scan.cancel());await ready(scan,'chosen');
 const types=scan.view('types');assert.deepEqual(types.children.map(n=>n.name).sort(),['Documents','Photos','Videos']);assert.ok(types.capacity.total>0);
 const photos=scan.view('category:image');assert.deepEqual(photos.children.map(n=>n.name),['b.jpg']);assert.equal(photos.node.bytes,5);assert.equal(photos.children[0].trashable,true);
});
test('entire-computer mode is read-only scope, does not authorize organization and protects files outside home',async t=>{
 const root=fixture(t),home=path.join(root,'Home');fs.mkdirSync(home);fs.writeFileSync(path.join(root,'system.txt'),'system');fs.writeFileSync(path.join(home,'personal.txt'),'personal');
 let grants=0;const scan=new StorageScan({home,computerRoot:root,access:{require:()=>{grants++;throw Error('No chosen folder');}}});t.after(()=>scan.cancel());await ready(scan,'computer');assert.equal(grants,0);
 const files=scan.view('category:document').children;assert.equal(files.find(n=>n.name==='system.txt').trashable,false);assert.equal(files.find(n=>n.name==='personal.txt').trashable,true);assert.throws(()=>scan.trashItems([files.find(n=>n.name==='system.txt').id]),/outside/);
});
test('Trash always previews exact files, honors cancel, validates changes and updates category totals',async t=>{
 const root=fixture(t),file=path.join(root,'a.txt');fs.writeFileSync(file,'test');const scan=new StorageScan({access:{require:()=>({path:root})}});t.after(()=>scan.cancel());await ready(scan,'chosen');
 const id=scan.view('category:document').children[0].id;let moved=0;
 const cancel=await scan.trash([id],{confirm:async items=>{assert.equal(items[0].path,file);return false;},trashItem:async()=>moved++});assert.equal(cancel.cancelled,true);assert.equal(moved,0);assert.ok(fs.existsSync(file));
 fs.writeFileSync(file,'changed');await assert.rejects(scan.trash([id],{confirm:()=>true,trashItem:()=>moved++}),/changed/);assert.equal(moved,0);
 await ready(scan,'chosen');const fresh=scan.view('category:document').children[0].id;
 const result=await scan.trash([fresh],{confirm:()=>true,trashItem:async p=>{fs.renameSync(p,path.join(root,'fixture-trash'));moved++;}});
 assert.equal(result.count,1);assert.equal(scan.view('types').children.length,0);assert.equal(fs.readFileSync(path.join(root,'fixture-trash'),'utf8'),'changed');
});
test('a changed scan during confirmation cannot move a different file with the same node ID',async t=>{
 const root=fixture(t),file=path.join(root,'a.txt');fs.writeFileSync(file,'test');const scan=new StorageScan({access:{require:()=>({path:root})}});t.after(()=>scan.cancel());await ready(scan,'chosen');const id=scan.view('category:document').children[0].id;let moved=false;
 const result=await scan.trash([id],{confirm:async()=>{scan.cancel();return true;},trashItem:()=>{moved=true;}});assert.equal(result.count,0);assert.equal(result.failed.length,1);assert.equal(moved,false);assert.ok(fs.existsSync(file));
});
test('voice Trash selects only an explicit menu selection and ignores negations or unrelated files',()=>{
 const {parseStorageTrash}=require('../src/main/drive/storageScan');for(const phrase of ['delete selected files','please delete the selected files','trash these files','remove my selection'])assert.equal(parseStorageTrash(phrase),true,phrase);
 for(const phrase of ["don't delete selected files",'delete Downloads','delete my photo.jpg','empty Trash'])assert.equal(parseStorageTrash(phrase),false,phrase);
});
