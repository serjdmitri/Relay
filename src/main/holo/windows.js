// The Electron side of the holograms: the window itself, and the messages the hologram page sends.

const { BrowserWindow, screen, ipcMain } = require('electron');
const path = require('path');

// A window with no frame, no shadow and no background (as big as the display it is placed on): only what the page draws is there. It never takes the keyboard.
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
  // The window is as big as the display: if its page ever hangs or dies, it must not go on holding the clicks.
  const letThrough = () => { if (!win.isDestroyed()) win.setIgnoreMouseEvents(true, { forward: true }); };
  win.webContents.on('unresponsive', letThrough);
  win.webContents.on('render-process-gone', letThrough);
  win.ready = new Promise((resolve) => win.webContents.once('did-finish-load', resolve));
  win.loadFile(path.join(__dirname, '../../renderer/holo.html'));
  return win;
}

const cursor = () => screen.getCursorScreenPoint();
const area = () => screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
const displayFor = (pt) => screen.getDisplayNearestPoint({ x: Math.round(pt.x), y: Math.round(pt.y) }).bounds;

function registerHoloIpc(mgr) {
  const of = (e) => mgr.forSender(e.sender.id);
  ipcMain.handle('holo:hit', (e, on) => { const h = of(e); if (h && !h.win.isDestroyed()) h.win.setIgnoreMouseEvents(!on, { forward: true }); });
  // Letting go always ends the drag, even when the hologram that started it is gone (a piece pulled out of the last one).
  ipcMain.handle('holo:drag', (e, phase) => { if (phase !== 'start') return mgr.stopDrag(); const h = of(e); if (h) mgr.startDrag(h); });
  ipcMain.handle('holo:sizes', (e, sizes) => { const h = of(e); if (h) mgr.setSizes(h.id, sizes); });
  ipcMain.handle('holo:extract', (e, d) => { const h = of(e); if (h && d) return mgr.extract(h, d).then(() => true); });
  // A piece being carried or let go (point in the page's pixels): whether it is over another hologram or far enough out to be taken out.
  ipcMain.handle('holo:piece', (e, d) => { const h = of(e); if (!h || !d) return { over: false, take: false }; if (d.phase === 'cancel') { mgr.pieceEnd(); return { over: false, take: false }; } return mgr.pieceMove(h, { x: +d.x || 0, y: +d.y || 0 }, !!d.outside); });
  ipcMain.handle('holo:scale', (e, v) => { const h = of(e); if (h && Number.isFinite(v)) mgr.setScale(h.id, v); });
  ipcMain.handle('holo:solid', (e, on) => { const h = of(e); if (h) mgr.setSolid(h.id, on); });
  ipcMain.handle('holo:pin', (e, on) => { const h = of(e); if (h) mgr.pin(h.id, on); });
  ipcMain.handle('holo:option', (e, dir) => { const h = of(e); if (h) mgr.step(h.id, dir > 0 ? 1 : -1); });
  ipcMain.handle('holo:close', (e) => { const h = of(e); if (h) mgr.close(h.id); });
}

module.exports = { createHoloWindow, registerHoloIpc, cursor, area, displayFor };
