const {createFloatingWindow}=require('./floatingWindow');
const { BrowserWindow, screen, ipcMain, clipboard } = require('electron');
const path = require('path');
const A = require('./securityAudit');

// The security audit screen, and the one place the audit is run for the screen, the voice command and the background warnings.
class SecurityWindow {
  constructor({ gather, version = '', motion }) {
    Object.assign(this, { gather, version, motion, latest: null, pending: null });
    ipcMain.handle('security:action', async (e, action) => {
      if (!this.win || e.sender !== this.win.webContents) return { error: 'Open the security audit first.' };
      try {
        if (action === 'run') return await this.run(false);
        if (action === 'rerun') return await this.run(true);
        if (action === 'copy') { if (!this.latest) return { error: 'Run the audit first.' }; clipboard.writeText(A.buildReport(this.latest, { version: this.version })); return { ok: true }; }
        if (action === 'close') this.win.close();
        return { ok: true };
      } catch (err) { return { error: err.message }; }
    });
  }

  // A result under ten seconds old is reused unless a fresh one is forced, so asking by voice and the screen loading do not run it twice.
  async run(force) {
    if (this.pending) return this.pending;
    if (!force && this.latest && Date.now() - this.latest.at < 10000) return this.latest;
    this.pending = (async () => { const report = A.runAudit(await this.gather()); report.summary = A.summarize(report); this.latest = report; return report; })().finally(() => { this.pending = null; });
    return this.pending;
  }

  open() {
    if (this.win && !this.win.isDestroyed()) { this.win.show(); this.win.moveTop(); return; }
    const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea, width = Math.min(820, area.width), height = Math.min(700, area.height);
    const win = this.win = createFloatingWindow(BrowserWindow,{ x: area.x + Math.round((area.width - width) / 2), y: area.y + Math.round((area.height - height) / 2), width, height, minWidth: 380, minHeight: 360});
    win.loadFile(path.join(__dirname, '../renderer/security.html')); win.once('ready-to-show', () => win.show()); win.on('closed', () => { this.win = null; });
    this.motion?.watchWindow(win, { key: 'security-audit', close: () => win.close(), undo: () => this.open() });
  }

  handTarget(p) {
    const w = this.win; if (!w || w.isDestroyed() || !w.isVisible()) return null;
    const b = w.getBounds(); if (p.x < b.x || p.y < b.y || p.x > b.x + b.width || p.y > b.y + b.height) return null;
    return { key: 'security-audit', position: () => w.getBounds(), move: (x, y) => w.setPosition(Math.round(x), Math.round(y)), close: () => w.close(), undo: () => this.open() };
  }
}
module.exports = { SecurityWindow };
