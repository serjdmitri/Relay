/* global h, esc, relay */
let googleConnecting=false,googleServices=['gmail','calendar','drive','sheets'];
const googleChecks=new Map();
const GOOGLE_SERVICES={gmail:['Gmail','Read email; draft and send with approval'],calendar:['Google Calendar','Read events; create with approval'],drive:['Google Drive','Search and read files; no file editing'],sheets:['Google Sheets','Read cells; append rows with approval']};
function renderGoogleConnections(c,g){
 c.append(h('<div class="section-title">Google connections</div>'));
 const box=h('<div class="card" style="padding:16px"><div class="ttl">Choose what Jarvis can use</div><p class="d" style="margin:8px 0">Click Connect, sign in in your browser, and choose the permissions you allow. Google data retrieved for a request may be sent to your selected AI provider.</p><div data-services></div><div style="display:flex;gap:8px;align-items:center;margin:12px 0"><button class="btn primary" data-connect>Connect with Google</button><button class="btn" data-cancel>Cancel sign-in</button></div><div class="note" data-google-status role="status"></div><div data-accounts></div><details data-setup><summary>App credentials · one-time setup</summary><p class="d" style="margin:8px 0">Create a Desktop app OAuth client in Google Cloud and enable the APIs you select. Import its downloaded JSON file, or enter its client ID and secret below. Credentials stay encrypted on this Mac. Testing-mode apps can require reconnecting after seven days; managed accounts may need administrator approval.</p><button class="btn" data-import>Import Google credentials JSON</button><div class="field-row" style="margin-top:10px"><input class="field" data-id aria-label="Google OAuth client ID" placeholder="Client ID"><input class="field" data-secret type="password" autocomplete="off" aria-label="Google OAuth client secret" placeholder="Client secret"><button class="btn" data-save>Save app credentials</button></div></details></div>');
 const q=s=>box.querySelector(s),status=text=>{const el=document.querySelector('[data-google-status]')||q('[data-google-status]');if(el)el.textContent=text;};
 q('[data-id]').value=g.clientId||'';q('[data-secret]').placeholder=g.hasSecret?'Secret saved; paste only to replace':'Client secret';q('[data-setup]').open=!(g.clientId&&g.hasSecret);
 for(const [id,[name,access]]of Object.entries(GOOGLE_SERVICES)){
  const row=h(`<label class="row" style="padding:8px 0"><input type="checkbox" ${googleServices.includes(id)?'checked':''}><span class="grow"><span class="t">${name}</span><span class="d">${access}</span></span></label>`);
  row.querySelector('input').onchange=e=>{googleServices=e.target.checked?[...googleServices,id]:googleServices.filter(s=>s!==id);};q('[data-services]').append(row);
 }
 const busy=on=>{googleConnecting=on;for(const el of [box,document]){const b=el.querySelector('[data-connect]'),cancel=el.querySelector('[data-cancel]');if(b)b.disabled=on||!g.clientId||!g.hasSecret;if(cancel)cancel.hidden=!on;}};busy(googleConnecting);
 const connect=async email=>{
  if(!googleServices.length){status('Choose at least one service.');return;}
  busy(true);status('Continue in your browser. Jarvis will show the result here when sign-in finishes.');
  try{const r=await relay.connectGoogle({services:googleServices,email});status(r.ok?`Connected ${r.email}. ${r.services===null?'Permissions not reported; use Check connection.':'Authorized: '+r.services.map(s=>GOOGLE_SERVICES[s][0]).join(', ')+'.'}`:r.error||'Sign-in cancelled.');}catch{status('Sign-in could not finish. Retry or check app credentials.');}finally{busy(false);}
 };
 q('[data-connect]').onclick=()=>connect();q('[data-cancel]').onclick=()=>relay.googleConnection('cancel');
 q('[data-import]').onclick=async()=>{try{const r=await relay.googleConnection('import');if(!r.ok&&!r.cancelled)status(r.error);else if(r.ok)status('App credentials imported. Click Connect with Google.');}catch{status('Could not import credentials.');}};
 q('[data-save]').onclick=async()=>{try{const r=await relay.setGoogleClient(q('[data-id]').value,q('[data-secret]').value);if(r?.ok){q('[data-secret]').value='';status('App credentials saved. Click Connect with Google.');}else status(r?.error||'Credential change cancelled.');}catch{status('Could not save credentials. Check macOS secure storage.');}};
 for(const account of g.connections||g.accounts.map(email=>({email,services:null}))){
  const row=h(`<div class="card" style="padding:12px;margin:10px 0"><div class="ttl">${esc(account.email)}</div><div class="d">${account.services===null?'Saved account; permissions need checking':esc(account.services.map(s=>GOOGLE_SERVICES[s][0]).join(', ')||'No supported service permissions reported')}</div><div style="display:flex;gap:8px;margin-top:8px"><button class="btn" data-check>Check connection</button><button class="btn" data-reconnect>Reconnect</button><button class="btn" data-remove>Disconnect</button></div><div class="d" data-result role="status" style="white-space:pre-wrap;margin-top:8px"></div></div>`);
  const result=row.querySelector('[data-result]');result.textContent=googleChecks.get(account.email)||'';
  row.querySelector('[data-check]').onclick=async e=>{e.target.disabled=true;result.textContent='Checking service access…';try{const r=await relay.googleConnection('check',account.email);const text=r.ok?r.checks.map(x=>`${GOOGLE_SERVICES[x.service][0]}: ${x.status}`).join('\n'):r.error;googleChecks.set(account.email,text);result.textContent=text;}catch{result.textContent='Check failed. Reconnect if access expired.';}finally{e.target.disabled=false;}};
  row.querySelector('[data-reconnect]').onclick=()=>connect(account.email);
  row.querySelector('[data-remove]').onclick=async()=>{if(!confirm(`Disconnect ${account.email} from Relay?`))return;const r=await relay.removeGoogle(account.email);googleChecks.delete(account.email);if(r?.warning)status(r.warning);};
  q('[data-accounts]').append(row);
 }
 c.append(box);
}
