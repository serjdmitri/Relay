const {BrowserWindow,WebContentsView,screen,ipcMain,session,shell}=require('electron');
const path=require('path');
function mapAddress(kind,configured){if(kind==='argos')return 'https://argosatlas.com/map/';const u=new URL(configured||'http://127.0.0.1:4173');if(!['http:','https:'].includes(u.protocol)||!['localhost','127.0.0.1','[::1]'].includes(u.hostname)||u.username||u.password||u.search||u.hash)throw Error('God’s Eye must use a local loopback server URL.');return u.href;}
const mapIntent=text=>{const n=String(text||'').toLowerCase();if(!/\b(?:show|open|view|launch|map)\b/.test(n))return null;return /\bargos(?: atlas)?\b/.test(n)?'argos':/\bgod[’']?s? eye(?: view)?\b/.test(n)?'godseye':null;};
class MapWindow {
 constructor({store,motion}){Object.assign(this,{store,motion});this.windows=new Map();ipcMain.handle('maps:action',async(e,action,value)=>{const record=[...this.windows.values()].find(r=>r.win.webContents===e.sender);if(!record)return {error:'Open a map menu first.'};try{if(action==='close')record.win.close();else if(action==='reload')await this.load(record);else if(action==='browser')await shell.openExternal(record.url);else if(action==='url'&&record.kind==='godseye'){const url=mapAddress('godseye',value);store.set('settings.godsEyeUrl',url);record.url=url;await this.load(record);}else throw Error('Unknown map action.');return {ok:true};}catch(err){return {error:err.message};}});}
 async load(r){if(this.store.get('settings.model.provider')==='ollama')throw Error('Online map feeds are disabled in local/private mode.');r.win.webContents.send('maps:status',{kind:r.kind,status:'Loading external map…',url:r.url});try{await r.view.webContents.loadURL(r.url);r.win.webContents.send('maps:status',{kind:r.kind,status:'External map loaded. Data freshness and availability are supplied by the source.',url:r.url});}catch{r.win.webContents.send('maps:status',{kind:r.kind,status:r.kind==='godseye'?'God’s Eye server is unavailable. Start its local server, then Reload.':'Argos could not load. Check your network or open the source in your browser.',url:r.url});}}
 open(kind='argos'){
  if(this.store.get('settings.model.provider')==='ollama')throw Error('Online map feeds are disabled in local/private mode.');
  const current=this.windows.get(kind);if(current){current.win.show();current.win.moveTop();return;}
  const area=screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea,width=Math.min(1050,area.width),height=Math.min(750,area.height);
  const win=new BrowserWindow({width,height,minWidth:460,minHeight:350,frame:false,transparent:true,show:false,resizable:true,backgroundColor:'#00000000',type:'panel',webPreferences:{preload:path.join(__dirname,'preload.js'),contextIsolation:true,sandbox:true}});
  win.setAlwaysOnTop(true,'screen-saver',1);
  const isolated=session.fromPartition('relay-map-'+kind+'-'+Date.now());isolated.setPermissionRequestHandler((_w,_p,cb)=>cb(false));isolated.setPermissionCheckHandler(()=>false);isolated.on('will-download',event=>event.preventDefault());
  const view=new WebContentsView({webPreferences:{session:isolated,contextIsolation:true,sandbox:true,nodeIntegration:false,webSecurity:true}});
  const r={win,view,kind,url:mapAddress(kind,this.store.get('settings.godsEyeUrl'))};this.windows.set(kind,r);win.contentView.addChildView(view);
  view.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  const allow=url=>{try{return new URL(url).origin===new URL(r.url).origin;}catch{return false;}};
  for(const event of ['will-navigate','will-redirect'])view.webContents.on(event,(e,url)=>{if(!allow(url))e.preventDefault();});
  const resize=()=>{const [w,h]=win.getContentSize();view.setBounds({x:1,y:109,width:Math.max(1,w-2),height:Math.max(1,h-141)});};resize();win.on('resize',resize);
  win.loadFile(path.join(__dirname,'../renderer/maps.html'),{query:{kind}});win.once('ready-to-show',()=>{win.show();this.load(r).catch(()=>{});});
  win.on('closed',()=>{if(!view.webContents.isDestroyed())view.webContents.close();this.windows.delete(kind);});this.motion?.watchWindow(win,{key:'map-'+kind,close:()=>win.close(),undo:()=>this.open(kind)});
 }
 close(){for(const r of this.windows.values())r.win.close();}
}
module.exports={MapWindow,mapAddress,mapIntent};
