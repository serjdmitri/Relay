const test=require('node:test'),assert=require('node:assert/strict'),path=require('path');
const {localFrame,safeKey,protectIpc}=require('../src/main/ipcSecurity');
const root='/app/renderer';
function event(url,child=false){const frame={url};return {senderFrame:frame,sender:{mainFrame:child?{}:frame}};}
test('IPC accepts only packaged top-level HTML pages',()=>{assert.ok(localFrame(event('file:///app/renderer/index.html?page=general'),root));for(const url of ['https://evil/index.html','file:///app/secrets.html','file:///app/renderer/../secret.html','data:text/html,hi','file:///app/renderer/app.js'])assert.equal(localFrame(event(url),root),false);assert.equal(localFrame(event('file:///app/renderer/index.html',true),root),false);});
test('prototype paths and malformed storage keys are rejected',()=>{for(const k of ['settings.__proto__.polluted','settings.constructor.x','settings..x',null])assert.equal(safeKey(k),false);assert.ok(safeKey('settings.hands.enabled'));assert.equal({}.polluted,undefined);});
test('IPC guard rejects an untrusted caller before executing handler',()=>{let handler,called=0;const ipc={handle:(_c,fn)=>handler=fn};protectIpc(ipc,root);ipc.handle('test',()=>++called);assert.throws(()=>handler(event('https://evil/')),/Untrusted/);assert.equal(called,0);assert.equal(handler(event('file:///app/renderer/index.html')),1);});
