const {createFloatingWindow}=require('./floatingWindow');
const { BrowserWindow, screen, ipcMain } = require('electron');
const path=require('path');
const {NetworkRadar}=require('./networkRadar');
class NetworkWindow {
  constructor({store,motion,radar=new NetworkRadar({store})}){
    Object.assign(this,{radar,motion});
    ipcMain.handle('network:action',async(e,action,value)=>{
      if(!this.win||e.sender!==this.win.webContents)return{error:'Open the network radar first.'};
      try{if(action==='refresh')return await radar.snapshot();if(action==='scan')return await radar.scan();if(action==='recognize')return radar.mark(value?.mac,!!value?.on);if(action==='close')this.win.close();return{ok:true};}catch(err){return{error:err.message};}
    });
  }
  open(){
    if(this.win&&!this.win.isDestroyed()){this.win.show();this.win.moveTop();return;}
    const area=screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea,width=Math.min(820,area.width),height=Math.min(650,area.height);
    const win=this.win=createFloatingWindow(BrowserWindow,{x:area.x+Math.round((area.width-width)/2),y:area.y+Math.round((area.height-height)/2),width,height,minWidth:380,minHeight:360});
    win.loadFile(path.join(__dirname,'../renderer/network.html'));win.once('ready-to-show',()=>win.show());win.on('closed',()=>{this.win=null;});
    this.motion?.watchWindow(win,{key:'network-radar',close:()=>win.close(),undo:()=>this.open()});
  }
  handTarget(p){const w=this.win;if(!w||w.isDestroyed()||!w.isVisible())return null;const b=w.getBounds();if(p.x<b.x||p.y<b.y||p.x>b.x+b.width||p.y>b.y+b.height)return null;return{key:'network-radar',position:()=>w.getBounds(),move:(x,y)=>w.setPosition(Math.round(x),Math.round(y)),close:()=>w.close(),undo:()=>this.open()};}
}
module.exports={NetworkWindow};
