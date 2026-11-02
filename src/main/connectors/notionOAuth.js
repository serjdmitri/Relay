const {authorize}=require('./oauthLoopback');
const refreshing=new WeakMap();
const REDIRECT='http://127.0.0.1:18790/notion/cb';
async function exchange({clientId,clientSecret,body,fetchImpl=fetch}){
 let res;try{res=await fetchImpl('https://api.notion.com/v1/oauth/token',{method:'POST',headers:{authorization:'Basic '+Buffer.from(clientId+':'+clientSecret).toString('base64'),'content-type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(15000),redirect:'error'});}catch{throw Error('Could not reach Notion sign-in. Try again.');}
 const data=await res.json().catch(()=>({}));if(!res.ok||!data.access_token||!data.refresh_token)throw Error('Notion did not grant reusable access. Check the public app credentials and reconnect.');return data;
}
async function connectNotion({clientId,clientSecret,openUrl,signal,fetchImpl=fetch,timeoutMs=180000}){
 const {code,redirectUri}=await authorize({openUrl,signal,timeoutMs,port:18790,path:'/notion/cb',buildUrl:({state,redirectUri})=>'https://api.notion.com/v1/oauth/authorize?'+new URLSearchParams({owner:'user',client_id:clientId,redirect_uri:redirectUri,response_type:'code',state})});
 const data=await exchange({clientId,clientSecret,fetchImpl,body:{grant_type:'authorization_code',code,redirect_uri:redirectUri}});if(signal?.aborted)throw Error('Sign-in cancelled.');return data;
}
class NotionTokens{
 constructor({store,encrypt,decrypt,fetchImpl=fetch,privateMode=()=>false,now=Date.now}){Object.assign(this,{store,encrypt,decrypt,fetchImpl,privateMode,now});}
 config(){return this.store.get('settings.connectors.notion')||{};}
 async token(){if(this.privateMode())throw Error('Notion access is disabled in local/private mode.');const c=this.config();if(c.refreshEnc&&c.expiresAt&&c.expiresAt<=this.now()+60000)return this.refresh();return this.decrypt(c.tokenEnc);}
 async refresh(){
  if(this.privateMode())throw Error('Notion access is disabled in local/private mode.');if(refreshing.has(this.store))return refreshing.get(this.store);
  const c=this.config();if(!c.refreshEnc||!c.clientId||!c.clientSecretEnc)throw Error('Reconnect Notion to renew access.');
  this.pending=(async()=>{const data=await exchange({clientId:c.clientId,clientSecret:this.decrypt(c.clientSecretEnc),fetchImpl:this.fetchImpl,body:{grant_type:'refresh_token',refresh_token:this.decrypt(c.refreshEnc)}});
   if(this.privateMode()||this.config().refreshEnc!==c.refreshEnc)throw Error('Notion connection changed; sign in again.');
   const tokenEnc=this.encrypt(data.access_token),refreshEnc=this.encrypt(data.refresh_token);
   this.store.set('settings.connectors.notion',{...this.config(),tokenEnc,refreshEnc,expiresAt:Number.isFinite(data.expires_in)?this.now()+data.expires_in*1000:null});this.store.flush();return data.access_token;
  })();refreshing.set(this.store,this.pending);try{return await this.pending;}finally{if(refreshing.get(this.store)===this.pending)refreshing.delete(this.store);this.pending=null;}
 }
}
function registerNotionConnection({ipcMain,store,encryptKey,decryptKey,dialog,shell,getWindow,onChange,privateMode}){
 let pending;const config=()=>store.get('settings.connectors.notion')||{};
 const handle=(name,fn)=>ipcMain.handle('connectors:notion:'+name,async(e,...args)=>{if(e.sender!==getWindow()?.webContents)return{ok:false,error:'Open Connections on this Mac.'};try{return await fn(...args);}catch(e){return{ok:false,error:e.message};}});
 const save=next=>{store.set('settings.connectors.notion',next);store.flush();onChange();};
 handle('client',async({clientId,secret}={})=>{const id=String(clientId||'').trim();if(!id||id.length>500||String(secret||'').length>4000)return{ok:false,error:'Enter a Notion public app client ID and secret.'};const old=config(),encrypted=String(secret||'').trim()?encryptKey(secret.trim()):null;if(!encrypted&&!old.clientSecretEnc)return{ok:false,error:'Enter the public app secret.'};
  if(old.clientId&&old.clientId!==id&&old.tokenEnc){const r=await dialog.showMessageBox(getWindow(),{type:'warning',message:'Replace the Notion app?',detail:'The current local Notion connection will be disconnected.',buttons:['Replace app','Cancel'],defaultId:1,cancelId:1});if(r.response!==0)return{ok:false,cancelled:true};}
  pending?.abort();save({...old,clientId:id,clientSecretEnc:encrypted||old.clientSecretEnc,...(old.clientId!==id?{tokenEnc:'',refreshEnc:'',name:'',expiresAt:null}:{})});return{ok:true};
 });
 handle('connect',async()=>{if(privateMode())return{ok:false,error:'Notion sign-in is disabled in local/private mode.'};if(pending)return{ok:false,error:'Finish or cancel the current Notion sign-in.'};const c=config();if(!c.clientId||!c.clientSecretEnc)return{ok:false,error:'Save the Notion public app credentials first.'};const ac=pending=new AbortController();try{const data=await connectNotion({clientId:c.clientId,clientSecret:decryptKey(c.clientSecretEnc),signal:ac.signal,openUrl:u=>shell.openExternal(u)});if(ac.signal.aborted||privateMode()||config().clientId!==c.clientId)return{ok:false,error:'Sign-in cancelled; nothing saved.'};
  const tokenEnc=encryptKey(data.access_token),refreshEnc=encryptKey(data.refresh_token);save({...c,tokenEnc,refreshEnc,name:String(data.workspace_name||'Notion').slice(0,120),expiresAt:Number.isFinite(data.expires_in)?Date.now()+data.expires_in*1000:null});return{ok:true};
 }finally{if(pending===ac)pending=null;}});
 handle('cancel',()=>{pending?.abort();return{ok:true};});
 handle('clear',()=>{pending?.abort();save({...config(),tokenEnc:'',refreshEnc:'',name:'',expiresAt:null});return{ok:true};});
 handle('set',async token=>{if(privateMode())return{ok:false,error:'Notion access is disabled in local/private mode.'};const text=String(token||'').trim();if(!text||text.length>4000)return{ok:false,error:'Enter a Notion integration token.'};const {NotionApi}=require('./notion'),me=await new NotionApi({token:text}).me();const tokenEnc=encryptKey(text);pending?.abort();save({...config(),tokenEnc,name:me.name,refreshEnc:'',expiresAt:null});return{ok:true};});
 handle('check',async()=>{const {NotionApi}=require('./notion'),tokens=new NotionTokens({store,encrypt:encryptKey,decrypt:decryptKey,privateMode});await new NotionApi({token:()=>tokens.token(),refreshToken:()=>tokens.refresh()}).me();return{ok:true,message:'Notion account access works. Only pages shared with this connection are accessible; no page was edited.'};});
 return{cancel:()=>pending?.abort()};
}
module.exports={REDIRECT,connectNotion,NotionTokens,registerNotionConnection};
