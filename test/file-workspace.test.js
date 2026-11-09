const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { DriveAccess } = require('../src/main/drive/access');
const { FileWorkspace } = require('../src/main/drive/workspace');
function setup(t) {
  const root = fs.mkdtempSync(path.join(os.homedir(), 'relay-workspace-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const store = { data: { settings: { driveRoots: [] } }, get(k) { return k.split('.').reduce((o, p) => o?.[p], this.data); }, set(k,v) { this.data.settings.driveRoots = v; }, save() {} };
  const access = new DriveAccess({ store, home: root });
  const id = access.add(root).roots[0].id; access.mode(id, 'organize');
  const move = (from, to) => { fs.linkSync(from, to); fs.unlinkSync(from); }; // exclusive test mover; fails if target appears
  const workspace = new FileWorkspace({ store, access, move });
  const file = (name, text = 'example', old = true) => { const p = path.join(root, name); fs.writeFileSync(p,text); if(old) fs.utimesSync(p,new Date(0),new Date(Date.now()-4*3600000)); return p; };
  return { root, id, store, access, workspace, file, move };
}
test('preview leaves files alone; apply and persistent undo preserve content and avoid existing names', async t => {
  const x = setup(t); const p = x.file('report.pdf');
  fs.mkdirSync(path.join(x.root,'Organized','PDFs'), {recursive:true}); x.file('Organized/PDFs/report.pdf', 'existing');
  const plan = x.workspace.preview(x.id);
  assert.equal(plan.moves.length,1); assert.ok(fs.existsSync(p)); assert.match(plan.moves[0].to,/report \(2\).pdf$/);
  const r = await x.workspace.apply(plan.id); assert.equal(r.done.length,1); assert.equal(fs.readFileSync(plan.moves[0].to,'utf8'),'example');
  assert.equal(fs.readFileSync(path.join(x.root,'Organized/PDFs/report.pdf'),'utf8'),'existing');
  await assert.rejects(x.workspace.apply(plan.id),/expired/);
  const fresh = new FileWorkspace(x); const undo = await fresh.undo(plan.id);
  assert.equal(undo.count,1); assert.equal(fs.readFileSync(p,'utf8'),'example'); assert.equal(fresh.history(x.id).length,0);
});
test('recent files, incomplete downloads, hidden files, directories and code projects are protected', t => {
  const x = setup(t); x.file('new.pdf','new',false); x.file('loading.pdf.part'); x.file('.hidden.pdf'); x.file('unknown.xyz'); fs.mkdirSync(path.join(x.root,'Folder'));
  assert.equal(x.workspace.preview(x.id).moves.length,0);
  x.file('package.json','{}'); assert.throws(()=>x.workspace.preview(x.id),/code project/);
});
test('changed files, occupied targets, symlink destinations and revoked access fail without data loss', async t => {
  const x=setup(t); const p=x.file('a.pdf'); let plan=x.workspace.preview(x.id);
  fs.writeFileSync(p,'changed'); let r=await x.workspace.apply(plan.id); assert.equal(r.done.length,0); assert.match(r.failed[0].reason,/changed/);
  fs.utimesSync(p,new Date(0),new Date(Date.now()-4*3600000)); plan=x.workspace.preview(x.id);
  fs.writeFileSync(plan.moves[0].to,'occupied'); r=await x.workspace.apply(plan.id); assert.equal(r.done.length,0); assert.equal(fs.readFileSync(p,'utf8'),'changed');
  plan=x.workspace.preview(x.id); x.access.mode(x.id,'read'); await assert.rejects(x.workspace.apply(plan.id),/Enable organization/);
  x.access.mode(x.id,'organize'); plan=x.workspace.preview(x.id);
  fs.renameSync(path.join(x.root,'Organized'),path.join(x.root,'Other')); fs.symlinkSync(path.join(x.root,'Other'),path.join(x.root,'Organized'));
  r=await x.workspace.apply(plan.id); assert.equal(r.done.length,0); assert.match(r.failed[0].reason,/symbolic/);
});
test('undo retains changed files and collisions for retry and recovers a pre-move journal interruption', async t => {
  const x=setup(t); const p=x.file('a.pdf'); const plan=x.workspace.preview(x.id); await x.workspace.apply(plan.id);
  x.file('a.pdf','new occupant'); let r=await x.workspace.undo(plan.id); assert.equal(r.count,0); assert.equal(r.failed.length,1); assert.equal(x.workspace.history(x.id).length,1);
  fs.unlinkSync(p); r=await x.workspace.undo(plan.id); assert.equal(r.count,1);
  const pending=x.workspace.preview(x.id); x.store.data.workspaceMoves=[{id:pending.id,rootId:x.id,moves:[{...pending.moves[0],stamp:require('../src/main/drive/workspace').stamp(fs.statSync(p))}]}];
  r=await x.workspace.undo(pending.id); assert.equal(r.failed.length,0); assert.ok(fs.existsSync(p)); assert.equal(x.workspace.history(x.id).length,0);
});
test('a native response failure after a successful move keeps a recoverable journal', async t => {
  const x=setup(t); x.file('a.pdf'); const plan=x.workspace.preview(x.id);
  x.workspace.move=(from,to)=>{x.move(from,to);throw Error('Native response interrupted');};
  const r=await x.workspace.apply(plan.id); assert.equal(r.failed.length,1); assert.equal(x.workspace.history(x.id)[0].count,1);
  x.workspace.move=x.move; assert.equal((await x.workspace.undo(plan.id)).count,1);
});
test('async moves yield to the UI and same-folder operations cannot overlap',async t=>{
 const x=setup(t);const p=x.file('a.pdf');const plan=x.workspace.preview(x.id);let release;
 x.workspace.move=async(from,to)=>{await new Promise(r=>release=r);x.move(from,to);};
 const pending=x.workspace.apply(plan.id);await new Promise(r=>setImmediate(r));assert.ok(fs.existsSync(p));
 await assert.rejects(x.workspace.undo(plan.id),/already being/);release();assert.equal((await pending).done.length,1);
 x.workspace.move=async(from,to)=>{await new Promise(r=>setImmediate(r));x.move(from,to);};
 assert.equal((await x.workspace.undo(plan.id)).count,1);assert.ok(fs.existsSync(p));
});
