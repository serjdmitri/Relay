// The small floating windows for live panels (like the sticky notes): always on top, draggable by the top bar. The rules about what a panel
// may read and show are in panels/hub.js; this file only makes the windows.

const { BrowserWindow, screen, ipcMain } = require('electron');
const path = require('path');
const { frameDocument } = require('./panels/hub');

const W = 300;
const H = 260;

class PanelWindows {
  constructor({ preload }) {
    this.preload = preload;
    this.specs = new Map();
    this.closers = new Map();
    this.windows = new Map();
    ipcMain.handle('panel:get', (_e, id) => { const s = this.specs.get(String(id)); return s ? { kind: s.kind, title: s.title, sources: s.sources, ...(s.kind === 'custom' ? { doc: frameDocument(s) } : {}) } : null; });
    ipcMain.handle('panel:close', (_e, id) => { this.closers.get(String(id))?.(); });
  }

  // A hand can carry an open panel by its visible rectangle.
  handTarget(point) {
    for (const [id, w] of [...this.windows].reverse()) {
      if (w.isDestroyed() || !w.isVisible()) continue;
      const b = w.getBounds();
      if (point.x < b.x || point.y < b.y || point.x > b.x + b.width || point.y > b.y + b.height) continue;
      return { key: `panel:${id}`, position: () => w.getBounds(), move: (x, y) => { if (!w.isDestroyed()) w.setPosition(Math.round(x), Math.round(y)); }, close: () => this.closers.get(id)?.() };
    }
    return null;
  }

  // For the hub: opens a window and gives back what the hub needs to feed and close it.
  open({ id, spec }) {
    this.specs.set(id, spec);
    const wa = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
    const n = this.specs.size - 1;
    const w = new BrowserWindow({
      x: wa.x + wa.width - W - 24, y: wa.y + wa.height - (n + 1) * (H + 12) - 12 > wa.y ? wa.y + wa.height - (n + 1) * (H + 12) - 12 : wa.y + 24 + n * 30, width: W, height: H, show: false, frame: false, transparent: true,
      backgroundColor: '#00000000', hasShadow: false, resizable: true, minWidth: 220, minHeight: 140, minimizable: false, maximizable: false, fullscreenable: false, skipTaskbar: true, type: 'panel',
      webPreferences: { preload: this.preload, contextIsolation: true, sandbox: true }
    });
    this.windows.set(id, w);
    w.setAlwaysOnTop(true, 'floating');
    w.setHiddenInMissionControl?.(true);
    w.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    w.webContents.on('will-navigate', (e) => e.preventDefault());
    w.loadFile(path.join(__dirname, '../renderer/panel.html'), { query: { id } });
    w.once('ready-to-show', () => w.showInactive());
    let onClosed = () => {};
    w.on('closed', () => { this.specs.delete(id); this.closers.delete(id); this.windows.delete(id); onClosed(); });
    this.closers.set(id, () => { if (!w.isDestroyed()) w.close(); });
    return { send: (data) => { if (!w.isDestroyed()) w.webContents.send('panel:data', id, data); }, close: () => { if (!w.isDestroyed()) w.close(); }, onClosed: (fn) => { onClosed = fn; } };
  }
}

module.exports = { PanelWindows };
