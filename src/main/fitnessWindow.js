const { BrowserWindow, screen, ipcMain } = require('electron');
const path=require('path');
const {FitnessStats}=require('./connectors/fitness');
class FitnessWindow {
  constructor({store,motion,getApi,openSettings,stats=new FitnessStats({store,getApi})}){
    Object.assign(this,{stats,motion,store});
    ipcMain.handle('fitness:action',async(e,action,value)=>{
      if(!this.win||e.sender!==this.win.webContents)return{error:'Open the Fitbit menu first.'};
      try{if(action==='goal'){const goal=require('./connectors/fitnessGoals').stepGoal(value?.goal);store.set('settings.fitnessStepGoal',goal);store.flush();return{ok:true,goal};}if(action==='refresh')return await stats.snapshot(value);if(action==='settings')openSettings();if(action==='close')this.win.close();return{ok:true};}catch(err){return{error:err.message};}
    });
  }
  syncPrivacy(){if(this.win && this.identity!==JSON.stringify([this.store.get('settings.model.provider'),this.store.get('settings.connectors.google')]))this.win.close();}
  open(){
    this.identity=JSON.stringify([this.store.get('settings.model.provider'),this.store.get('settings.connectors.google')]);
    if(this.win&&!this.win.isDestroyed()){this.win.show();this.win.moveTop();return;}
    const area=screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea,width=Math.min(820,area.width),height=Math.min(650,area.height);
    const win=this.win=new BrowserWindow({x:area.x+Math.round((area.width-width)/2),y:area.y+Math.round((area.height-height)/2),width,height,minWidth:380,minHeight:360,frame:false,transparent:true,backgroundColor:'#00000000',resizable:true,show:false,skipTaskbar:true,type:'panel',webPreferences:{preload:path.join(__dirname,'preload.js'),contextIsolation:true,sandbox:true}});
    win.setAlwaysOnTop(true,'screen-saver',1);win.setVisibleOnAllWorkspaces(true,{visibleOnFullScreen:true});win.setHiddenInMissionControl?.(true);
    win.webContents.setWindowOpenHandler(()=>({action:'deny'}));win.webContents.on('will-navigate',e=>e.preventDefault());
    win.loadFile(path.join(__dirname,'../renderer/fitness.html'));win.once('ready-to-show',()=>win.show());win.on('closed',()=>{this.stats.cancel();this.win=null;});
    this.motion?.watchWindow(win,{key:'fitness-stats',close:()=>win.close(),undo:()=>this.open()});
  }
  handTarget(p){const w=this.win;if(!w||w.isDestroyed()||!w.isVisible())return null;const b=w.getBounds();if(p.x<b.x||p.y<b.y||p.x>b.x+b.width||p.y>b.y+b.height)return null;return{key:'fitness-stats',position:()=>w.getBounds(),move:(x,y)=>w.setPosition(Math.round(x),Math.round(y)),close:()=>w.close(),undo:()=>this.open()};}
}
module.exports={FitnessWindow};
