const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http');
const {authorize}=require('../src/main/connectors/oauthLoopback');
const {desktopCredentials,scopesFor,grantedServices}=require('../src/main/connectors/googleSetup');
const {publicGoogle,registerGoogleConnections}=require('../src/main/connectors/googleConnection');
const visit=url=>new Promise((ok,no)=>http.get(url,r=>{r.resume();r.on('end',()=>ok(r.statusCode));}).on('error',no));
test('OAuth callback rejects unrelated requests without cancelling the real browser session',async()=>{
 const r=await authorize({timeoutMs:500,buildUrl:({state,redirectUri})=>redirectUri+'?state='+state,openUrl:async raw=>{const u=new URL(raw);assert.equal(await visit(u.origin+'/favicon.ico'),404);assert.equal(await visit(u.origin+u.pathname+'?state=wrong&code=bad'),400);assert.equal(await visit(raw+'&code=valid'),200);}});assert.equal(r.code,'valid');
});
test('OAuth cancellation and denied consent finish promptly and never return a code',async()=>{
 const ac=new AbortController();await assert.rejects(authorize({signal:ac.signal,buildUrl:()=>'',openUrl:async()=>ac.abort()}),/cancelled/);
 await assert.rejects(authorize({buildUrl:({state,redirectUri})=>redirectUri+'?state='+state,openUrl:u=>visit(u+'&error=access_denied')}),/declined/);
 await assert.rejects(authorize({signal:AbortSignal.abort(),buildUrl:()=>'',openUrl:()=>assert.fail()}),/cancelled/);
});
test('Google app import accepts only desktop credentials and never includes secrets in errors/public state',()=>{
 assert.deepEqual(desktopCredentials(JSON.stringify({installed:{client_id:'fixture.apps.googleusercontent.com',client_secret:'fixture-secret'}})),{clientId:'fixture.apps.googleusercontent.com',clientSecret:'fixture-secret'});
 for(const raw of ['bad',JSON.stringify({web:{client_id:'fixture',client_secret:'fixture-secret'}})])assert.throws(()=>desktopCredentials(raw),e=>!e.message.includes('fixture-secret'));
 const state=publicGoogle({clientId:'id',clientSecretEnc:'secret',accounts:[{email:'test@example.com',refreshEnc:'refresh',scopes:scopesFor(['gmail'])}]});assert.deepEqual(state.connections[0].services,['gmail']);assert.equal(JSON.stringify(state).includes('secret'),false);assert.equal(JSON.stringify(state).includes('refresh'),false);
});
test('Google service permissions match the selected functionality without claiming unsupported Drive editing',()=>{
 assert.deepEqual(grantedServices(scopesFor(['calendar','sheets'])),['calendar','sheets']);assert.equal(scopesFor(['drive']).some(s=>s.endsWith('/drive')),false);assert.throws(()=>scopesFor([]));assert.throws(()=>scopesFor(['unknown']));
});
test('connection controls reject another window before reading credentials or starting OAuth',async()=>{
 const handlers={},window={webContents:{}};registerGoogleConnections({ipcMain:{handle:(n,f)=>handlers[n]=f},getWindow:()=>window,store:{get:()=>assert.fail('Credentials must not be read')}});
 assert.equal((await handlers['connectors:google:connect']({sender:{}},{})).ok,false);
});
