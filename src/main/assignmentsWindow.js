const { BrowserWindow, screen, ipcMain } = require('electron');
const path = require('path');
const A = require('./assignments');

// The assignment dashboard window. It opens instantly from the last school check (kept in the store), and Refresh reads the school page again.
// It only ever reads: the one action besides refreshing is opening your school page in Firefox.
class AssignmentsWindow {
  constructor({ check, cache, openSource, motion }) {
    Object.assign(this, { check, cache, openSource, motion, pending: null });
    ipcMain.handle('assignments:action', async (e, action) => {
      if (!this.win || e.sender !== this.win.webContents) return { error: 'Open the assignment dashboard first.' };
      try {
        if (action === 'load') return await this.load(false);
        if (action === 'refresh') return await this.load(true);
        if (action === 'open-source') { await this.openSource(); return { ok: true }; }
        if (action === 'close') this.win.close();
        return { ok: true };
      } catch (err) { return { error: err.message }; }
    });
  }

  view(saved, extra = {}) {
    const rows = A.enrich(saved?.assignments || [], new Date());
    return { items: rows, courses: A.courses(rows), counts: A.counts(rows), checkedAt: saved?.checkedAt || null, sourceUrl: saved?.sourceUrl || '', truncated: !!saved?.truncated, ...extra };
  }

  // refresh: read the school page now. Otherwise show what was saved, and read it only if nothing has been saved yet.
  async load(refresh) {
    const saved = this.cache.get();
    if (!refresh && saved) return this.view(saved, { fromCache: true });
    if (this.pending) return this.pending;
    this.pending = (async () => {
      const r = await this.check();
      if (r && !r.problem && Array.isArray(r.assignments)) { const fresh = { checkedAt: r.checkedAt, sourceUrl: r.sourceUrl, assignments: r.assignments, truncated: !!r.truncated }; this.cache.set(fresh); return this.view(fresh); }
      // A failed check never replaces good data with an empty list: the last result stays on screen, marked as old.
      return saved ? this.view(saved, { fromCache: true, problem: r?.problem || 'The check did not finish.' }) : { items: [], courses: [], counts: A.counts([]), checkedAt: null, sourceUrl: '', truncated: false, problem: r?.problem || 'The check did not finish.' };
    })().finally(() => { this.pending = null; });
    return this.pending;
  }

  open() {
    if (this.win && !this.win.isDestroyed()) { this.win.show(); this.win.moveTop(); return; }
    const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea, width = Math.min(640, area.width), height = Math.min(760, area.height);
    const win = this.win = new BrowserWindow({ x: area.x + Math.round((area.width - width) / 2), y: area.y + Math.round((area.height - height) / 2), width, height, minWidth: 360, minHeight: 380, frame: false, transparent: true, backgroundColor: '#00000000', resizable: true, show: false, skipTaskbar: true, type: 'panel', webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true } });
    win.setAlwaysOnTop(true, 'screen-saver', 1); win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true }); win.setHiddenInMissionControl?.(true);
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' })); win.webContents.on('will-navigate', (e) => e.preventDefault());
    win.loadFile(path.join(__dirname, '../renderer/assignments.html')); win.once('ready-to-show', () => win.show()); win.on('closed', () => { this.win = null; });
    this.motion?.watchWindow(win, { key: 'assignments', close: () => win.close(), undo: () => this.open() });
  }

  handTarget(p) {
    const w = this.win; if (!w || w.isDestroyed() || !w.isVisible()) return null;
    const b = w.getBounds(); if (p.x < b.x || p.y < b.y || p.x > b.x + b.width || p.y > b.y + b.height) return null;
    return { key: 'assignments', position: () => w.getBounds(), move: (x, y) => w.setPosition(Math.round(x), Math.round(y)), close: () => w.close(), undo: () => this.open() };
  }
}
module.exports = { AssignmentsWindow };
