const { BrowserWindow, screen, ipcMain, dialog } = require('electron');
const path = require('path');
const { StorageScan } = require('./drive/storageScan');
class StorageWindow {
  constructor({ access, motion, reveal, settings }) {
    Object.assign(this, { access, motion, settings });
    this.scan = new StorageScan({ access, reveal });
    ipcMain.handle('storage:action', async (e, action, value) => {
      if (!this.win || e.sender !== this.win.webContents) return { error: 'Open the storage map first.' };
      try {
        if (action === 'roots') return { ...access.status(), preferredRoot: this.scan.rootId };
        if (action === 'choose') {
          const owner = this.win;
          const r = await dialog.showOpenDialog(owner, { title: 'Choose a folder to measure storage', properties: ['openDirectory'] });
          if (r.canceled || this.win !== owner || owner.isDestroyed()) return { cancelled: true };
          const data = access.add(r.filePaths[0]);
          return { ...data, selectedRoot: data.roots.find(root => root.path === r.filePaths[0])?.id };
        }
        if (action === 'start') return this.scan.start(String(value));
        if (action === 'view') return this.scan.view(value);
        if (action === 'status') { if (this.scan.rootId) access.require(this.scan.rootId); return this.scan.state; }
        if (action === 'cancel') return this.scan.cancel();
        if (action === 'reveal') return this.scan.revealNode(value);
        if (action === 'settings') { settings(); return { ok: true }; }
        if (action === 'close') this.win.close();
        return { ok: true };
      } catch (err) { this.scan.cancel(); return { error: err.message }; }
    });
  }
  open({ scan = false } = {}) {
    if (this.win && !this.win.isDestroyed()) {
      this.win.show(); this.win.moveTop();
      if (scan) {
        const send = () => this.win?.webContents.send('storage:scan-requested');
        if (this.win.webContents.isLoading()) this.win.webContents.once('did-finish-load', send); else send();
      }
      return;
    }
    const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
    const width = Math.min(820, area.width), height = Math.min(620, area.height);
    const win = this.win = new BrowserWindow({ x: area.x + Math.round((area.width-width)/2), y: area.y+Math.round((area.height-height)/2), width, height, minWidth: 380, minHeight: 340, frame: false, transparent: true, backgroundColor:'#00000000', resizable: true, show:false, skipTaskbar:true, type:'panel', webPreferences:{preload:path.join(__dirname,'preload.js'),contextIsolation:true,sandbox:true} });
    win.setAlwaysOnTop(true,'screen-saver',1); win.setVisibleOnAllWorkspaces(true,{visibleOnFullScreen:true}); win.setHiddenInMissionControl?.(true);
    win.webContents.setWindowOpenHandler(()=>({action:'deny'})); win.webContents.on('will-navigate', e=>e.preventDefault());
    win.loadFile(path.join(__dirname,'../renderer/storage.html'), { query: { scan: scan ? '1' : '0' } });
    win.once('ready-to-show',()=>win.show());
    this.motion?.watchWindow(win,{key:'storage-map',close:()=>win.close(),undo:()=>this.open()});
    win.on('closed',()=>{ this.scan.cancel(); this.win=null; });
  }
  handTarget(point) {
    const win = this.win; if (!win || win.isDestroyed() || !win.isVisible()) return null;
    const b=win.getBounds(); if(point.x<b.x||point.y<b.y||point.x>b.x+b.width||point.y>b.y+b.height)return null;
    return {key:'storage-map',position:()=>win.getBounds(),move:(x,y)=>win.setPosition(Math.round(x),Math.round(y)),close:()=>win.close(),undo:()=>this.open()};
  }
}
module.exports={StorageWindow};
