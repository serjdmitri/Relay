// The 3D viewer window: black glass like the answer card, bigger, with a canvas you can drag and zoom. It takes the mouse but never
// the keyboard focus, and goes by itself after a few minutes (it stays while the pointer is on it).

const { BrowserWindow, screen } = require('electron');
const path = require('path');

const W = 664;
const H = 604;
const SHOW_MS = 4 * 60 * 1000;

class ModelPanel {
  constructor({ preload }) {
    this.preload = preload;
    this.win = null;
    this.open = false;
    this.timer = null;
  }

  ensure() {
    if (this.win && !this.win.isDestroyed()) return this.win;
    this.win = new BrowserWindow({
      width: W, height: H, show: false, frame: false, transparent: true, backgroundColor: '#00000000', hasShadow: false,
      resizable: false, movable: false, minimizable: false, maximizable: false, fullscreenable: false, focusable: false, skipTaskbar: true, type: 'panel',
      webPreferences: { preload: this.preload, contextIsolation: true }
    });
    this.win.setAlwaysOnTop(true, 'screen-saver');
    this.win.setHiddenInMissionControl?.(true);
    this.win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    this.ready = new Promise((resolve) => this.win.webContents.once('did-finish-load', resolve));
    this.win.loadFile(path.join(__dirname, '../../renderer/model.html'));
    this.win.on('closed', () => { this.win = null; this.open = false; });
    return this.win;
  }

  // d: { title, subtitle, credit, kind: 'stl' | 'shapes', bytes (a Buffer) | parts }
  async show(d) {
    const win = this.ensure();
    await this.ready;
    const wa = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
    const h = Math.min(H, wa.height - 30);
    win.setBounds({ x: wa.x + wa.width - W - 8, y: wa.y + Math.round((wa.height - h) / 2), width: W, height: h });
    win.webContents.send('model:state', 'show', d);
    win.showInactive();
    this.open = true;
    this.arm();
  }

  arm() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.hide(), SHOW_MS);
  }

  setHover(on) {
    if (on) clearTimeout(this.timer); else if (this.open) this.arm();
  }

  hide() {
    clearTimeout(this.timer);
    if (!this.open || !this.win || this.win.isDestroyed()) return;
    this.open = false;
    this.win.webContents.send('model:state', 'hide');
    setTimeout(() => { if (!this.open && this.win && !this.win.isDestroyed()) this.win.hide(); }, 420);
  }
}

module.exports = { ModelPanel };
