const test=require('node:test'),assert=require('node:assert/strict'),Module=require('node:module');
const {EventEmitter}=require('node:events');
class Window extends EventEmitter {
  constructor(){super();this.destroyed=false;this.webContents=new EventEmitter();this.sent=[];this.reloads=0;this.webContents.send=(_channel,cmd)=>this.sent.push(cmd);this.webContents.reload=()=>this.reloads++;}
  isDestroyed(){return this.destroyed;}
  setIgnoreMouseEvents(){} setAlwaysOnTop(){} setVisibleOnAllWorkspaces(){} loadFile(){}
}
const original=Module._load;
Module._load=function(name,...args){return name==='electron'?{app:{},BrowserWindow:Window,screen:{}}:original.call(this,name,...args);};
let Overlay;try{({Overlay}=require('../src/main/overlay'));}finally{Module._load=original;}
const display={id:1,bounds:{x:0,y:0,width:1200,height:800}};
test('a reloaded overlay receives its current reactor state again',()=>{
 const o=new Overlay({isEnabled:()=>true}),e=o.entry(display);e.hud=true;e.look='jarvis';
 const idle={type:'hud',state:{state:'reactor-idle'}};o.send(e,idle);e.win.webContents.emit('did-finish-load');
 e.win.sent=[];e.win.webContents.emit('did-start-loading');assert.equal(e.ready,false);
 const latest={type:'hud',state:{state:'listening'}};o.send(e,latest);e.win.webContents.emit('did-finish-load');
 assert.equal(e.ready,true);assert.deepEqual(e.win.sent.at(-1),latest);
});
test('a crashed renderer reloads, with a bounded recovery budget',()=>{
 const o=new Overlay({isEnabled:()=>true}),e=o.entry(display);
 for(const reason of ['crashed','killed','crashed'])e.win.webContents.emit('render-process-gone',{}, {reason});
 assert.equal(e.win.reloads,2);
 e.win.webContents.emit('render-process-gone',{}, {reason:'clean-exit'});assert.equal(e.win.reloads,2);
});

test('closing the reactor releases its border timer and rejects late geometry',()=>{const o=new Overlay({isEnabled:()=>true}),e=o.entry(display);o.hudEntry=e;o.borderTimer=setInterval(()=>{},1000);e.win.destroyed=true;assert.doesNotThrow(()=>o.refreshBorder());e.win.emit('closed');assert.equal(o.borderTimer,null);assert.equal(o.hudEntry,null);assert.equal(o.wins.size,0);});
