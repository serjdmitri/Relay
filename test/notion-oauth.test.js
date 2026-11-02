const test=require('node:test'),assert=require('node:assert/strict');
const {connectNotion,NotionTokens,REDIRECT}=require('../src/main/connectors/notionOAuth');
const {NotionApi}=require('../src/main/connectors/notion');
const response=(data,status=200)=>({ok:status===200,status,json:async()=>data});
test('Notion browser sign-in uses registered loopback, random state and a private code exchange',async()=>{
 let exchanged;
 const r=await connectNotion({clientId:'fixture-id',clientSecret:'fixture-secret',openUrl:async raw=>{const u=new URL(raw);assert.equal(u.origin,'https://api.notion.com');assert.equal(u.searchParams.get('redirect_uri'),REDIRECT);assert.equal(raw.includes('fixture-secret'),false);await fetch(REDIRECT+'?'+new URLSearchParams({state:u.searchParams.get('state'),code:'fixture-code'}));},fetchImpl:async(url,options)=>{assert.equal(url,'https://api.notion.com/v1/oauth/token');exchanged=JSON.parse(options.body);return response({access_token:'access',refresh_token:'refresh',workspace_name:'Fixture'});}});
 assert.equal(r.workspace_name,'Fixture');assert.equal(exchanged.code,'fixture-code');assert.equal(exchanged.redirect_uri,REDIRECT);
});
test('Notion refresh rotates both encrypted tokens and is shared between concurrent callers',async()=>{
 const store={data:{tokenEnc:'enc:old',refreshEnc:'enc:r1',clientId:'id',clientSecretEnc:'enc:secret'},get(){return this.data;},set(_k,v){this.data=v;},flush(){}};let requests=0;
 const options={store,encrypt:s=>'enc:'+s,decrypt:s=>s.slice(4),fetchImpl:async()=>{requests++;await new Promise(r=>setTimeout(r,5));return response({access_token:'new',refresh_token:'r2'});}};
 const a=new NotionTokens(options),b=new NotionTokens(options);await Promise.all([a.refresh(),b.refresh()]);assert.equal(requests,1);assert.equal(store.data.tokenEnc,'enc:new');assert.equal(store.data.refreshEnc,'enc:r2');
 await assert.rejects(new NotionTokens({...options,privateMode:()=>true}).token(),/private/);
});
test('Notion retries one unauthorized request after refresh and never loops on denied access',async()=>{
 let calls=0,renewed=0;const api=new NotionApi({token:async()=>'fixture',refreshToken:async()=>renewed++,fetchImpl:async()=>{calls++;return response({},401);}});
 await assert.rejects(api.me(),/rejected/);assert.equal(renewed,1);assert.equal(calls,2);
});
