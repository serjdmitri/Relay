// The sticky notes on screen: one small window each, kept above other windows like the other Relay panels, draggable by the coloured bar and editable by
// clicking in. New ones stack in a column near the top right of the screen; where you drag one is remembered.

const { BrowserWindow, screen, ipcMain } = require('electron');
const path = require('path');
const { slot, W, H } = require('./stickies');

class StickyPanel {
  constructor({ stickies, preload, onClose = () => {} }) {
    this.stickies = stickies;
    this.preload = preload;
    this.wins = new Map();
    this.onClose = onClose;
    stickies.onChange = () => this.sync();
    ipcMain.handle('sticky:get', (_e, id) => this.stickies.get(String(id)));
    ipcMain.handle('sticky:text', (_e, id, text) => { this.stickies.onChange = () => {}; this.stickies.setText(String(id), String(text)); this.stickies.onChange = () => this.sync(); });
    ipcMain.handle('sticky:close', (_e, id) => { const s = this.stickies.remove(String(id)); if (s) this.onClose(s); });
  }

  display() { return screen.getDisplayNearestPoint(screen.getCursorScreenPoint()); }

  // Makes the windows match the list: new ones appear, removed ones go, and all are put away while hidden.
  sync() {
    const items = this.stickies.hidden ? [] : this.stickies.items;
    for (const [id, w] of this.wins) if (!items.some((s) => s.id === id) || w.isDestroyed()) { if (!w.isDestroyed()) w.close(); this.wins.delete(id); }
    const wa = this.display().workArea;
    let n = 0;
    for (const s of items) {
      let w = this.wins.get(s.id);
      if (w && !w.isDestroyed()) { if (s.text !== undefined) w.webContents.send('sticky:state', 'text', s.text); n++; continue; }
      const at = s.x !== null && s.y !== null && Number.isFinite(s.x) ? { x: s.x, y: s.y } : slot(n, wa);
      w = new BrowserWindow({
        x: at.x, y: at.y, width: W, height: H, show: false, frame: false, transparent: true, backgroundColor: '#00000000', hasShadow: false, resizable: true, minWidth: 160, minHeight: 120,
        minimizable: false, maximizable: false, fullscreenable: false, skipTaskbar: true, type: 'panel', webPreferences: { preload: this.preload, contextIsolation: true }
      });
      w.setAlwaysOnTop(true, 'floating');
      w.setHiddenInMissionControl?.(true);
      w.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
      w.loadFile(path.join(__dirname, '../renderer/sticky.html'), { query: { id: s.id } });
      w.once('ready-to-show', () => w.showInactive());
      let t = null;
      const saveAt = () => { clearTimeout(t); t = setTimeout(() => { if (!w.isDestroyed()) { const b = w.getBounds(); this.stickies.onChange = () => {}; this.stickies.move(s.id, b.x, b.y); this.stickies.onChange = () => this.sync(); } }, 400); };
      w.on('moved', saveAt);
      this.wins.set(s.id, w);
      n++;
    }
  }

  closeAll() { for (const w of this.wins.values()) if (!w.isDestroyed()) w.close(); this.wins.clear(); }
}

module.exports = { StickyPanel };
