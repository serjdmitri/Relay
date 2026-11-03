// This remote view receives no Relay APIs, credentials, filesystem or microphone access.
const {contextBridge,ipcRenderer}=require('electron');
contextBridge.executeInMainWorld({func:()=>{
 const original=HTMLCanvasElement.prototype.getContext;
 HTMLCanvasElement.prototype.getContext=function(type,options){return original.call(this,type,/^webgl2?$/.test(type)?{...options,alpha:true}:options);};
}});
window.addEventListener('message',event=>{
 if(event.source!==window || event.data?.type!=='relay-world-layout')return;
 const {action,orbit,fill,rects,globe,dragging}=event.data;
 if(['close','settings'].includes(action))ipcRenderer.send('maps:chrome',{action});
 else if(action==='layout' && typeof orbit==='boolean' && Number.isFinite(fill))
  ipcRenderer.send('maps:chrome',{action,orbit,fill,rects:Array.isArray(rects)?rects.slice(0,40):[],globe,dragging:dragging===true});
});
