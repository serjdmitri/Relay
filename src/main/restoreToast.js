const { BrowserWindow, screen, ipcMain } = require('electron');
const path = require('path');
class RestoreToast {
  constructor(preload, { setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
    Object.assign(this, { preload, setTimer, clearTimer }); this.token = 0;
    ipcMain.handle('throw:restore', e => this.win?.webContents === e.sender ? this.restore() : {ok:false});
  }
  offer(undo) {
    this.undo = undo; this.token++; this.busy = false; this.clearTimer(this.timer);
    if (!this.win || this.win.isDestroyed()) {
      this.win = new BrowserWindow({width:330,height:76,show:false,frame:false,transparent:true,backgroundColor:'#00000000',resizable:false,minimizable:false,maximizable:false,focusable:true,skipTaskbar:true,type:'panel',webPreferences:{preload:this.preload,contextIsolation:true,sandbox:true}});
      this.win.setAlwaysOnTop(true,'screen-saver',2); this.win.setVisibleOnAllWorkspaces(true,{visibleOnFullScreen:true});this.win.setHiddenInMissionControl?.(true);
      this.win.webContents.once('did-finish-load',()=>{if(this.undo){this.win.webContents.send('throw:state',{});this.win.showInactive();}});
      this.win.loadFile(path.join(__dirname,'../renderer/restore.html'));
    }
    const b=screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
    this.win.setPosition(b.x+b.width-350,b.y+b.height-96);
    this.win.webContents.send('throw:state',{});this.win.showInactive();
    this.timer=this.setTimer(()=>this.hide(),10000);
  }
  async restore() {
    if (!this.undo || this.busy) return {ok:false};
    const undo=this.undo, token=this.token;this.busy=true;this.clearTimer(this.timer);
    try {await undo();if(this.token===token)this.hide();return{ok:true};}
    catch {if(this.token===token)this.timer=this.setTimer(()=>this.hide(),10000);return{ok:false,error:'Could not restore. Try again.'};}
    finally {if(this.token===token)this.busy=false;}
  }
  hide(){this.clearTimer(this.timer);this.undo=null;if(this.win&&!this.win.isDestroyed())this.win.hide();}
  close(){this.hide();if(this.win&&!this.win.isDestroyed())this.win.destroy();}
}
module.exports={RestoreToast};
