const { BrowserWindow, screen, ipcMain } = require('electron');
const path = require('path');

// The face setup window: shows what the camera sees, in a circle, with a ring of eight directions around it that fill in as you turn your head that way (see enrollpose.js and
// enroll.js, which do the guiding and turn each captured face into 128 numbers). Only the finished set of numbers comes back here, from this window and no other, and main.js
// decides whether to keep it (acceptEnrollment). No picture is saved or sent.
class EnrollWindow {
  // save(samples, name): Promise<{ ok, message }>. name: set when someone else is being added as a trusted person, empty for you.
  constructor({ save, motion }) {
    Object.assign(this, { save, motion });
    this.win = null; this.name = '';
    const own = (e) => this.win && !this.win.isDestroyed() && e.sender === this.win.webContents;
    ipcMain.handle('enroll:state', (e) => (own(e) ? { ok: true, name: this.name } : { ok: false }));
    ipcMain.handle('enroll:finish', async (e, samples) => {
      if (!own(e)) return { ok: false, message: 'Open the face setup window first.' };
      try { return await this.save(Array.isArray(samples) ? samples.slice(0, 40) : [], this.name); } catch (err) { return { ok: false, message: String(err?.message || 'The face could not be saved.').slice(0, 160) }; }
    });
    ipcMain.handle('enroll:close', (e) => { if (own(e)) this.win.close(); return { ok: true }; });
  }

  get isOpen() { return !!this.win && !this.win.isDestroyed(); }

  open({ name = '' } = {}) {
    if (this.isOpen) { this.win.show(); this.win.moveTop(); return; }
    this.name = String(name || '').slice(0, 40);
    const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea, width = Math.min(540, area.width), height = Math.min(740, area.height);
    const win = this.win = new BrowserWindow({
      x: area.x + Math.round((area.width - width) / 2), y: area.y + Math.round((area.height - height) / 2), width, height, minWidth: 420, minHeight: 600,
      frame: false, transparent: true, backgroundColor: '#00000000', vibrancy: 'hud', visualEffectState: 'active', resizable: true, show: false, skipTaskbar: true,
      webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, backgroundThrottling: false }
    });
    win.setAlwaysOnTop(true, 'floating');
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' })); win.webContents.on('will-navigate', (e) => e.preventDefault());
    win.loadFile(path.join(__dirname, '../renderer/enroll.html')); win.once('ready-to-show', () => win.show());
    win.on('closed', () => { this.win = null; });
    this.motion?.watchWindow(win, { key: 'face-setup', close: () => win.close(), undo: () => this.open({ name: this.name }) });
  }

  close() { if (this.isOpen) this.win.close(); }
}
module.exports = { EnrollWindow };
