const {createFloatingWindow}=require('./floatingWindow');
const { BrowserWindow, screen, ipcMain } = require('electron');
const path = require('path');
const { buildPriorities, resolveOpen } = require('./priorities');

// The daily priority menu window. It builds the list from the briefing's facts, and opens only what an item itself says it may (see resolveOpen).
class PrioritiesWindow {
  constructor({ facts, schoolUrl = () => '', openTarget, motion }) {
    Object.assign(this, { facts, schoolUrl, openTarget, motion, latest: null, pending: null });
    ipcMain.handle('priorities:action', async (e, action, id) => {
      if (!this.win || e.sender !== this.win.webContents) return { error: 'Open the priority menu first.' };
      try {
        if (action === 'run') return await this.run(false);
        if (action === 'rerun') return await this.run(true);
        if (action === 'open') {
          const target = resolveOpen(this.latest?.items.find((i) => i.id === String(id)));
          if (!target) return { error: 'There is nothing to open for that item.' };
          await this.openTarget(target);
          return { ok: true };
        }
        if (action === 'close') this.win.close();
        return { ok: true };
      } catch (err) { return { error: err.message }; }
    });
  }

  // Gathering can take a few seconds (school pages are slow), so a result under 30 seconds old is reused unless a fresh one is asked for.
  async run(force) {
    if (this.pending) return this.pending;
    if (!force && this.latest && Date.now() - this.latest.at < 30000) return this.latest;
    this.pending = (async () => {
      const result = buildPriorities(await this.facts(), { schoolUrl: this.schoolUrl() });
      result.items = result.items.map((i) => ({ ...i, canOpen: !!resolveOpen(i) }));
      this.latest = result;
      return result;
    })().finally(() => { this.pending = null; });
    return this.pending;
  }

  open() {
    if (this.win && !this.win.isDestroyed()) { this.win.show(); this.win.moveTop(); return; }
    const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea, width = Math.min(560, area.width), height = Math.min(720, area.height);
    const win = this.win = createFloatingWindow(BrowserWindow,{ x: area.x + Math.round((area.width - width) / 2), y: area.y + Math.round((area.height - height) / 2), width, height, minWidth: 340, minHeight: 360});
    win.loadFile(path.join(__dirname, '../renderer/priorities.html')); win.once('ready-to-show', () => win.show()); win.on('closed', () => { this.win = null; });
    this.motion?.watchWindow(win, { key: 'priorities', close: () => win.close(), undo: () => this.open() });
  }

  handTarget(p) {
    const w = this.win; if (!w || w.isDestroyed() || !w.isVisible()) return null;
    const b = w.getBounds(); if (p.x < b.x || p.y < b.y || p.x > b.x + b.width || p.y > b.y + b.height) return null;
    return { key: 'priorities', position: () => w.getBounds(), move: (x, y) => w.setPosition(Math.round(x), Math.round(y)), close: () => w.close(), undo: () => this.open() };
  }
}
module.exports = { PrioritiesWindow };
