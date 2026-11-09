const test=require('node:test'),assert=require('node:assert/strict'),{createFloatingWindow}=require('../src/main/floatingWindow');
test('floating menus retain geometry while enforcing isolation and blocked navigation',()=>{
 let options,guard,popups,level;class Window{constructor(o){options=o;this.webContents={setWindowOpenHandler:f=>popups=f,on:(_e,f)=>guard=f};}setAlwaysOnTop(...args){level=args;}setVisibleOnAllWorkspaces(){} }
 createFloatingWindow(Window,{x:10,y:20,width:400,height:500,webPreferences:{nodeIntegration:true}});
 assert.equal(options.width,400);assert.equal(options.x,10);assert.equal(options.webPreferences.nodeIntegration,false);assert.equal(options.webPreferences.sandbox,true);assert.equal(options.webPreferences.contextIsolation,true);assert.deepEqual(popups(),{action:'deny'});let stopped=false;guard({preventDefault:()=>stopped=true});assert.equal(stopped,true);assert.deepEqual(level,[true,'screen-saver',1]);
});
