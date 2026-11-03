// A separately installed, loopback-only God’s Eye server. No Relay credentials are inherited.
const fs=require('fs'),path=require('path'),os=require('os');
const {spawn}=require('child_process');
class GodsEyeServer {
 constructor({configFile,spawnFn=spawn,fetchFn=fetch,wait=ms=>new Promise(r=>setTimeout(r,ms))}){Object.assign(this,{configFile,spawnFn,fetchFn,wait});this.child=null;this.starting=null;}
 config(){try{const c=JSON.parse(fs.readFileSync(this.configFile,'utf8'));if(!path.isAbsolute(c.repo)||!path.isAbsolute(c.node)||!fs.existsSync(c.node)||!fs.existsSync(path.join(c.repo,'node_modules/vite/bin/vite.js')))return null;return c;}catch{return null;}}
 async health(url){try{const r=await this.fetchFn(url,{redirect:'error',signal:AbortSignal.timeout(1500)});return r.ok && /God.s Eye View/i.test((await r.text()).slice(0,20000));}catch{return false;}}
 async ensure(url='http://127.0.0.1:4173/'){
  if(await this.health(url))return {ready:true,started:false};
  if(new URL(url).origin!=='http://127.0.0.1:4173')throw Error('Start your custom God’s Eye server, or use http://127.0.0.1:4173/.');
  if(this.starting)return this.starting;
  this.starting=this.start(url).finally(()=>{this.starting=null;});return this.starting;
 }
 async start(url){
  const c=this.config();if(!c)throw Error('God’s Eye needs its local runtime setup. Run the Relay setup script first.');
  if(!this.child){const child=this.spawnFn(c.node,[path.join(c.repo,'node_modules/vite/bin/vite.js'),'--host','127.0.0.1','--port','4173','--strictPort'],{cwd:c.repo,env:{HOME:os.homedir(),PATH:path.dirname(c.node)+':/usr/bin:/bin:/usr/sbin:/sbin',LANG:'en_US.UTF-8',PUPPETEER_SKIP_DOWNLOAD:'true'},stdio:['ignore','ignore','ignore']});this.child=child;child.on('error',()=>{if(this.child===child)this.child=null;});child.on('exit',()=>{if(this.child===child)this.child=null;});}
  for(let i=0;i<60;i++){await this.wait(1000);if(await this.health(url))return {ready:true,started:true};if(!this.child)throw Error('God’s Eye stopped during startup. Check its local setup or whether port 4173 is already used.');}
  throw Error('God’s Eye is still starting. Wait a moment and choose Reload.');
 }
 stop(){this.child?.kill('SIGTERM');this.child=null;}
}
module.exports={GodsEyeServer};
