const { BrowserWindow, screen } = require('electron');
const path = require('path');
const { nextBounds } = require('./cameraCommands');

// "Show my camera": the live camera picture floating on the screen with its edges faded away, and a named box (low-opacity fill) round each thing the object finder sees. Voice commands move, resize,
// fade and filter it (see cameraCommands.js). The picture is drawn here on this Mac and never saved or sent anywhere. snapshot() lets Jarvis take one picture when you ask "what do you see".
class CameraWindow {
  constructor({ motion } = {}) { Object.assign(this, { motion }); this.win = null; }

  get isOpen() { return !!this.win && !this.win.isDestroyed(); }
  area() { return screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea; }

  open() {
    if (this.isOpen) { this.win.show(); this.win.moveTop(); return; }
    const area = this.area(), width = Math.min(640, area.width), height = Math.round(width * 0.75);
    const win = this.win = new BrowserWindow({
      x: area.x + area.width - width - 24, y: area.y + 24, width, height, minWidth: 240, minHeight: 180,
      frame: false, transparent: true, backgroundColor: '#00000000', hasShadow: false, resizable: true, show: false, skipTaskbar: true,
      webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, backgroundThrottling: false }
    });
    win.setAlwaysOnTop(true, 'screen-saver', 1); // above the reactor and the answer card, below the access-denied alarm
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' })); win.webContents.on('will-navigate', (e) => e.preventDefault());
    win.loadFile(path.join(__dirname, '../renderer/camera.html')); win.once('ready-to-show', () => win.show());
    win.on('closed', () => { this.win = null; });
    this.motion?.watchWindow(win, { key: 'camera-view', close: () => win.close(), undo: () => this.open() });
  }

  close() { if (this.isOpen) this.win.close(); }

  // A voice command (from parseCameraCommand). Opens the view first if it is not showing. -> the words to say back.
  async adjust(c) {
    this.open();
    const send = (o) => this.win.webContents.executeJavaScript(`window.__camera && window.__camera(${JSON.stringify(o)})`).catch(() => null);
    if (['bigger', 'smaller', 'move', 'fullscreen', 'reset'].includes(c.action)) {
      this.win.setBounds(nextBounds(this.win.getBounds(), this.area(), c), true);
      return { bigger: 'Bigger.', smaller: 'Smaller.', move: `Moved ${c.direction}.`, fullscreen: 'Full screen. Say "camera normal size" to bring it back.', reset: 'Back to normal size, in the middle.' }[c.action];
    }
    if (c.action === 'fade') { await send({ fadeBy: c.amount }); return c.amount > 0 ? 'The edges fade more.' : 'The edges fade less.'; }
    if (c.action === 'boxes') { await send({ boxes: c.on }); return c.on ? 'Boxes on.' : 'Boxes off.'; }
    if (c.action === 'filter') { await send({ filter: c.names }); return c.names.length ? `Showing only ${c.names.join(', ')}. Say "show everything" for all of it.` : 'Showing everything I can name.'; }
    return 'Done.';
  }

  // One picture from this window's own camera view, as { jpeg: 'data:image/jpeg;base64,...', names: [...] }, or null if the camera is not showing yet.
  async snapshot() {
    if (!this.isOpen) return null;
    try { return await this.win.webContents.executeJavaScript('window.__cameraShot && window.__cameraShot()'); } catch { return null; }
  }
}
module.exports = { CameraWindow };
