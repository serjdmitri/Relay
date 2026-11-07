const { BrowserWindow, screen } = require('electron');
const path = require('path');

// "Show my camera": a small floating window with the live camera picture, like the one in Huw Prosser's Jarvis videos. The picture is drawn here on this Mac and never saved or sent anywhere.
// It also lets Jarvis take one picture when you ask "what do you see" and no other part of Relay has the camera open (see snapshot()).
class CameraWindow {
  constructor({ motion } = {}) { Object.assign(this, { motion }); this.win = null; }

  get isOpen() { return !!this.win && !this.win.isDestroyed(); }

  open() {
    if (this.isOpen) { this.win.show(); this.win.moveTop(); return; }
    const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea, width = Math.min(480, area.width), height = Math.min(400, area.height);
    const win = this.win = new BrowserWindow({
      x: area.x + area.width - width - 24, y: area.y + 24, width, height, minWidth: 320, minHeight: 280,
      frame: false, transparent: true, backgroundColor: '#00000000', vibrancy: 'hud', visualEffectState: 'active', resizable: true, show: false, skipTaskbar: true,
      webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, backgroundThrottling: false }
    });
    win.setAlwaysOnTop(true, 'screen-saver', 1); // above the reactor and the answer card, below the access-denied alarm
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' })); win.webContents.on('will-navigate', (e) => e.preventDefault());
    win.loadFile(path.join(__dirname, '../renderer/camera.html')); win.once('ready-to-show', () => win.show());
    win.on('closed', () => { this.win = null; });
    this.motion?.watchWindow(win, { key: 'camera-view', close: () => win.close(), undo: () => this.open() });
  }

  close() { if (this.isOpen) this.win.close(); }

  // One picture from this window's own camera view, as { jpeg: 'data:image/jpeg;base64,...' }, or null if the camera is not showing yet.
  async snapshot() {
    if (!this.isOpen) return null;
    try { return await this.win.webContents.executeJavaScript('window.__cameraShot && window.__cameraShot()'); } catch { return null; }
  }
}
module.exports = { CameraWindow };
