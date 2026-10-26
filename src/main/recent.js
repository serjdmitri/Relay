// The "Recent" menu on the left edge of the screen: a glass panel listing what you asked lately. Move the pointer to the
// left edge and rest it there to open it; it closes when you move away. Clicking an item asks it again.

const { BrowserWindow, screen } = require('electron');
const path = require('path');

const DWELL_MS = 380; // rest the pointer on the edge this long to open it
const LEAVE_MS = 700; // away from the panel this long to close it
const MARGIN = 28; // how far past the panel still counts as being on it
const WIDTH = 344; // the window; the panel inside is 320 wide

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
    // A transparent window: the black panel, its shadow and its animation are all drawn by the page.
    this.win = new BrowserWindow({
      width: WIDTH, height: 400, show: false, frame: false, transparent: true, backgroundColor: '#00000000', hasShadow: false,
      resizable: false, movable: false, minimizable: false, maximizable: false, fullscreenable: false, focusable: false, skipTaskbar: true, type: 'panel',
      webPreferences: { preload: this.preload, contextIsolation: true }
    });
    this.win.setHiddenInMissionControl?.(true);
    this.win.setAlwaysOnTop(true, 'screen-saver');
    this.win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    this.win.setIgnoreMouseEvents(true, { forward: true }); // clicks pass through the empty part; the page turns this off over the panel
    this.win.loadFile(path.join(__dirname, '../renderer/recent.html'));
    this.win.on('closed', () => { this.win = null; this.rect = null; });
    return this.win;
  }

  // The window is a tall transparent strip centered on the left edge; rect is just the black panel inside it.
  open(display) {
    const win = this.ensure();
    clearTimeout(this.hideTimer);
    const wa = display.workArea;
    const height = Math.max(300, Math.min(wa.height - 40, 760));
    this.strip = { x: wa.x, y: wa.y + Math.round((wa.height - height) / 2), width: WIDTH, height };
    this.panelH = this.panelH || 360;
    if (!this.rect) {
      win.setBounds(this.strip);
      win.webContents.send('recent:show');
      win.showInactive();
    }
    this.place();
  }

  place() {
    if (!this.strip) return;
    const h = Math.min(this.panelH, this.strip.height - 40);
    this.rect = { x: this.strip.x + 8, y: this.strip.y + Math.round((this.strip.height - h) / 2), width: WIDTH - 24, height: h };
  }

  setPanelHeight(h) {
    if (Number.isFinite(h) && h > 0) { this.panelH = h; if (this.rect) this.place(); }
  }

  setHit(on) {
    if (this.win && !this.win.isDestroyed()) this.win.setIgnoreMouseEvents(!on, { forward: true });
  }

  close() {
    if (!this.rect || !this.win || this.win.isDestroyed()) { this.rect = null; return; }
    this.rect = null;
    this.win.webContents.send('recent:hide');
    this.win.setIgnoreMouseEvents(true, { forward: true });
    clearTimeout(this.hideTimer);
    this.hideTimer = setTimeout(() => { if (!this.rect && this.win && !this.win.isDestroyed()) this.win.hide(); }, 520);
  }

  toggle(display) {
    if (this.rect) this.close();
    else this.open(display || screen.getDisplayNearestPoint(screen.getCursorScreenPoint()));
  }
}

module.exports = { RecentPanel, EdgeHover, WIDTH };
