const test=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('events');
const {FirefoxBridge}=require('../src/main/firefoxBridge');
test('old Firefox sockets cannot reject or answer replacement connection requests',async()=>{
 let server;class Server extends EventEmitter{constructor(){super();server=this;}close(){}}
 class Socket extends EventEmitter{constructor(){super();this.readyState=1;}close(){}send(msg){this.last=JSON.parse(msg);}}
 const b=new FirefoxBridge({WebSocketServer:Server});b.start();const old=new Socket(),fresh=new Socket();server.emit('connection',old);server.emit('connection',fresh);
 const p=b.call('tabs',{});old.emit('message',JSON.stringify({id:fresh.last.id,result:'stale'}));old.emit('close');assert.equal(b.pending.size,1);
 fresh.emit('message',JSON.stringify({id:fresh.last.id,result:'fresh'}));assert.equal(await p,'fresh');
 const pending=b.call('tabs',{});b.stop();await assert.rejects(pending,/stopped/);assert.equal(b.pending.size,0);
});
