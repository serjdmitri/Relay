// Metadata scans run off Electron's main thread and can be stopped on slow drives.
const {Worker,isMainThread,parentPort,workerData}=require('worker_threads');
const fs=require('fs'),{scanFolder}=require('./files'),{hasSymlink}=require('./plan');
function scanAsync(root,{home,depth=3,signal,timeoutMs=15000}={}){
 if(signal?.aborted)return Promise.reject(signal.reason);
 return new Promise((resolve,reject)=>{
  const worker=new Worker(__filename,{workerData:{root,home,depth}});let settled=false;
  const finish=(error,result)=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',cancel);worker.terminate().catch(()=>{});error?reject(error):resolve(result);};
  const cancel=()=>finish(signal.reason);const timer=setTimeout(()=>finish(Error('Folder scan timed out. Choose a smaller folder or reconnect the drive.')),timeoutMs);
  signal?.addEventListener('abort',cancel,{once:true});if(signal?.aborted)cancel();
  worker.on('message',r=>r.error?finish(Error(r.error)):finish(null,r));worker.on('error',e=>finish(e));worker.on('exit',code=>{if(!settled)finish(Error('Folder scan stopped before completion ('+code+').'));});
 });
}
if(!isMainThread){try{if(hasSymlink(workerData.root,fs,workerData.home))throw Error('Folder path contains a symbolic link.');parentPort.postMessage(scanFolder(workerData.root,{fs,home:workerData.home,depth:workerData.depth,maxEntries:5000,maxMs:12000}));}catch(e){parentPort.postMessage({error:e.message});}}
module.exports={scanAsync};
