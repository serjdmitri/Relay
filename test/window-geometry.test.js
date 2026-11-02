const test=require('node:test'),assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {watchGeometry}=require('../src/main/windowGeometry');
test('geometry persistence coalesces drag events and flushes before closing',async()=>{
 const win=new EventEmitter();win.isDestroyed=()=>false;let writes=0;
 watchGeometry(win,()=>writes++);
 for(let i=0;i<50;i++)win.emit('moved');
 assert.equal(writes,0);
 await new Promise(resolve=>setTimeout(resolve,230));assert.equal(writes,1);
 win.emit('resized');win.emit('close');assert.equal(writes,2);
 win.emit('closed');await new Promise(resolve=>setTimeout(resolve,230));assert.equal(writes,2);
});
