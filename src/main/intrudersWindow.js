const { BrowserWindow, screen, ipcMain } = require('electron');
const path = require('path');

// The window that shows who was at your Mac: each visit with its pictures, when it happened, how it ended, whether the same face came before, a place to give them a name, and a
// delete button (which asks the Mac owner to confirm first, so a stranger cannot erase the evidence). It reads from the intruder log (intruderLog.js) and only talks to its own window.
class IntrudersWindow {
  // log: the IntruderLog. authorize(): Promise, rejects unless the Mac owner confirms (Touch ID). onChange(): called after a change, so the app can refresh its state.
  constructor({ log, authorize, onChange = () => {}, motion }) {
    Object.assign(this, { log, authorize, onChange, motion });
    this.win = null;
    const own = (e) => this.win && !this.win.isDestroyed() && e.sender === this.win.webContents;
    const guard = (fn) => async (e, ...a) => { if (!own(e)) return { error: 'Open the intruder pictures first.' }; try { return await fn(...a); } catch (err) { return { error: String(err?.message || 'That did not work.').slice(0, 160) }; } };
    ipcMain.handle('intruders:list', guard(() => ({ visits: this.log.list().slice(0, 30), people: this.log.people(), now: Date.now() })));
    ipcMain.handle('intruders:answer', guard((id, yes) => { const r = this.log.answer(String(id), yes === true); this.onChange(); return { ok: !!r, result: r }; }));
    ipcMain.handle('intruders:forget', guard(async (id) => { await this.authorize(); const ok = this.log.forgetPerson(String(id)); this.onChange(); return { ok }; }));
    ipcMain.handle('intruders:photos', guard((id) => ({ photos: this.log.photos(String(id)) })));
    ipcMain.handle('intruders:label', guard((id, name) => { const ok = this.log.setLabel(String(id), name); this.onChange(); return { ok }; }));
    ipcMain.handle('intruders:remove', guard(async (id) => { await this.authorize(); const ok = this.log.remove(String(id)); this.onChange(); return { ok }; }));
    ipcMain.handle('intruders:close', (e) => { if (own(e)) this.win.close(); return { ok: true }; });
  }

  get isOpen() { return !!this.win && !this.win.isDestroyed(); }

  open() {
    if (this.isOpen) { this.win.show(); this.win.moveTop(); this.win.webContents.send('intruders:refresh'); return; }
    const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea, width = Math.min(760, area.width), height = Math.min(760, area.height);
    const win = this.win = new BrowserWindow({
      x: area.x + Math.round((area.width - width) / 2), y: area.y + Math.round((area.height - height) / 2), width, height, minWidth: 460, minHeight: 420,
      frame: false, transparent: true, backgroundColor: '#00000000', vibrancy: 'hud', visualEffectState: 'active', resizable: true, show: false, skipTaskbar: true,
      webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true }
    });
    win.setAlwaysOnTop(true, 'screen-saver', 1);
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' })); win.webContents.on('will-navigate', (e) => e.preventDefault());
    win.loadFile(path.join(__dirname, '../renderer/intruders.html')); win.once('ready-to-show', () => win.show());
    win.on('closed', () => { this.win = null; });
    this.motion?.watchWindow(win, { key: 'intruder-pictures', close: () => win.close(), undo: () => this.open() });
  }

  close() { if (this.isOpen) this.win.close(); }
}
module.exports = { IntrudersWindow };
