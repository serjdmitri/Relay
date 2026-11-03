const {BrowserWindow,WebContentsView,screen,ipcMain,session,shell}=require('electron');
const path=require('path'),fs=require('fs');
function mapAddress(kind,configured){if(kind==='argos')return 'https://argosatlas.com/map/';const u=new URL(configured||'http://127.0.0.1:4173');if(!['http:','https:'].includes(u.protocol)||!['localhost','127.0.0.1','[::1]'].includes(u.hostname)||u.username||u.password||u.search||u.hash)throw Error('God’s Eye must use a local loopback server URL.');return u.href;}
const mapIntent=text=>{const n=String(text||'').toLowerCase();if(!/\b(?:show|open|view|launch|map)\b/.test(n))return null;return /\bargos(?: atlas)?\b/.test(n)?'argos':/\bgod[’']?s? eye(?: view)?\b/.test(n)?'godseye':null;};
class MapWindow {
 constructor({store,motion,server,onWorldView=()=>{}}){Object.assign(this,{store,motion,server,onWorldView});this.windows=new Map();ipcMain.on('maps:chrome',(event,data)=>{const r=this.windows.get('godseye');if(!r||event.sender!==r.view.webContents||event.senderFrame!==r.view.webContents.mainFrame)return;if(data?.action==='close')r.win.close();else if(data?.action==='settings')this.settings(r);else if(data?.action==='layout')r.layout=data;});ipcMain.handle('maps:action',async(e,action,value)=>{const record=[...this.windows.values()].find(r=>r.win.webContents===e.sender);if(!record)return {error:'Open a map menu first.'};try{if(action==='close')record.win.close();else if(action==='settings'){this.settings(record);}else if(action==='controls'&&record.kind==='godseye'){if(!['hover','pinned'].includes(value))throw Error('Choose hover or pinned controls.');store.set('settings.godsEyeControls',value);await record.view.webContents.executeJavaScript('window.__relaySetWorldControls?.('+JSON.stringify(value)+')');}else if(action==='reload')await this.load(record);else if(action==='browser')await shell.openExternal(record.url);else if(action==='url'&&record.kind==='godseye'){const url=mapAddress('godseye',value);store.set('settings.godsEyeUrl',url);record.url=url;await this.load(record);}else throw Error('Unknown map action.');return {ok:true};}catch(err){return {error:err.message};}});}
 settings(r){r.settings=!r.settings;r.win.setIgnoreMouseEvents(false);r.win.webContents.send('maps:settings',r.settings);r.resize();}
 async load(r){
  if(this.store.get('settings.model.provider')==='ollama')throw Error('Online map feeds are disabled in local/private mode.');
  r.ready=false;r.view.setVisible(false);
  const status=text=>{if(!r.win.isDestroyed())r.win.webContents.send('maps:status',{kind:r.kind,status:text,url:r.url});};
  status(r.kind==='godseye'?'Starting the local God’s Eye engine…':'Loading external map…');
  try{
   if(r.kind==='godseye'&&this.server)await this.server.ensure(r.url);
   if(r.win.isDestroyed())return;
   await r.view.webContents.loadURL(r.url);
   if(r.win.isDestroyed())return;
   if(r.kind==='godseye'){await r.view.webContents.insertCSS(fs.readFileSync(path.join(__dirname,'../renderer/gods-eye-theme.css'),'utf8'));await r.view.webContents.executeJavaScript(fs.readFileSync(path.join(__dirname,'../renderer/gods-eye-integrate.js'),'utf8'));await r.view.webContents.executeJavaScript(fs.readFileSync(path.join(__dirname,'../renderer/gods-eye-commands.js'),'utf8'));await r.view.webContents.executeJavaScript(fs.readFileSync(path.join(__dirname,'../renderer/gods-eye-layout.js'),'utf8'));await r.view.webContents.executeJavaScript('window.__relaySetWorldControls('+JSON.stringify(this.store.get('settings.godsEyeControls')==='pinned'?'pinned':'hover')+')');}
   r.ready=true;r.resize();r.view.setVisible(true);status(r.kind==='godseye'?'God’s Eye engine connected · live sources show their own freshness':'External map loaded · source availability applies');
   if(r.kind==='godseye')this.onWorldView(true);
  }catch(e){status(r.kind==='godseye'?String(e.message||'God’s Eye could not start. Reload to retry.'):'Argos could not load. Check your network or open the source in your browser.');}
 }
 open(kind='argos'){
  if(this.store.get('settings.model.provider')==='ollama')throw Error('Online map feeds are disabled in local/private mode.');
  const current=this.windows.get(kind);if(current){clearTimeout(current.releaseTimer);current.win.show();current.win.moveTop();if(kind==='godseye')this.onWorldView(true);return;}
  const area=screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea,immersive=kind==='godseye',width=immersive?area.width:Math.min(1050,area.width),height=immersive?area.height:Math.min(750,area.height);
  const win=new BrowserWindow({x:area.x+Math.round((area.width-width)/2),y:area.y+Math.round((area.height-height)/2),width,height,minWidth:460,minHeight:350,frame:false,transparent:true,show:false,resizable:true,backgroundColor:'#00000000',type:'panel',webPreferences:{preload:path.join(__dirname,'preload.js'),contextIsolation:true,sandbox:true}});
  win.setAlwaysOnTop(true,'screen-saver',kind==='godseye'?0:1);
  const isolated=session.fromPartition('relay-map-'+kind);isolated.setPermissionRequestHandler((_w,_p,cb)=>cb(false));isolated.setPermissionCheckHandler(()=>false);isolated.on('will-download',event=>event.preventDefault());
  const view=new WebContentsView({webPreferences:{session:isolated,...(immersive?{preload:path.join(__dirname,'godsEyePreload.js')}:{}),contextIsolation:true,sandbox:true,nodeIntegration:false,webSecurity:true,backgroundThrottling:false}});
  if(immersive)view.setBackgroundColor('#00000000');
  const r={win,view,kind,url:mapAddress(kind,this.store.get('settings.godsEyeUrl'))};this.windows.set(kind,r);win.contentView.addChildView(view);
  view.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  const allow=url=>{try{return new URL(url).origin===new URL(r.url).origin;}catch{return false;}};
  for(const event of ['will-navigate','will-redirect'])view.webContents.on(event,(e,url)=>{if(!allow(url))e.preventDefault();});
  const resize=()=>{const [w,h]=win.getContentSize();const top=kind==='godseye'?(r.settings?109:r.ready?0:42):109;view.setBounds({x:immersive?0:1,y:top,width:Math.max(1,w-(immersive?0:2)),height:Math.max(1,h-top-(immersive&&r.ready?0:32))});};r.resize=resize;resize();win.on('resize',resize);
  win.loadFile(path.join(__dirname,'../renderer/maps.html'),{query:{kind}});win.once('ready-to-show',()=>{win.show();if(kind==='godseye')this.onWorldView(true);this.load(r).catch(()=>{});});
  if(immersive)r.pointerTimer=setInterval(()=>{if(win.isDestroyed()||!win.isVisible())return;const l=r.layout;let accepts=true;if(r.ready&&!r.settings&&l?.orbit){const p=screen.getCursorScreenPoint(),b=win.getBounds(),x=p.x-b.x,y=p.y-b.y,g=l.globe;const inside=q=>q&&[q.x,q.y,q.width,q.height].every(Number.isFinite)&&x>=q.x&&y>=q.y&&x<=q.x+Math.max(0,q.width)&&y<=q.y+Math.max(0,q.height);accepts=!!(l.dragging||g&&[g.x,g.y,g.radius].every(Number.isFinite)&&Math.hypot(x-g.x,y-g.y)<=Math.max(0,g.radius)||Array.isArray(l.rects)&&l.rects.slice(0,40).some(inside));}if(r.accepts!==accepts){r.accepts=accepts;win.setIgnoreMouseEvents(!accepts,{forward:true});}},80);
  if(immersive)win.on('close',event=>{if(r.disposing||!r.ready)return;event.preventDefault();win.hide();this.onWorldView(false);clearTimeout(r.releaseTimer);r.releaseTimer=setTimeout(()=>{r.disposing=true;win.destroy();},120000);r.releaseTimer.unref?.();});
  win.on('closed',()=>{clearTimeout(r.releaseTimer);clearInterval(r.pointerTimer);if(!view.webContents.isDestroyed())view.webContents.close();this.windows.delete(kind);if(kind==='godseye')this.onWorldView(false);});this.motion?.watchWindow(win,{key:'map-'+kind,close:()=>win.close(),undo:()=>this.open(kind)});
 }
 async command(command,{signal}={}){
  if(this.commandBusy)throw Error('Finish or stop the current map command first.');
  this.commandBusy=true;let r;
  const cancel=()=>{if(r&&!r.view.webContents.isDestroyed())r.view.webContents.executeJavaScript('window.__relayGodsEyeAbort?.abort()').catch(()=>{});};
  signal?.addEventListener('abort',cancel,{once:true});
  try{
   this.open('godseye');r=this.windows.get('godseye');
   for(let i=0;i<1600;i++){
    signal?.throwIfAborted();if(r.win.isDestroyed())throw Error('The God’s Eye workspace was closed.');
    const ready=r.ready&&await r.view.webContents.executeJavaScript('!!(window.__relayWorldReady && window.__relayGodsEyeCommand && window.__godsEyeView?.voiceCommands?.runner)').catch(()=>false);
    if(ready){const pending=r.view.webContents.executeJavaScript('window.__relayGodsEyeCommand('+JSON.stringify(command)+')');
     return await Promise.race([pending,new Promise((_,reject)=>{const timer=setTimeout(()=>{cancel();reject(Error('God’s Eye did not finish in time.'));},35000);pending.finally(()=>clearTimeout(timer)).catch(()=>{});})]);}
    await new Promise(resolve=>setTimeout(resolve,50));
   }
   throw Error('God’s Eye has not finished loading. Check its workspace status and try again.');
  }finally{signal?.removeEventListener('abort',cancel);this.commandBusy=false;}
 }
 close(){for(const r of this.windows.values()){r.disposing=true;r.win.close();}}
}
module.exports={MapWindow,mapAddress,mapIntent};
