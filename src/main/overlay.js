const { BrowserWindow, screen } = require('electron');
const path = require('path');

// Click-through full-display window that shows Relay's own cursor (a glowing halo)
// where the agent is about to click or wants to point.
class Overlay {
  constructor({ isEnabled }) {
    this.isEnabled = isEnabled;
    this.win = null;
    this.hideTimer = null;
  }

  ensure() {
    if (this.win && !this.win.isDestroyed()) return this.win;
    const b = screen.getPrimaryDisplay().bounds;
    this.win = new BrowserWindow({
      x: b.x, y: b.y, width: b.width, height: b.height,
      transparent: true, frame: false, hasShadow: false, resizable: false, focusable: false, skipTaskbar: true,
      show: false, type: 'panel',
      webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true }
    });
    this.win.setIgnoreMouseEvents(true);
    this.win.setAlwaysOnTop(true, 'screen-saver');
    this.win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    this.win.loadFile(path.join(__dirname, '../renderer/overlay.html'));
    return this.win;
  }

  async point(x, y, label) {
    if (!this.isEnabled()) return;
    const win = this.ensure();
    const b = screen.getPrimaryDisplay().bounds;
    win.setBounds(b);
    if (!win.isVisible()) win.showInactive();
    win.webContents.send('overlay:point', { x: x - b.x, y: y - b.y, label });
    clearTimeout(this.hideTimer);
    this.hideTimer = setTimeout(() => this.hide(), 2500);
    await new Promise((r) => setTimeout(r, 500)); // let the glide finish before the click lands
  }

  hide() {
    if (this.win && !this.win.isDestroyed()) this.win.hide();
  }
}

module.exports = { Overlay };
