const path=require('path');
const {fileURLToPath}=require('url');
const safeKey=key=>typeof key==='string' && key.length<160 && key.split('.').every(k=>k && !['__proto__','prototype','constructor'].includes(k));
function localFrame(event,root){try{if(!event.senderFrame || event.senderFrame!==event.sender?.mainFrame) return false;const url=new URL(event.senderFrame.url);if(url.protocol!=='file:')return false;const relative=path.relative(root,fileURLToPath(url));return !!relative && !relative.startsWith('..') && !path.isAbsolute(relative) && relative.endsWith('.html');}catch{return false;}}
function protectIpc(ipc,root){const handle=ipc.handle.bind(ipc);ipc.handle=(channel,fn)=>handle(channel,(event,...args)=>{if(!localFrame(event,root))throw Error('Untrusted Relay frame.');return fn(event,...args);});}
function protectNavigation(app){app.on('web-contents-created',(_event,contents)=>{if(!contents.getLastWebPreferences().preload)return;contents.setWindowOpenHandler(()=>({action:'deny'}));contents.on('will-navigate',event=>event.preventDefault());contents.on('will-attach-webview',event=>event.preventDefault());});}
module.exports={safeKey,localFrame,protectIpc,protectNavigation};
