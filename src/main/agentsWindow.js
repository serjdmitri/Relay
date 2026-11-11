const {createFloatingWindow}=require('./floatingWindow');
const { BrowserWindow, screen, ipcMain } = require('electron');
const path = require('path');
const { isSecret } = require('./memory');

// The agents dashboard: start several independent jobs at once, watch each one's progress, cancel any of them, and read what finished. The window
// only starts, cancels and reads. Agents are the same background agents as ever (no screen, no sending, no deleting), at most three at a time; the
// rest wait in line here. Everything is kept in memory for this session only.
const MAX_LINES = 10, MAX_LEN = 400;

class AgentsWindow {
  constructor({ agents, start, motion, foreground = () => null, stopForeground = () => false }) {
    Object.assign(this, { agents, start, motion, foreground, stopForeground });
    ipcMain.handle('agents:action', async (e, action, value) => {
      if (!this.win || e.sender !== this.win.webContents) return { error: 'Open the agents dashboard first.' };
      try {
        if (action === 'state') return { ...this.agents.snapshot(), foreground: this.foreground() };
        if (action === 'stop-foreground') return { stopped: !!this.stopForeground(value), state: { ...this.agents.snapshot(), foreground: this.foreground() } };
        if (action === 'start') return this.submit(value);
        if (action === 'cancel') { const kind = this.agents.cancel(String(value || '')); return { cancelled: kind, state: this.agents.snapshot() }; }
        if (action === 'clear') { this.agents.clearFinished(); return { state: this.agents.snapshot() }; }
        if (action === 'close') this.win.close();
        return { ok: true };
      } catch (err) { return { error: err.message }; }
    });
  }

  // One job per line. Each is started, or waits for a free slot; credentials in a job are refused.
  submit(text) {
    const lines = String(text || '').split('\n').map((l) => l.trim()).filter(Boolean);
    if (!lines.length) return { error: 'Type at least one job, one per line.' };
    const results = lines.slice(0, MAX_LINES).map((task) => {
      if (task.length > MAX_LEN) return { task: task.slice(0, 60) + '…', error: `A job can be at most ${MAX_LEN} characters.` };
      if (isSecret(task)) return { task: task.slice(0, 60), error: 'Remove passwords, keys or other credentials from the job.' };
      const r = this.start(task);
      return { task: task.slice(0, 60), ...r };
    });
    return { results, ignored: Math.max(0, lines.length - MAX_LINES), state: this.agents.snapshot() };
  }

  open() {
    if (this.win && !this.win.isDestroyed()) { this.win.show(); this.win.moveTop(); return; }
    const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea, width = Math.min(640, area.width), height = Math.min(780, area.height);
    const win = this.win = createFloatingWindow(BrowserWindow,{ x: area.x + Math.round((area.width - width) / 2), y: area.y + Math.round((area.height - height) / 2), width, height, minWidth: 360, minHeight: 400});
    win.loadFile(path.join(__dirname, '../renderer/agents.html')); win.once('ready-to-show', () => win.show()); win.on('closed', () => { this.win = null; });
    this.motion?.watchWindow(win, { key: 'agents', close: () => win.close(), undo: () => this.open() });
  }

  handTarget(p) {
    const w = this.win; if (!w || w.isDestroyed() || !w.isVisible()) return null;
    const b = w.getBounds(); if (p.x < b.x || p.y < b.y || p.x > b.x + b.width || p.y > b.y + b.height) return null;
    return { key: 'agents', position: () => w.getBounds(), move: (x, y) => w.setPosition(Math.round(x), Math.round(y)), close: () => w.close(), undo: () => this.open() };
  }
}
module.exports = { AgentsWindow, MAX_LINES, MAX_LEN };
