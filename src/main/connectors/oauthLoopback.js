// Browser sign-in returns only to this Mac. Codes and state never reach the renderer.
const http=require('http'),crypto=require('crypto');
async function authorize({buildUrl,openUrl,port=0,path='/cb',signal,timeoutMs=180000}){
 if(signal?.aborted)throw Error('Sign-in cancelled.');
 const state=crypto.randomBytes(32).toString('base64url');let resolve,reject;
 const result=new Promise((ok,no)=>{resolve=ok;reject=no;});result.catch(()=>{});
 const server=http.createServer((req,res)=>{
  const u=new URL(req.url,'http://127.0.0.1');
  if(req.method!=='GET'||u.pathname!==path||req.headers.host!==`127.0.0.1:${server.address()?.port}`){res.writeHead(404);return res.end();}
  if(u.searchParams.get('state')!==state){res.writeHead(400);return res.end('The sign-in answer did not match. Return to the original sign-in tab.');}
  const code=u.searchParams.get('code');const denied=u.searchParams.has('error');
  res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store','content-security-policy':"default-src 'none'; style-src 'unsafe-inline'",'referrer-policy':'no-referrer'});
  res.end('<!doctype html><title>Relay sign-in</title><p>Return to Relay to see whether sign-in finished. You can close this tab.</p>');
  if(denied||!code||code.length>8192)reject(Error('Sign-in was declined or did not return a valid code.'));else resolve(code);
 });
 const cancel=()=>reject(Error('Sign-in cancelled.'));let timer;
 try{
  await new Promise((ok,no)=>{server.once('error',()=>no(Error('Could not open the local sign-in callback. Close other sign-in attempts and retry.')));server.listen(port,'127.0.0.1',ok);});
  signal?.addEventListener('abort',cancel,{once:true});if(signal?.aborted)cancel();
  timer=setTimeout(()=>reject(Error('Sign-in timed out. Try again.')),timeoutMs);
  const redirectUri=`http://127.0.0.1:${server.address().port}${path}`;
  await openUrl(buildUrl({state,redirectUri}));return{code:await result,redirectUri};
 }finally{clearTimeout(timer);signal?.removeEventListener('abort',cancel);server.close();server.closeAllConnections?.();}
}
module.exports={authorize};
