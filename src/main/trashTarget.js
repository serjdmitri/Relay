const { BrowserWindow } = require('electron');
const path = require('path');
class TrashTarget {
  constructor(preload) { this.preload = preload; this.windows = new Map(); }
  render(states) {
    const shown = new Set();
    for (const state of states) {
      const b = state.bounds, key = `${b.x},${b.y}`; shown.add(key);
      let entry = this.windows.get(key);
      if (!entry || entry.win.isDestroyed()) {
        const win = new BrowserWindow({x:b.x+b.width-250,y:b.y+b.height-250,width:250,height:250,show:false,frame:false,transparent:true,backgroundColor:'#00000000',focusable:false,skipTaskbar:true,resizable:false,type:'panel',webPreferences:{preload:this.preload,contextIsolation:true,sandbox:true,backgroundThrottling:false}});
        win.setIgnoreMouseEvents(true); win.setAlwaysOnTop(true,'screen-saver',2);
        win.setVisibleOnAllWorkspaces(true,{visibleOnFullScreen:true}); win.setHiddenInMissionControl?.(true);
        entry={win,state}; this.windows.set(key,entry);
        win.webContents.once('did-finish-load',()=>{if(!win.isDestroyed()){win.webContents.send('trash:state',entry.state);if(entry.state)win.showInactive();}});
        win.loadFile(path.join(__dirname,'../renderer/trash.html'));
      }
      entry.state = state; entry.win.webContents.send('trash:state',state); entry.win.showInactive();
    }
    for (const [key,entry] of this.windows) if (!shown.has(key) && !entry.win.isDestroyed()) { entry.state=null;entry.win.hide(); }
  }
  close() { for (const entry of this.windows.values()) if(!entry.win.isDestroyed())entry.win.destroy();this.windows.clear(); }
}
module.exports = { TrashTarget };
