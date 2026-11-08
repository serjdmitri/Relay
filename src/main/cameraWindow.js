const { BrowserWindow, screen, globalShortcut } = require('electron');
const path = require('path');
const { nextBounds } = require('./cameraCommands');

// "Show my camera": the live camera picture floating on the screen with its edges faded away, and a named box (low-opacity fill) round each thing the object finder sees. Voice commands move, resize,
// fade and filter it (see cameraCommands.js). The picture is drawn here on this Mac and never saved or sent anywhere. snapshot() lets Jarvis take one picture when you ask "what do you see".
class CameraWindow {
  // onView(true|false): told when the view opens or closes, so the reactor can sit in the corner while it is showing (and go back to where it was after).
  constructor({ motion, onView = () => {} } = {}) { Object.assign(this, { motion, onView }); this.win = null; this.full = false; }

  get isOpen() { return !!this.win && !this.win.isDestroyed(); }
  display() { return screen.getDisplayNearestPoint(screen.getCursorScreenPoint()); }
  area() { return this.display().workArea; }

  // Opens full screen by default (asking for the camera, or "what do you see", fills the screen); "camera normal size" brings it down to a window.
  open({ full = true } = {}) {
    if (this.isOpen) { if (this.full) this.win.showInactive(); else this.win.show(); this.win.moveTop(); return; }
    const d = this.display().bounds, area = this.area(), width = full ? d.width : Math.min(640, area.width), height = full ? d.height : Math.round(width * 0.75);
    this.full = full;
    const win = this.win = new BrowserWindow({
      x: full ? d.x : area.x + area.width - width - 24, y: full ? d.y : area.y + 24, width, height, minWidth: 240, minHeight: 180,
      frame: false, transparent: true, backgroundColor: '#00000000', hasShadow: false, resizable: true, show: false, skipTaskbar: true,
      webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, backgroundThrottling: false }
    });
    win.setAlwaysOnTop(true, 'floating'); // below the reactor and the answer card (they are at screen-saver level), so Jarvis stays visible in the corner on top of a full-screen picture
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' })); win.webContents.on('will-navigate', (e) => e.preventDefault());
    win.loadFile(path.join(__dirname, '../renderer/camera.html'));
    win.once('ready-to-show', () => { if (full) { this.passThrough(true); win.showInactive(); } else win.show(); if (full) win.webContents.executeJavaScript('window.__camera && window.__camera({ full: true })').catch(() => null); });
    win.on('closed', () => { this.win = null; this.full = false; try { if (this.esc) globalShortcut.unregister('Escape'); } catch { /* gone */ } this.esc = false; try { this.onView(false); } catch { /* the reactor goes back on its own */ } });
    try { this.onView(true); } catch { /* nothing to move */ }
    this.motion?.watchWindow(win, { key: 'camera-view', close: () => win.close(), undo: () => this.open() });
  }

  // Full screen is a picture to look at, never a wall: every click and key goes straight through it to the apps underneath, and Escape (a global key while it is up) or "hide the camera" closes it.
  // A window you cannot click through would leave the mouse dead on the whole screen.
  passThrough(on) {
    if (!this.isOpen) return;
    try { this.win.setIgnoreMouseEvents(!!on); this.win.setFocusable(!on); } catch { /* the window is going away */ }
    try {
      if (on && !this.esc) { this.esc = globalShortcut.register('Escape', () => this.close()) ? true : false; }
      if (!on && this.esc) { globalShortcut.unregister('Escape'); this.esc = false; }
    } catch { /* no shortcut: the voice command still closes it */ }
  }

  close() { if (this.isOpen) this.win.close(); }

  // A voice command (from parseCameraCommand). Opens the view first if it is not showing. -> the words to say back.
  async adjust(c) {
    this.open({ full: !['bigger', 'smaller', 'move', 'reset'].includes(c.action) });
    const send = (o) => this.win.webContents.executeJavaScript(`window.__camera && window.__camera(${JSON.stringify(o)})`).catch(() => null);
    if (['bigger', 'smaller', 'move', 'fullscreen', 'reset'].includes(c.action)) {
      const full = c.action === 'fullscreen';
      this.win.setBounds(nextBounds(this.win.getBounds(), full ? this.display().bounds : this.area(), c), true);
      this.full = full ? true : c.action === 'reset' ? false : this.full && c.action === 'move';
      this.passThrough(this.full);
      await send({ full: this.full });
      return { bigger: 'Bigger.', smaller: 'Smaller.', move: `Moved ${c.direction}.`, fullscreen: 'Full screen. Say "camera normal size" to bring it back, or "hide the camera".', reset: 'Back to normal size, in the middle.' }[c.action];
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
