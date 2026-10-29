// The "Recent" menu on the left edge of the screen: a glass panel listing what you asked lately. Move the pointer to the
// left edge and rest it there to open it; it closes when you move away. Clicking an item asks it again.

const { BrowserWindow, screen } = require('electron');
const path = require('path');

const DWELL_MS = 140; // rest the pointer on the tab this long to open it (you can change it in Settings > General)
const LEAVE_MS = 700; // away from the panel this long to close it
const MARGIN = 28; // how far past the panel still counts as being on it
const WIDTH = 344; // the window; the panel inside is 320 wide
const HANDLE_W = 7; // the tab that sticks out of the edge, and how tall it is: resting the pointer on it (and only on it) opens the menu
const HANDLE_H = 360;

// The tab's height on a display: the full 360 points, less on a short screen.
const tabHeight = (d) => Math.max(120, Math.min(HANDLE_H, ((d.workArea || d.bounds).height) - 60));

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
      // only the tab opens it: not the rest of the screen edge
      const wa = d && (d.workArea || d.bounds);
      const midY = wa ? wa.y + wa.height / 2 : 0;
      const onEdge = d && pointer.x <= d.bounds.x + HANDLE_W + 1 && Math.abs(pointer.y - midY) <= tabHeight(d) / 2;
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
  constructor({ getEnabled, getDwell = () => DWELL_MS, preload }) {
    this.getEnabled = getEnabled;
    this.getDwell = getDwell;
    this.preload = preload;
    this.win = null;
    this.rect = null; // where the open panel is
    this.hover = new EdgeHover();
    this.timer = null;
    this.hideTimer = null;
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.poll(), 60);
    this.syncHandles();
    for (const ev of ['display-added', 'display-removed', 'display-metrics-changed']) screen.on(ev, () => this.syncHandles());
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
  }

  // One small tab per display, sticking out of the left edge, centered on its height. Click-through: the pointer resting on it is
  // what opens the menu. It slips away while the menu is open, and returns when it closes.
  syncHandles() {
    this.handles = this.handles || new Map();
    const want = this.getEnabled();
    const displays = want ? screen.getAllDisplays() : [];
    for (const [id, w] of this.handles) {
      if (!displays.some((d) => d.id === id) || w.isDestroyed()) { if (!w.isDestroyed()) w.close(); this.handles.delete(id); }
    }
    for (const d of displays) {
      const wa = d.workArea;
      const th = tabHeight(d);
      const bounds = { x: d.bounds.x, y: wa.y + Math.round((wa.height - th) / 2), width: HANDLE_W, height: th };
      let w = this.handles.get(d.id);
      if (w && !w.isDestroyed()) { w.setBounds(bounds); continue; }
      w = new BrowserWindow({ ...bounds, show: false, frame: false, transparent: true, backgroundColor: '#00000000', hasShadow: false, resizable: false, movable: false, focusable: false, skipTaskbar: true, enableLargerThanScreen: true, type: 'panel' });
      w.setIgnoreMouseEvents(true);
      w.setAlwaysOnTop(true, 'screen-saver');
      w.setHiddenInMissionControl?.(true);
      w.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
      w.loadFile(path.join(__dirname, '../renderer/recent-tab.html'));
      w.once('ready-to-show', () => { if (!this.rect) w.showInactive(); });
      this.handles.set(d.id, w);
    }
  }

  setHandlesAway(away) {
    for (const w of this.handles?.values() || []) if (!w.isDestroyed()) {
      if (away) w.webContents.executeJavaScript('window.__away(true)').catch(() => {});
      else { w.showInactive(); w.webContents.executeJavaScript('window.__away(false)').catch(() => {}); }
    }
  }

  poll() {
    const enabled = this.getEnabled();
    if (enabled !== this.lastEnabled) { this.lastEnabled = enabled; this.syncHandles(); }
    if (!enabled) {
      if (this.rect) this.close();
      return;
    }
    const dwell = Number(this.getDwell());
    this.hover.dwell = Number.isFinite(dwell) ? Math.max(0, Math.min(3000, dwell)) : DWELL_MS;
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
    this.ready = new Promise((resolve) => this.win.webContents.once('did-finish-load', resolve)); // a message sent before the page has loaded is lost
    this.win.loadFile(path.join(__dirname, '../renderer/recent.html'));
    this.win.on('closed', () => { this.win = null; this.rect = null; });
    return this.win;
  }

  // The window is a tall transparent strip centered on the left edge; rect is just the black panel inside it.
  async open(display) {
    const win = this.ensure();
    clearTimeout(this.hideTimer);
    const first = !this.rect;
    if (first) { this.rect = { x: 0, y: 0, width: 0, height: 0 }; await this.ready; } // claim the open state at once so the poll does not open it twice
    const wa = display.workArea;
    const height = Math.max(300, Math.min(wa.height - 40, 760));
    this.strip = { x: wa.x, y: wa.y + Math.round((wa.height - height) / 2), width: WIDTH, height };
    this.panelH = this.panelH || 360;
    if (first) {
      this.setHandlesAway(true);
      win.setBounds(this.strip);
      win.webContents.send('recent:state', 'show');
      win.showInactive();
    }
    this.place();
  }

  place() {
    if (!this.strip) return;
    const h = Math.min(this.panelH, this.strip.height - 100); // room above and below for the curved flares
    this.rect = { x: this.strip.x, y: this.strip.y + Math.round((this.strip.height - h) / 2), width: WIDTH - 24, height: h }; // flush with the screen edge, joined to it
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
    this.win.webContents.send('recent:state', 'hide');
    this.win.setIgnoreMouseEvents(true, { forward: true });
    clearTimeout(this.hideTimer);
    this.setHandlesAway(false);
    this.hideTimer = setTimeout(() => { if (!this.rect && this.win && !this.win.isDestroyed()) this.win.hide(); }, 340);
  }

  toggle(display) {
    if (this.rect) this.close();
    else this.open(display || screen.getDisplayNearestPoint(screen.getCursorScreenPoint()));
  }
}

module.exports = { RecentPanel, EdgeHover, WIDTH, HANDLE_W, HANDLE_H, tabHeight };
