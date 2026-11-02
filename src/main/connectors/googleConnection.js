const fs=require('fs');
const {connectAccount}=require('./google');
const {desktopCredentials,grantedServices,scopesFor}=require('./googleSetup');
function publicGoogle(g={}){return{clientId:g.clientId||'',accounts:(g.accounts||[]).map(a=>a.email),connections:(g.accounts||[]).map(a=>({email:a.email,services:Array.isArray(a.scopes)?grantedServices(a.scopes):null}))};}
function registerGoogleConnections({ipcMain,store,encryptKey,decryptKey,dialog,shell,getWindow,onChange,getApi,resetApi}){
 let pending=null;
 const config=()=>store.get('settings.connectors.google')||{};
 const local=()=>store.get('settings.model.provider')==='ollama';
 const cancel=()=>{pending?.abort();};
 const handle=(name,fn)=>ipcMain.handle('connectors:google:'+name,async(e,...args)=>{if(!getWindow()||e.sender!==getWindow().webContents)return{ok:false,error:'Open Connections on this Mac to sign in.'};try{return await fn(...args);}catch{return{ok:false,error:'The connection request could not finish. Check credentials, permissions and network access, then retry.'};}});
 const saveClient=async(clientId,secret)=>{
  const id=String(clientId||'').trim();if(!id||id.length>500)throw Error('Invalid client ID.');
  const encrypted=String(secret||'').trim()?encryptKey(String(secret).trim()):null;
  const old=config();if(id!==old.clientId&&old.accounts?.length){const r=await dialog.showMessageBox(getWindow(),{type:'warning',buttons:['Replace app and reconnect accounts','Cancel'],defaultId:1,cancelId:1,message:'Replace the Google app credentials?',detail:'Existing Google accounts must reconnect to the new app. Their local connections will be removed.'});if(r.response!==0)return{ok:false,cancelled:true};}
  cancel();if(id!==old.clientId)store.set('settings.connectors.google.accounts',[]);
  store.set('settings.connectors.google.clientId',id);if(encrypted)store.set('settings.connectors.google.clientSecretEnc',encrypted);else if(id!==old.clientId)store.set('settings.connectors.google.clientSecretEnc','');
  store.flush();resetApi();onChange();return{ok:true};
 };
 handle('client',saveClient);
 handle('import',async()=>{
  const r=await dialog.showOpenDialog(getWindow(),{title:'Choose Google Desktop OAuth credentials',properties:['openFile'],filters:[{name:'Google OAuth client',extensions:['json']}]});if(r.canceled||!r.filePaths[0])return{ok:false,cancelled:true};
  const file=r.filePaths[0],stat=fs.statSync(file);if(!stat.isFile()||stat.size>65536)return{ok:false,error:'Choose a Google Desktop OAuth JSON file smaller than 64 KB.'};
  let c;try{c=desktopCredentials(fs.readFileSync(file,'utf8'));}catch(e){return{ok:false,error:e.message};}return saveClient(c.clientId,c.clientSecret);
 });
 handle('cancel',()=>{cancel();return{ok:true};});
 handle('connect',async(options={})=>{
  if(local())return{ok:false,error:'Google sign-in is disabled in local/private mode.'};
  if(pending)return{ok:false,error:'A Google sign-in is already open. Finish or cancel it first.'};
  const g=config(),secret=decryptKey(g.clientSecretEnc);if(!g.clientId||!secret)return{ok:false,error:'Import or save the Google Desktop app credentials first.'};
  let services;try{services=Object.keys(require('./googleSetup').SERVICES).filter(s=>(options.services||Object.keys(require('./googleSetup').SERVICES)).includes(s));scopesFor(services);}catch{return{ok:false,error:'Choose at least one Google service.'};}
  const ac=pending=new AbortController();
  try{
   const r=await connectAccount({clientId:g.clientId,clientSecret:secret,services,email:typeof options.email==='string'?options.email:undefined,signal:ac.signal,openUrl:u=>shell.openExternal(u)});
   if(ac.signal.aborted||local()||config().clientId!==g.clientId)return{ok:false,error:'Sign-in cancelled; no account was saved.'};
   const encrypted=encryptKey(r.refreshToken),rest=(config().accounts||[]).filter(a=>a.email.toLowerCase()!==r.email.toLowerCase());
   store.set('settings.connectors.google.accounts',[...rest,{email:r.email,refreshEnc:encrypted,...(r.scopes?{scopes:r.scopes}:{})}]);store.flush();resetApi();onChange();return{ok:true,email:r.email,services:r.scopes?grantedServices(r.scopes):null};
  }catch(e){return{ok:false,error:ac.signal.aborted?'Sign-in cancelled.':e.message};}finally{if(pending===ac)pending=null;}
 });
 handle('check',async email=>{
  if(local())return{ok:false,error:'Google checks are disabled in local/private mode.'};
  const g=config(),acct=(g.accounts||[]).find(a=>a.email===email);if(!acct)return{ok:false,error:'This account is no longer connected.'};
  const api=getApi(),account=api?.one(email);if(!api||!account)return{ok:false,error:'Reconnect this account.'};
  const granted=Array.isArray(acct.scopes)?grantedServices(acct.scopes):null;
  const endpoints={gmail:'https://gmail.googleapis.com/gmail/v1/users/me/profile',calendar:'https://www.googleapis.com/calendar/v3/calendars/primary/events?maxResults=1&fields=kind',drive:'https://www.googleapis.com/drive/v3/files?pageSize=1&fields=kind'};
  const checks=await Promise.all(Object.entries(endpoints).map(async([service,url])=>{
   if(granted&&!granted.includes(service))return{service,status:'not authorized'};
   try{await api.call(account,'GET',url);return{service,status:'working'};}catch{return{service,status:'unavailable; reconnect or enable the API in Google Cloud'};}
  }));
  checks.push({service:'sheets',status:granted?.includes('sheets')?'authorized; a specific spreadsheet has not been tested':'permission not verified'});return{ok:true,checks};
 });
 handle('remove',async email=>{
  cancel();const list=config().accounts||[],hit=list.find(a=>a.email===email);store.set('settings.connectors.google.accounts',list.filter(a=>a.email!==email));store.flush();resetApi();onChange();
  if(hit){try{await fetch('https://oauth2.googleapis.com/revoke',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({token:decryptKey(hit.refreshEnc)}),signal:AbortSignal.timeout(10000),redirect:'error'});}catch{ return{ok:true,warning:'Removed locally. Revoke access in your Google account if it remains listed there.'};}}
  return{ok:true};
 });
 return{cancel};
}
module.exports={registerGoogleConnections,publicGoogle};
