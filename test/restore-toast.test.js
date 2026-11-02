const test=require('node:test'),assert=require('node:assert/strict'),Module=require('node:module');
const original=Module._load;let handler;
class Window{constructor(){this.webContents={once(){},send(){}};this.visible=false;}isDestroyed(){return false}setAlwaysOnTop(){}setVisibleOnAllWorkspaces(){}setHiddenInMissionControl(){}loadFile(){}setPosition(){}showInactive(){this.visible=true}hide(){this.visible=false}destroy(){}}
Module._load=function(name,...args){return name==='electron'?{BrowserWindow:Window,screen:{getCursorScreenPoint:()=>({}),getDisplayNearestPoint:()=>({workArea:{x:0,y:0,width:1200,height:900}})},ipcMain:{handle:(_name,f)=>{handler=f}}}:original.call(this,name,...args)};
let RestoreToast;try{({RestoreToast}=require('../src/main/restoreToast'))}finally{Module._load=original}
const make=()=>new RestoreToast('',{setTimer:()=>1,clearTimer(){}});
test('Restore is available only to its own window and runs the action once',async()=>{
 const t=make();let count=0;t.offer(async()=>{count++});
 assert.equal((await handler({sender:{}})).ok,false);
 assert.equal((await handler({sender:t.win.webContents})).ok,true);assert.equal(count,1);assert.equal(t.win.visible,false);
 assert.equal((await t.restore()).ok,false);
});
test('a failed restore remains available, and an older restore cannot hide a new offer',async()=>{
 const t=make();t.offer(async()=>{throw Error('retry')});assert.equal((await t.restore()).ok,false);assert.equal(t.win.visible,true);
 let release;t.offer(()=>new Promise(r=>{release=r}));const old=t.restore();let newer=0;t.offer(async()=>{newer++});release();await old;
 assert.equal(t.win.visible,true);await t.restore();assert.equal(newer,1);
});
