const { BrowserWindow, screen } = require('electron');
const path = require('path');
const { displayAt } = require('./overlayGeometry');

// Everything Relay draws over your screen, one click-through window per display:
//  - the buddy: a small helper that follows your pointer while Relay works (and flies to what it points at),
//  - the halo: a ring where Relay is about to click or wants to point,
//  - marks: drawings and a step-by-step guide card, which stay until dismissed (Esc, the next request, or a timeout).
// All coordinates in and out of this class are global screen points; each window gets its own display's local ones.
const FOLLOW_MS = 33; // the buddy follows the pointer about 30 times a second, and only while it is on screen
const HALO_MS = 2500;
const MARKS_MS = 30000;

class Overlay {
  constructor({ isEnabled, isBuddy = () => true }) {
    this.isEnabled = isEnabled; // "Relay cursor": the halo, drawings and guides
    this.isBuddy = isBuddy; // "Buddy cursor": the helper that follows the pointer
    this.wins = new Map(); // display id -> { win, display, shapes, card, halo, buddy, haloTimer }
    this.buddyState = null;
    this.followTimer = null;
    this.lastCursor = null;
    this.marksTimer = null;
    this.doneTimer = null;
    this.captureHidden = false;
  }

  // Windows follow displays being plugged in, unplugged or rearranged.
  watchDisplays() {
    for (const ev of ['display-added', 'display-removed', 'display-metrics-changed']) screen.on(ev, () => this.sync());
  }

  sync() {
    const live = new Map(screen.getAllDisplays().map((d) => [d.id, d]));
    for (const [id, e] of this.wins) {
      if (!live.has(id)) {
        if (!e.win.isDestroyed()) e.win.destroy();
        this.wins.delete(id);
      } else {
        e.display = live.get(id);
        if (!e.win.isDestroyed()) e.win.setBounds(e.display.bounds);
      }
    }
  }

  entry(display) {
    let e = this.wins.get(display.id);
    if (e && !e.win.isDestroyed()) return e;
    const b = display.bounds;
    const win = new BrowserWindow({
      x: b.x, y: b.y, width: b.width, height: b.height,
      transparent: true, frame: false, hasShadow: false, resizable: false, focusable: false, skipTaskbar: true,
      show: false, type: 'panel',
      webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true }
    });
    win.setIgnoreMouseEvents(true);
    win.setAlwaysOnTop(true, 'screen-saver');
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    win.loadFile(path.join(__dirname, '../renderer/overlay.html'));
    e = { win, display, shapes: false, card: false, halo: false, buddy: false, haloTimer: null, ready: false, queue: [] };
    // A page that has not finished loading would drop what we send it, so hold commands until it has.
    win.webContents.once('did-finish-load', () => {
      e.ready = true;
      for (const cmd of e.queue) if (!win.isDestroyed()) win.webContents.send('overlay:cmd', cmd);
      e.queue = [];
    });
    this.wins.set(display.id, e);
    return e;
  }

  send(e, cmd) {
    if (!e || e.win.isDestroyed()) return;
    if (e.ready) e.win.webContents.send('overlay:cmd', cmd);
    else if (e.queue.length < 60) e.queue.push(cmd);
  }

  // A window is on screen only while it has something to show.
  refresh(e) {
    if (e.win.isDestroyed()) return;
    const want = e.shapes || e.card || e.halo || e.buddy;
    if (want && !e.win.isVisible()) {
      if (e.win.getBounds().x !== e.display.bounds.x || e.win.getBounds().y !== e.display.bounds.y) e.win.setBounds(e.display.bounds);
      e.win.showInactive();
      e.win.setOpacity(this.captureHidden ? 0 : 1);
    } else if (!want && e.win.isVisible()) e.win.hide();
  }

  local(e, p) {
    return { x: p.x - e.display.bounds.x, y: p.y - e.display.bounds.y };
  }

  // ----- the halo: point at a spot -----
  async point(x, y, label) {
    if (!this.isEnabled()) return false;
    const e = this.entry(displayAt(screen.getAllDisplays(), { x, y }));
    e.halo = true;
    this.refresh(e);
    this.send(e, { type: 'point', ...this.local(e, { x, y }), label: label || '' });
    clearTimeout(e.haloTimer);
    e.haloTimer = setTimeout(() => {
      e.halo = false;
      this.send(e, { type: 'halo-off' });
      this.refresh(e);
    }, HALO_MS);
    await new Promise((r) => setTimeout(r, 500)); // let the glide finish before a click lands
    return true;
  }

  // ----- the buddy: follows the pointer while Relay is listening, thinking or has just finished -----
  buddy(state) {
    clearTimeout(this.doneTimer);
    if (!state || !this.isBuddy()) {
      this.buddyState = null;
      clearInterval(this.followTimer);
      this.followTimer = null;
      this.lastCursor = null;
      for (const e of this.wins.values()) {
        if (!e.buddy) continue;
        e.buddy = false;
        this.send(e, { type: 'buddy-state', state: null });
        this.refresh(e);
      }
      return;
    }
    this.buddyState = state;
    for (const e of this.wins.values()) this.send(e, { type: 'buddy-state', state });
    if (!this.followTimer) this.followTimer = setInterval(() => this.follow(), FOLLOW_MS);
    this.follow(true);
  }

  follow(force = false) {
    const p = screen.getCursorScreenPoint();
    if (!force && this.lastCursor && this.lastCursor.x === p.x && this.lastCursor.y === p.y) return;
    this.lastCursor = p;
    const d = screen.getDisplayNearestPoint(p);
    const here = this.entry(d);
    for (const e of this.wins.values()) {
      if (e === here) continue;
      if (e.buddy) {
        e.buddy = false;
        this.send(e, { type: 'buddy-away' });
        this.refresh(e);
      }
    }
    if (!here.buddy) {
      here.buddy = true;
      this.send(here, { type: 'buddy-state', state: this.buddyState });
      this.refresh(here);
    }
    this.send(here, { type: 'cursor', ...this.local(here, p) });
  }

  // The request is over: the buddy shows a check, then leaves. Drawings and guides stay.
  workDone() {
    if (!this.buddyState) return;
    this.buddy('done');
    this.doneTimer = setTimeout(() => this.buddy(null), 1600);
  }

  // ----- marks: drawings and the guide card -----
  armMarks(seconds = MARKS_MS / 1000) {
    clearTimeout(this.marksTimer);
    this.marksTimer = setTimeout(() => this.clear(), Math.min(120, Math.max(3, seconds)) * 1000);
  }

  // shapes are in global points. add: keep what is already drawn.
  async draw(shapes, { add = false, seconds } = {}) {
    if (!this.isEnabled()) return false;
    const displays = screen.getAllDisplays();
    const byDisplay = new Map();
    for (const s of shapes) {
      const d = displayAt(displays, { x: s.x, y: s.y });
      if (!byDisplay.has(d.id)) byDisplay.set(d.id, { d, shapes: [] });
      byDisplay.get(d.id).shapes.push(s);
    }
    if (!add) {
      for (const e of this.wins.values()) {
        e.shapes = false;
        this.send(e, { type: 'draw', shapes: [], add: false });
        this.refresh(e);
      }
    }
    for (const { d, shapes: list } of byDisplay.values()) {
      const e = this.entry(d);
      const o = { x: d.bounds.x, y: d.bounds.y };
      const moved = list.map((s) => ({ ...s, x: s.x - o.x, y: s.y - o.y, ...(s.x2 !== undefined ? { x2: s.x2 - o.x, y2: s.y2 - o.y } : {}) }));
      e.shapes = true;
      this.refresh(e);
      this.send(e, { type: 'draw', shapes: moved, add: true });
    }
    this.armMarks(seconds);
    return true;
  }

  // card: { steps, current, total }. target: where to point (global points) or null; box: an element's frame to outline.
  async guide(card, target, box) {
    if (!this.isEnabled()) return false;
    const d = target ? displayAt(screen.getAllDisplays(), target) : screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    for (const w of this.wins.values()) {
      w.card = false;
      this.send(w, { type: 'guide', card: null });
    }
    const e = this.entry(d);
    e.card = true;
    this.refresh(e);
    this.send(e, { type: 'guide', card });
    if (box) await this.draw([box], { add: false });
    if (target) await this.point(target.x, target.y, card.steps[card.current]);
    this.armMarks(90);
    return true;
  }

  // Esc, a new request, or the timeout: drawings, the guide card and the halo go away.
  clear() {
    clearTimeout(this.marksTimer);
    for (const e of this.wins.values()) {
      clearTimeout(e.haloTimer);
      e.shapes = false;
      e.card = false;
      e.halo = false;
      this.send(e, { type: 'clear' });
      this.refresh(e);
    }
  }

  hasMarks() {
    for (const e of this.wins.values()) if (e.shapes || e.card) return true;
    return false;
  }

  // Everything off at once.
  hide() {
    this.clear();
    this.buddy(null);
  }

  // A screenshot for the model must not contain our own marks: fade the windows while it is taken.
  setCaptureHidden(on) {
    this.captureHidden = !!on;
    for (const e of this.wins.values()) if (!e.win.isDestroyed() && e.win.isVisible()) e.win.setOpacity(on ? 0 : 1);
  }
}

module.exports = { Overlay };
