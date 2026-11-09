// Shared defaults for Jarvis utility menus. Keep geometry/content in each feature.
const path=require('path');
function createFloatingWindow(BrowserWindow,bounds){
 const win=new BrowserWindow({...bounds,frame:false,transparent:true,backgroundColor:'#00000000',resizable:true,show:false,skipTaskbar:true,type:'panel',webPreferences:{preload:path.join(__dirname,'preload.js'),contextIsolation:true,sandbox:true,nodeIntegration:false}});
 win.setAlwaysOnTop(true,'screen-saver',1);win.setVisibleOnAllWorkspaces(true,{visibleOnFullScreen:true});win.setHiddenInMissionControl?.(true);
 win.webContents.setWindowOpenHandler(()=>({action:'deny'}));win.webContents.on('will-navigate',event=>event.preventDefault());
 return win;
}
module.exports={createFloatingWindow};
