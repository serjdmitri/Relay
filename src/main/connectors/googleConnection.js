const fs=require('fs');
const {connectAccount}=require('./google');
const {desktopCredentials,grantedServices,scopesFor}=require('./googleSetup');
const easy=require('./googleEasy');
const path=require('path');
function publicGoogle(g={}){return{clientId:g.clientId||'',accounts:(g.accounts||[]).map(a=>a.email),connections:(g.accounts||[]).map(a=>({email:a.email,services:Array.isArray(a.scopes)?grantedServices(a.scopes):null}))};}
function registerGoogleConnections({ipcMain,store,encryptKey,decryptKey,dialog,shell,getWindow,onChange,getApi,resetApi,macCalendars=null,downloadsDir=path.join(require('os').homedir(),'Downloads'),fsImpl=fs,setTimer=setInterval,clearTimer=clearInterval}){
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
 const connectNow=async(options={})=>{
  if(local())return{ok:false,error:'Google sign-in is disabled in local/private mode.'};
  if(pending)return{ok:false,error:'A Google sign-in is already open. Finish or cancel it first.'};
  const g=config(),secret=decryptKey(g.clientSecretEnc);if(!g.clientId||!secret)return{ok:false,error:'Import or save the Google Desktop app credentials first.'};
  let services;try{services=Object.keys(require('./googleSetup').SERVICES).filter(s=>(options.services||require('./googleSetup').DEFAULT_SERVICES).includes(s));scopesFor(services);}catch{return{ok:false,error:'Choose at least one Google service.'};}
  const ac=pending=new AbortController();
  try{
   const r=await connectAccount({clientId:g.clientId,clientSecret:secret,services,email:typeof options.email==='string'?options.email:undefined,signal:ac.signal,openUrl:u=>shell.openExternal(u)});
   if(ac.signal.aborted||local()||config().clientId!==g.clientId)return{ok:false,error:'Sign-in cancelled; no account was saved.'};
   const encrypted=encryptKey(r.refreshToken),rest=(config().accounts||[]).filter(a=>a.email.toLowerCase()!==r.email.toLowerCase());
   store.set('settings.connectors.google.accounts',[...rest,{email:r.email,refreshEnc:encrypted,...(r.scopes?{scopes:r.scopes}:{})}]);store.flush();resetApi();onChange();return{ok:true,email:r.email,services:r.scopes?grantedServices(r.scopes):null};
  }catch(e){return{ok:false,error:ac.signal.aborted?'Sign-in cancelled.':e.message};}finally{if(pending===ac)pending=null;}
 };
 handle('connect',connectNow);
 // Calendar through macOS: is a Google calendar already on this Mac (added in Internet Accounts)? Then Relay needs no setup for it.
 handle('mac',async()=>{
  if(!macCalendars)return{ok:true,known:false,google:[]};
  try{const list=await macCalendars();return{ok:true,known:Array.isArray(list),google:easy.googleCalendars(list).map(c=>({account:c.account,name:c.name,writable:c.writable}))};}
  catch{return{ok:false,error:'Allow Calendars for Relay in System Settings > Privacy & Security > Calendars to see this.'};}
 });
 // Guided setup: the pages in order (opened one at a time from the window), and a watch on Downloads for the credentials file Google makes at the end.
 // When it appears Relay saves it and starts the sign-in by itself. The watch ends by itself after twenty minutes.
 let watch=null,guideMessage='';
 const stopWatch=()=>{if(watch){clearTimer(watch.timer);watch=null;}};
 const startWatch=()=>{
  stopWatch();guideMessage='Waiting for the credentials file to appear in Downloads…';const started=Date.now(),seen=new Set();let busy=false;
  const timer=setTimer(async()=>{
   if(busy)return;
   if(Date.now()-started>20*60000){stopWatch();guideMessage='Stopped watching Downloads. Click Guided setup to start again.';onChange();return;}
   busy=true;
   try{
    const entries=[];for(const name of fsImpl.readdirSync(downloadsDir)){if(!/^client_secret.*\.json$/i.test(name))continue;try{const st=fsImpl.statSync(path.join(downloadsDir,name));entries.push({name,size:st.size,mtimeMs:st.mtimeMs});}catch{}}
    const hit=easy.findCredentialFile(entries);
    if(!hit||seen.has(hit.name+hit.mtimeMs))return;
    seen.add(hit.name+hit.mtimeMs);
    let c;try{c=desktopCredentials(fsImpl.readFileSync(path.join(downloadsDir,hit.name),'utf8'));}catch(e){guideMessage='Found '+hit.name+' but it is not a Desktop app credentials file: '+e.message;onChange();return;}
    stopWatch();guideMessage='Found your credentials. Saving them…';onChange();
    const saved=await saveClient(c.clientId,c.clientSecret);
    if(saved&&saved.ok===false){guideMessage=saved.error||'Could not save the credentials.';onChange();return;}
    guideMessage='Credentials saved. Finish signing in in your browser…';onChange();
    const r=await connectNow({});
    guideMessage=r.ok?'Connected '+r.email+'. You can delete the downloaded credentials file now.':(r.error||'Sign-in did not finish. Click Connect with Google.');onChange();
   }catch(e){guideMessage='Could not read Downloads: '+e.message;}
   finally{busy=false;}
  },2500);
  watch={timer};
 };
 handle('internet-accounts',()=>{shell.openExternal('x-apple.systempreferences:com.apple.Internet-Accounts-Settings.extension');return{ok:true};});
 handle('guide',()=>{startWatch();return{ok:true,steps:easy.STEPS.map(x=>({title:x.title,text:x.text}))};});
 handle('guide-open',i=>{const step=easy.STEPS[Number(i)];if(!step)return{ok:false};shell.openExternal(step.url);return{ok:true};});
 handle('guide-status',()=>({ok:true,watching:!!watch,message:guideMessage}));
 handle('guide-stop',()=>{stopWatch();guideMessage='';return{ok:true};});
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
  checks.push({service:'docs',status:granted?.includes('docs')?'authorized; a specific document has not been tested':'permission not verified'});
  if(granted?.includes('fitness'))checks.push({service:'fitness',status:'authorized; use the Fitbit menu to verify synced readings'});
  checks.push({service:'sheets',status:granted?.includes('sheets')?'authorized; a specific spreadsheet has not been tested':'permission not verified'});return{ok:true,checks};
 });
 handle('remove',async email=>{
  cancel();const list=config().accounts||[],hit=list.find(a=>a.email===email);store.set('settings.connectors.google.accounts',list.filter(a=>a.email!==email));store.flush();resetApi();onChange();
  if(hit){try{await fetch('https://oauth2.googleapis.com/revoke',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({token:decryptKey(hit.refreshEnc)}),signal:AbortSignal.timeout(10000),redirect:'error'});}catch{ return{ok:true,warning:'Removed locally. Revoke access in your Google account if it remains listed there.'};}}
  return{ok:true};
 });
 return{cancel,startGuide:()=>{startWatch();return easy.STEPS;},openStep:i=>{const step=easy.STEPS[Number(i)];if(step)shell.openExternal(step.url);}};
}
module.exports={registerGoogleConnections,publicGoogle};
