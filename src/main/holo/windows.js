// The Electron side of the holograms: the window itself, and the messages the hologram page sends.

const { BrowserWindow, screen, ipcMain, app, shell, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const { sanitizeCad } = require('../models/cad');
const { cleanFree } = require('./fit');
const { installedApps, known } = require('./apps3d');
const { uniquePath, safeName } = require('./logic');

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
  ipcMain.handle('holo:hit', (e, on) => { const h = of(e); if (!h || h.win.isDestroyed()) return; h.hit = !!on; if (!h.accepting) h.win.setIgnoreMouseEvents(!on, { forward: true }); });
  ipcMain.handle('holo:files', (e, paths) => { const h = of(e); if (h && Array.isArray(paths)) return mgr.onFiles(h, paths.filter((p) => typeof p === 'string' && p).slice(0, 12)); });
  // Letting go always ends the drag, even when the hologram that started it is gone (a piece pulled out of the last one).
  ipcMain.handle('holo:drag', (e, phase) => { if (phase !== 'start') return mgr.stopDrag(); const h = of(e); if (h) mgr.startDrag(h); });
  ipcMain.handle('holo:sizes', (e, sizes) => { const h = of(e); if (h) mgr.setSizes(h.id, sizes); });
  ipcMain.handle('holo:extract', (e, d) => { const h = of(e); if (h && d) return mgr.extract(h, d).then(() => true); });
  // A piece being carried or let go (point in the page's pixels): whether it is over another hologram or far enough out to be taken out.
  ipcMain.handle('holo:piece', (e, d) => { const h = of(e); if (!h || !d) return { over: false, take: false }; if (d.phase === 'cancel') { mgr.pieceEnd(); return { over: false, take: false }; } return mgr.pieceMove(h, { x: +d.x || 0, y: +d.y || 0 }, !!d.outside); });
  ipcMain.handle('holo:ask', (e, d) => { const h = of(e); if (h && d) return mgr.onAsk(h, d); });
  ipcMain.handle('holo:cad', (e, d) => { const h = of(e); if (!h || !d) return false; try { return mgr.setCad(h, +d.item || 0, sanitizeCad(d.cad)); } catch { return false; } });
  // Saves a model as a file in Downloads/Relay 3D (never over a file that is there).
  ipcMain.handle('holo:glb', (e, r) => { mgr.finishGlb(of(e), r); });
  ipcMain.handle('holo:realsize', (e, r) => { mgr.finishRealSize(of(e), r); });
  ipcMain.handle('holo:annotations', (e, list) => { const h = of(e); return h ? mgr.setAnnotations(h, list) : []; });
  ipcMain.handle('holo:annotate', (e, d) => { const h = of(e); if (h && d) return mgr.onAnnotate(h, d); });
  ipcMain.handle('holo:slicers', () => installedApps((p) => fs.existsSync(p), app.getPath('home')));
  // The hologram as a file, to be dragged into another app: written to a folder of Relay's (one per hologram), not to your files.
  try { fs.rmSync(path.join(app.getPath('userData'), 'hologram-files'), { recursive: true, force: true }); } catch { /* a leftover is harmless */ }
  ipcMain.handle('holo:stage', async (e, d) => {
    const h = of(e);
    if (!h || !d || !(d.bytes instanceof Uint8Array || Buffer.isBuffer(d.bytes)) || d.bytes.length < 84 || d.bytes.length > 200 * 1024 * 1024) return { ok: false };
    const ext = ['stl', '3mf', 'step'].includes(d.ext) ? d.ext : 'stl';
    const dir = path.join(app.getPath('userData'), 'hologram-files', String(h.id).replace(/[^\w-]/g, '').slice(0, 64));
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${safeName(d.name)}.${ext}`);
    fs.writeFileSync(file, Buffer.from(d.bytes));
    h.stagedFile = file;
    return { ok: true, path: file };
  });
  ipcMain.on('holo:dragstart', (e) => {
    const h = of(e);
    if (!h?.stagedFile || !fs.existsSync(h.stagedFile)) return;
    const icon = nativeImage.createFromPath(path.join(__dirname, '../../../assets/icon.png')).resize({ width: 64, height: 64 });
    try { e.sender.startDrag({ file: h.stagedFile, icon }); } catch { /* the system refused the drag */ }
  });
  ipcMain.handle('holo:save', async (e, d) => {
    const res = (r) => { mgr.finishSave(of(e), r); return r; };
    try {
      if (!d || !(d.bytes instanceof Uint8Array || Buffer.isBuffer(d.bytes)) || d.bytes.length < 84 || d.bytes.length > 200 * 1024 * 1024) return res({ ok: false, error: 'Nothing to save.' });
      const ext = ['stl', '3mf', 'step'].includes(d.ext) ? d.ext : 'stl';
      const dir = path.join(app.getPath('downloads'), 'Relay 3D');
      fs.mkdirSync(dir, { recursive: true });
      const file = uniquePath((p) => fs.existsSync(p), dir, d.name, ext);
      fs.writeFileSync(file, Buffer.from(d.bytes), { flag: 'wx' });
      shell.showItemInFolder(file);
      let opened = false;
      const target = known(d.openWith);
      if (target && installedApps((p) => fs.existsSync(p), app.getPath('home')).some((a) => a.name === target.name)) {
        opened = await new Promise((resolve) => require('child_process').execFile('/usr/bin/open', ['-a', target.name, file], (e) => resolve(!e)));
      }
      return res({ ok: true, file, where: `Downloads/Relay 3D/${path.basename(file)}`, opened });
    } catch (err) { return res({ ok: false, error: 'Could not save it.' }); }
  });
  ipcMain.handle('holo:place', (e, d) => { const h = of(e); if (!h || !d) return false; return mgr.setPlacement(h, +d.item || 0, cleanFree(d.free)); });
  ipcMain.handle('holo:scale', (e, v) => { const h = of(e); if (h && Number.isFinite(v)) mgr.setScale(h.id, v); });
  ipcMain.handle('holo:solid', (e, on) => { const h = of(e); if (h) mgr.setSolid(h.id, on); });
  ipcMain.handle('holo:pin', (e, on) => { const h = of(e); if (h) mgr.pin(h.id, on); });
  ipcMain.handle('holo:option', (e, dir) => { const h = of(e); if (h) mgr.step(h.id, dir > 0 ? 1 : -1); });
  ipcMain.handle('holo:close', (e) => { const h = of(e); if (h) mgr.close(h.id); });
}

module.exports = { createHoloWindow, registerHoloIpc, cursor, area, displayFor };
