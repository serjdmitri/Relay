// The "Recent" menu on the left edge of the screen: a glass panel listing what you asked lately. Move the pointer to the
// left edge and rest it there to open it; it closes when you move away. Clicking an item asks it again.

const { BrowserWindow, screen } = require('electron');
const path = require('path');

const DWELL_MS = 380; // rest the pointer on the edge this long to open it
const LEAVE_MS = 700; // away from the panel this long to close it
const MARGIN = 28; // how far past the panel still counts as being on it
const WIDTH = 344;

// Decides when to open and close from where the pointer is. Pure, so it can be tested.
class EdgeHover {
  constructor({ dwell = DWELL_MS, leave = LEAVE_MS, margin = MARGIN } = {}) {
    this.dwell = dwell;
    this.leave = leave;
    this.margin = margin;
    this.since = null; // when the pointer reached the edge
    this.away = null; // when it left the panel
  }

  // pointer: { x, y }. displays: [{ bounds }]. panel: the open panel's rectangle { x, y, width, height } or null when closed.
  // Returns { action: 'open' | 'close' | null, display }.
  update(pointer, displays, panel, now) {
    const d = displays.find((s) => pointer.x >= s.bounds.x && pointer.x < s.bounds.x + s.bounds.width && pointer.y >= s.bounds.y && pointer.y < s.bounds.y + s.bounds.height);
    if (!panel) {
      this.away = null;
      const onEdge = d && pointer.x <= d.bounds.x + 1;
      if (!onEdge) { this.since = null; return { action: null }; }
      if (this.since === null) this.since = now;
      if (now - this.since >= this.dwell) { this.since = null; return { action: 'open', display: d }; }
      return { action: null };
    }
    this.since = null;
    const m = this.margin;
    const over = pointer.x >= panel.x - m - 4 && pointer.x <= panel.x + panel.width + m && pointer.y >= panel.y - m && pointer.y <= panel.y + panel.height + m;
    if (over) { this.away = null; return { action: null }; }
    if (this.away === null) this.away = now;
    if (now - this.away >= this.leave) { this.away = null; return { action: 'close' }; }
    return { action: null };
  }
}

class RecentPanel {
  constructor({ getEnabled, preload }) {
    this.getEnabled = getEnabled;
    this.preload = preload;
    this.win = null;
    this.rect = null; // where the open panel is
    this.hover = new EdgeHover();
    this.timer = null;
    this.hideTimer = null;
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.poll(), 120);
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
  }

  poll() {
    if (!this.getEnabled()) {
      if (this.rect) this.close();
      return;
    }
    const r = this.hover.update(screen.getCursorScreenPoint(), screen.getAllDisplays(), this.rect, Date.now());
    if (r.action === 'open') this.open(r.display);
    else if (r.action === 'close') this.close();
  }

  ensure() {
    if (this.win && !this.win.isDestroyed()) return this.win;
    this.win = new BrowserWindow({
      width: WIDTH, height: 400, show: false, frame: false, transparent: false, backgroundColor: '#00000000', vibrancy: 'hud', visualEffectState: 'active',
      roundedCorners: true, hasShadow: true, resizable: false, movable: false, minimizable: false, maximizable: false, fullscreenable: false, focusable: false, skipTaskbar: true, type: 'panel',
      webPreferences: { preload: this.preload, contextIsolation: true }
    });
    this.win.setAlwaysOnTop(true, 'screen-saver');
    this.win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    this.win.loadFile(path.join(__dirname, '../renderer/recent.html'));
    this.win.on('closed', () => { this.win = null; this.rect = null; });
    return this.win;
  }

  open(display) {
    const win = this.ensure();
    clearTimeout(this.hideTimer);
    const wa = display.workArea;
    const height = Math.max(260, Math.min(wa.height - 90, 640));
    const target = { x: wa.x + 12, y: wa.y + 48, width: WIDTH, height };
    if (!this.rect) {
      win.setBounds({ ...target, x: target.x - WIDTH - 30 }); // start off to the left, then glide in
      win.webContents.send('recent:show');
      win.showInactive();
    }
    win.setBounds(target, true);
    this.rect = target;
  }

  close() {
    if (!this.rect || !this.win || this.win.isDestroyed()) { this.rect = null; return; }
    const away = { ...this.rect, x: this.rect.x - WIDTH - 30 };
    this.rect = null;
    this.win.webContents.send('recent:hide');
    this.win.setBounds(away, true);
    clearTimeout(this.hideTimer);
    this.hideTimer = setTimeout(() => { if (!this.rect && this.win && !this.win.isDestroyed()) this.win.hide(); }, 320);
  }

  toggle(display) {
    if (this.rect) this.close();
    else this.open(display || screen.getDisplayNearestPoint(screen.getCursorScreenPoint()));
  }
}

module.exports = { RecentPanel, EdgeHover, WIDTH };
