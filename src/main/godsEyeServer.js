// A separately installed, loopback-only God’s Eye server. No Relay credentials are inherited.
const fs=require('fs'),path=require('path'),os=require('os');
const {spawn}=require('child_process');
class GodsEyeServer {
 constructor({configFile,spawnFn=spawn,fetchFn=fetch,wait=ms=>new Promise(r=>setTimeout(r,ms)),now=Date.now,startupMs=60000}){Object.assign(this,{configFile,spawnFn,fetchFn,wait,now,startupMs});this.child=null;this.starting=null;this.failure=null;}
 config(){try{const c=JSON.parse(fs.readFileSync(this.configFile,'utf8'));if(!path.isAbsolute(c.repo)||!path.isAbsolute(c.node)||!fs.existsSync(c.node)||!fs.existsSync(path.join(c.repo,'node_modules/vite/bin/vite.js')))return null;return c;}catch{return null;}}
 async health(url,{signal,timeoutMs=1500}={}){try{const limit=AbortSignal.timeout(Math.max(1,Math.ceil(timeoutMs))),combined=signal?AbortSignal.any([signal,limit]):limit;const r=await this.fetchFn(url,{redirect:'error',signal:combined});return r.ok && /God.s Eye View/i.test(await require('./httpBody').readText(r,{maxBytes:20000,truncate:true,signal:combined}));}catch{return false;}}
 async ensure(url='http://127.0.0.1:4173/'){
  if(this.starting)return this.starting;
  if(await this.health(url))return {ready:true,started:false};
  if(new URL(url).origin!=='http://127.0.0.1:4173')throw Error('Start your custom God’s Eye server, or use http://127.0.0.1:4173/.');
  if(this.starting)return this.starting;
  this.starting=this.start(url).finally(()=>{this.starting=null;});return this.starting;
 }
 async start(url){
  const controller=this.controller=new AbortController(),deadline=this.now()+this.startupMs;
  const c=this.config();if(!c)throw Error('God’s Eye needs its local runtime setup. Run the Relay setup script first.');
  if(!this.child){this.failure=null;const child=this.spawnFn(c.node,[path.join(c.repo,'node_modules/vite/bin/vite.js'),'--host','127.0.0.1','--port','4173','--strictPort'],{cwd:c.repo,env:{HOME:os.homedir(),PATH:path.dirname(c.node)+':/usr/bin:/bin:/usr/sbin:/sbin',LANG:'en_US.UTF-8',PUPPETEER_SKIP_DOWNLOAD:'true'},stdio:['ignore','ignore','pipe']});this.child=child;
   // Inspect only a bounded rolling fragment; retain fixed diagnoses, never raw server output.
   let tail='';child.stderr?.on('data',chunk=>{if(this.child!==child)return;tail=(tail+String(chunk).slice(-2048)).slice(-4096);if(/EADDRINUSE|Port 4173 is already in use/i.test(tail))this.failure='Port 4173 is already used. Close the other server or choose its URL.';else if(/MODULE_NOT_FOUND|ERR_MODULE_NOT_FOUND|Cannot find module/i.test(tail))this.failure='God’s Eye dependencies are missing. Run its local setup again.';else if(/EACCES|permission denied/i.test(tail))this.failure='God’s Eye cannot read or execute its runtime. Check its local setup permissions.';});
   child.on('error',e=>{if(this.child===child){this.failure=e.code==='ENOENT'?'God’s Eye runtime was not found. Run its local setup again.':'God’s Eye could not launch its local runtime.';this.child=null;}});
   child.on('exit',(code,signal)=>{if(this.child===child){this.failure ||= `God’s Eye exited during startup (${Number.isInteger(code)?'code '+code:signal?'signal '+String(signal).replace(/[^A-Z0-9]/g,'').slice(0,16):'no exit code'}). Check its local setup.`;this.child=null;}});}
  for(let i=0;i<600&&this.now()<deadline;i++){controller.signal.throwIfAborted();await this.wait(Math.min(100,Math.max(0,deadline-this.now())));controller.signal.throwIfAborted();if(this.now()>=deadline)break;if(await this.health(url,{signal:controller.signal,timeoutMs:Math.min(1500,deadline-this.now())}))return {ready:true,started:true};controller.signal.throwIfAborted();if(!this.child)throw Error(this.failure||'God’s Eye stopped during startup. Check its local setup or whether port 4173 is already used.');}
  throw Error('God’s Eye is still starting. Wait a moment and choose Reload.');
 }
 stop(){this.controller?.abort();this.child?.kill('SIGTERM');this.child=null;}
}
module.exports={GodsEyeServer};
