const fs=require('fs'),path=require('path');
// One app-owned, rasterized image. Never load a user-supplied URL or HTML.
function registerBackdrop({ipcMain,dialog,nativeImage,dir,getWindow,onChange}){
 const file=path.join(dir,'assistant-background.png');let image='';
 try{if(fs.statSync(file).size<=12*1024*1024)image=nativeImage.createFromPath(file).toDataURL();}catch{}
 ipcMain.handle('assistant:background',async(e,action)=>{
  if(!getWindow()||e.sender!==getWindow().webContents)return{error:'Open Settings first.'};
  try{
   if(action==='choose'){
    const r=await dialog.showOpenDialog(getWindow(),{title:'Choose a JARVIS background',properties:['openFile'],filters:[{name:'Images',extensions:['png','jpg','jpeg','webp']}]});if(r.canceled||!r.filePaths[0])return{cancelled:true};
    const f=r.filePaths[0];if(fs.statSync(f).size>12*1024*1024)throw Error('Choose an image smaller than 12 MB.');
    const img=await nativeImage.createThumbnailFromPath(f,{width:2560,height:1600});if(img.isEmpty())throw Error('That image could not be decoded.');
    fs.mkdirSync(dir,{recursive:true});const tmp=file+'.tmp';fs.writeFileSync(tmp,img.toPNG(),{mode:0o600});fs.renameSync(tmp,file);image=img.toDataURL();
   }else if(action==='remove'){fs.rmSync(file,{force:true});image='';}else return{configured:!!image};
   onChange();return{ok:true,configured:!!image};
  }catch(e){return{error:e.message||'Could not change the background.'};}
 });return{get image(){return image;}};
}
module.exports={registerBackdrop};
