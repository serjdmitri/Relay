// The Electron side of the holograms: the window itself, and the messages the hologram page sends.

const { BrowserWindow, screen, ipcMain } = require('electron');
const path = require('path');

// A window with no frame, no shadow and no background: only what the page draws is there. It never takes the keyboard.
function createHoloWindow({ preload, width, height }) {
  const win = new BrowserWindow({
    width, height, show: false, frame: false, transparent: true, backgroundColor: '#00000000', hasShadow: false, resizable: false, movable: false,
    minimizable: false, maximizable: false, fullscreenable: false, focusable: false, skipTaskbar: true, enableLargerThanScreen: true, type: 'panel',
    webPreferences: { preload, contextIsolation: true, backgroundThrottling: false }
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setHiddenInMissionControl?.(true);
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  // Clicks go to what is behind it, except where the hologram or its controls are (the page says when the pointer is over them).
  win.setIgnoreMouseEvents(true, { forward: true });
  win.ready = new Promise((resolve) => win.webContents.once('did-finish-load', resolve));
  win.loadFile(path.join(__dirname, '../../renderer/holo.html'));
  return win;
}

const cursor = () => screen.getCursorScreenPoint();
const area = () => screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;

function registerHoloIpc(mgr) {
  const of = (e) => mgr.forSender(e.sender.id);
  ipcMain.handle('holo:hit', (e, on) => { const h = of(e); if (h && !h.win.isDestroyed()) h.win.setIgnoreMouseEvents(!on, { forward: true }); });
  ipcMain.handle('holo:drag', (e, phase) => { const h = of(e); if (!h) return; if (phase === 'start') mgr.startDrag(h); else mgr.stopDrag(); });
  ipcMain.handle('holo:scale', (e, v) => { const h = of(e); if (h && Number.isFinite(v)) mgr.setScale(h.id, v); });
  ipcMain.handle('holo:solid', (e, on) => { const h = of(e); if (h) mgr.setSolid(h.id, on); });
  ipcMain.handle('holo:pin', (e, on) => { const h = of(e); if (h) mgr.pin(h.id, on); });
  ipcMain.handle('holo:option', (e, dir) => { const h = of(e); if (h) mgr.step(h.id, dir > 0 ? 1 : -1); });
  ipcMain.handle('holo:close', (e) => { const h = of(e); if (h) mgr.close(h.id); });
}

module.exports = { createHoloWindow, registerHoloIpc, cursor, area };
