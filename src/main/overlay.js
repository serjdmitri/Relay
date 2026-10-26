const { app, BrowserWindow, screen } = require('electron');
const path = require('path');
const { displayAt, normalizeStrokes, strokesBox, lastBurst } = require('./overlayGeometry');

// Everything Relay draws over your screen, one click-through window per display:
//  - the buddy: a small helper that follows your pointer while Relay works (and flies to what it points at),
//  - the halo: a ring where Relay is about to click or wants to point,
//  - marks: drawings and a step-by-step guide card, which stay until dismissed (Esc, the next request, or a timeout).
// All coordinates in and out of this class are global screen points; each window gets its own display's local ones.
const FOLLOW_MS = 33; // the buddy follows the pointer about 30 times a second while the pointer moves
const FOLLOW_IDLE_MS = 160; // and checks about 6 times a second once it has been still for a while
const HALO_MS = 2500;
const MARKS_MS = 30000;
const MARK_POLL_MS = 16; // how often the pointer is read while the mark key is held
const MARK_FADE_MS = 600; // the window goes once the stroke has faded away behind the pointer
const MARK_MIN = 28; // a path smaller than this (points) is not a circle
const BUDDY_MAX_MS = 5 * 60 * 1000; // a safety net: the buddy never stays on screen longer than this

class Overlay {
  constructor({ isEnabled, isBuddy = () => true, getLook = () => 'classic', getName = () => 'J.A.R.V.I.S' }) {
    this.isEnabled = isEnabled; // "Relay cursor": the halo, drawings and guides
    this.isBuddy = isBuddy; // "Buddy cursor": the helper that follows the pointer
    this.getName = getName; // the name shown in the reactor's core
    this.getLook = getLook; // 'jarvis' (a cyan HUD) or 'classic'
    this.wins = new Map(); // display id -> { win, display, shapes, card, halo, buddy, haloTimer }
    this.buddyState = null;
    this.followTimer = null;
    this.lastCursor = null;
    this.idleTicks = 0;
    this.marksTimer = null;
    this.doneTimer = null;
    this.captureHidden = false;
    this.touched = false; // did this request draw or guide?
    this.buddyWatchdog = null;
    this.onClear = null; // called when the marks go away, however that happens
    this.marking = null; // the window the user is drawing a mark on (the mark key is held)
    this.markPts = [];
    this.markPoll = null;
    this.hudEntry = null; // the window showing the reactor (the display the pointer was on when it appeared)
    this.hudState = {};
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
      transparent: true, frame: false, hasShadow: false, resizable: false, focusable: false, skipTaskbar: true, enableLargerThanScreen: true,
      show: false, type: 'panel',
      webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true }
    });
    win.setIgnoreMouseEvents(true);
    win.setAlwaysOnTop(true, 'screen-saver');
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    win.loadFile(path.join(__dirname, '../renderer/overlay.html'));
    e = { win, display, shapes: false, card: false, halo: false, buddy: false, hud: false, haloTimer: null, ready: false, queue: [], markShow: false, markTimer: null };
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
    const look = this.getLook() === 'classic' ? 'classic' : 'jarvis';
    if (e.look !== look) {
      e.look = look;
      this.send(e, { type: 'look', look });
    }
    const want = e.shapes || e.card || e.halo || e.buddy || e.hud || e.markShow;
    if (want && !e.win.isVisible()) {
      if (e.win.getBounds().x !== e.display.bounds.x || e.win.getBounds().y !== e.display.bounds.y) e.win.setBounds(e.display.bounds);
      e.win.showInactive();
      e.win.setOpacity(this.captureHidden ? 0 : 1);
    } else if (!want && e.win.isVisible()) e.win.hide();
  }

  // Where the window really is. macOS can keep a window below the menu bar even when asked for the top of the display,
  // so positions are always worked out from the window's own corner, not the display's.
  origin(e) {
    const b = e.win.getBounds();
    return { x: b.x, y: b.y };
  }

  local(e, p) {
    const o = this.origin(e);
    return { x: p.x - o.x, y: p.y - o.y };
  }

  // ----- the halo: point at a spot -----
  // hold: the ring stays until the marks are cleared (a guide step), instead of fading after a moment.
  async point(x, y, label, { hold = false } = {}) {
    if (!this.isEnabled()) return false;
    const e = this.entry(displayAt(screen.getAllDisplays(), { x, y }));
    e.halo = true;
    this.refresh(e);
    this.send(e, { type: 'point', ...this.local(e, { x, y }), label: label || '' });
    clearTimeout(e.haloTimer);
    if (!hold) {
      e.haloTimer = setTimeout(() => {
        e.halo = false;
        this.send(e, { type: 'halo-off' });
        this.refresh(e);
      }, HALO_MS);
    }
    await new Promise((r) => setTimeout(r, 500)); // let the glide finish before a click lands
    return true;
  }

  // ----- the buddy: follows the pointer. 'idle' (always on), 'listening', 'thinking' or 'done' -----
  buddy(state) {
    clearTimeout(this.doneTimer);
    clearTimeout(this.buddyWatchdog);
    const want = this.isBuddy() ? state || 'idle' : null; // the arrow follows the pointer all the time while it is switched on
    if (!want) {
      this.buddyState = null;
      clearTimeout(this.followTimer);
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
    this.buddyState = want;
    if (want !== 'idle') this.buddyWatchdog = setTimeout(() => this.buddy(null), BUDDY_MAX_MS);
    for (const e of this.wins.values()) this.send(e, { type: 'buddy-state', state: want });
    this.idleTicks = 0;
    if (!this.followTimer) this.followTimer = setTimeout(() => this.tick(), FOLLOW_MS);
    this.follow(true);
  }

  // The settings changed (or the app just started): show or hide the always-on ring to match.
  applyMode() {
    if (!this.buddyState || this.buddyState === 'idle') this.buddy(null);
    else this.buddy(this.buddyState);
  }

  tick() {
    const moved = this.follow();
    this.idleTicks = moved ? 0 : this.idleTicks + 1;
    this.followTimer = this.buddyState ? setTimeout(() => this.tick(), this.idleTicks > 15 ? FOLLOW_IDLE_MS : FOLLOW_MS) : null;
  }

  // Moves the buddy to the pointer. Returns whether the pointer had moved.
  follow(force = false) {
    const p = screen.getCursorScreenPoint();
    if (!force && this.lastCursor && this.lastCursor.x === p.x && this.lastCursor.y === p.y) return false;
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
    if (this.buddyState && !here.buddy) {
      here.buddy = true;
      this.send(here, { type: 'armed', on: !!this.armed });
      this.send(here, { type: 'buddy-state', state: this.buddyState });
      this.refresh(here);
    }
    this.send(here, { type: 'cursor', ...this.local(here, p) });
    return true;
  }

  // ----- the reactor: the Jarvis HUD in the middle of the screen while Relay listens, small in the top left while it works -----
  // msg uses the same fields as the pill ({ state, mode, partial, level, label, text, reply, status, ... }) or { hide: true }.
  hud(msg) {
    if (msg.hide) {
      this.hudState = {};
      const e = this.hudEntry;
      this.hudInteractive(false);
      this.hudEntry = null;
      if (e && !e.win.isDestroyed()) {
        this.send(e, { type: 'hud', hide: true });
        clearTimeout(e.hudTimer);
        e.hudTimer = setTimeout(() => { if (this.hudEntry !== e) { e.hud = false; this.refresh(e); } }, 500); // let it fade out first
      }
      return;
    }
    if ((msg.state && msg.state !== this.hudState.state) || msg.reset) this.hudState = { state: msg.state, mode: msg.mode };
    Object.assign(this.hudState, msg);
    if (!this.hudEntry) {
      this.hudEntry = this.entry(screen.getDisplayNearestPoint(screen.getCursorScreenPoint()));
      this.hudEntry.hud = true;
      clearTimeout(this.hudEntry.hudTimer);
      this.refresh(this.hudEntry);
    }
    this.send(this.hudEntry, { type: 'hud', state: { ...this.hudState, name: this.getName() } });
    this.hudInteractive(msg.state === 'input' || msg.state === 'confirm');
  }

  // Typing a request and Allow / Cancel need the keyboard and the mouse, so the window takes them only while those are shown.
  hudInteractive(on) {
    const e = this.hudEntry;
    if (!e || e.win.isDestroyed() || !!e.interactive === on) return;
    e.interactive = on;
    e.win.setFocusable(on);
    e.win.setIgnoreMouseEvents(!on);
    if (on) {
      app.focus({ steal: true });
      e.win.focus();
      setTimeout(() => this.send(e, { type: 'hud-focus' }), 60);
    }
  }

  // "Hey Jarvis" is listening: the ring shows a quiet sign of it.
  setArmed(on) {
    this.armed = !!on;
    for (const e of this.wins.values()) this.send(e, { type: 'armed', on: !!on });
  }

  // Relay is speaking: the reactor swells and throws off sparks.
  speaking(on) {
    if (this.hudEntry) this.send(this.hudEntry, { type: 'hud-speaking', on: !!on });
    this.speakingNow = !!on;
  }

  // The request is over: the buddy shows a check, then leaves. Drawings and guides stay.
  workDone() {
    if (!this.buddyState || this.buddyState === 'idle') return;
    this.buddy('done');
    this.doneTimer = setTimeout(() => this.buddy(null), 1600);
  }

  // ----- marks: drawings and the guide card -----
  armMarks(seconds = MARKS_MS / 1000) {
    clearTimeout(this.marksTimer);
    this.marksTimer = setTimeout(() => this.clear(), Math.min(900, Math.max(3, seconds)) * 1000);
  }

  // shapes are in global points. add: keep what is already drawn.
  async draw(shapes, { add = false, seconds } = {}) {
    if (!this.isEnabled()) return false;
    this.touched = true;
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
      e.shapes = true;
      this.refresh(e); // show it first: only then is the window's real position known
      const o = this.origin(e);
      const moved = list.map((s) => ({ ...s, x: s.x - o.x, y: s.y - o.y, ...(s.x2 !== undefined ? { x2: s.x2 - o.x, y2: s.y2 - o.y } : {}) }));
      this.send(e, { type: 'draw', shapes: moved, add: true });
    }
    this.armMarks(seconds);
    return true;
  }

  // card: { steps, current, total }. target: where to point (global points) or null; box: an element's frame to outline.
  async guide(card, target, box) {
    if (!this.isEnabled()) return false;
    this.touched = true;
    const d = target ? displayAt(screen.getAllDisplays(), target) : screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    for (const w of this.wins.values()) {
      w.card = false;
      w.halo = false;
      clearTimeout(w.haloTimer);
      this.send(w, { type: 'guide', card: null });
      this.send(w, { type: 'halo-off' });
    }
    const e = this.entry(d);
    e.card = true;
    this.refresh(e);
    this.send(e, { type: 'guide', card });
    if (box) await this.draw([box], { add: false });
    if (target) await this.point(target.x, target.y, card.steps[card.current], { hold: true });
    this.armMarks(600);
    return true;
  }

  // Marks belong to the request that made them. A new request leaves them up while it runs (so "next" can replace
  // the guide), and when it finishes they go unless that request drew or guided again.
  beginRequest() {
    this.touched = false;
  }

  endRequest() {
    if (!this.touched) this.clear();
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
    if (this.onClear) this.onClear();
  }

  hasMarks() {
    for (const e of this.wins.values()) if (e.shapes || e.card) return true;
    return false;
  }

  // ----- the mark key: hold it and move the pointer round something; no click needed -----
  // The pointer's path is followed while the key is held and drawn as a trail that fades after a moment. When the key
  // is let go, the recent path is what the user circled.
  markStart() {
    if (!this.isEnabled()) return false;
    this.markCancel();
    const e = this.entry(screen.getDisplayNearestPoint(screen.getCursorScreenPoint()));
    this.marking = e;
    this.markPts = [];
    e.markShow = true;
    clearTimeout(e.markTimer);
    this.refresh(e);
    this.send(e, { type: 'mark-start' });
    this.markPoll = setInterval(() => this.markTick(), MARK_POLL_MS);
    return true;
  }

  markTick() {
    const e = this.marking;
    if (!e || e.win.isDestroyed()) return;
    const p = screen.getCursorScreenPoint();
    const last = this.markPts[this.markPts.length - 1];
    if (last && Math.hypot(p.x - last.gx, p.y - last.gy) < 2) return;
    const o = this.origin(e);
    const t = Date.now();
    this.markPts.push({ gx: p.x, gy: p.y, t });
    while (this.markPts.length && t - this.markPts[0].t > 6000) this.markPts.shift();
    this.send(e, { type: 'mark-point', x: p.x - o.x, y: p.y - o.y });
  }

  // The key was let go. { display, box (global points), strokes } for what was circled, or null.
  async markEnd() {
    const e = this.marking;
    if (!e) return null;
    clearInterval(this.markPoll);
    this.markPoll = null;
    this.marking = null;
    this.send(e, { type: 'mark-end' });
    const recent = lastBurst(this.markPts).map((q) => [q.gx, q.gy]);
    this.markPts = [];
    const strokes = normalizeStrokes([recent]);
    const box = strokesBox(strokes);
    e.markTimer = setTimeout(() => this.markFade(e), MARK_FADE_MS); // the stroke finishes fading, then the window goes
    if (!box || box.w < MARK_MIN || box.h < MARK_MIN) return null; // a pointer that only passed by is not a circle
    return { display: e.display, box, strokes: 1 };
  }

  markFade(e) {
    e.markShow = false;
    this.send(e, { type: 'mark-clear' });
    this.refresh(e);
  }

  // Esc while marking: drop it.
  markCancel() {
    clearInterval(this.markPoll);
    this.markPoll = null;
    this.markPts = [];
    const e = this.marking;
    if (!e) return;
    this.marking = null;
    this.send(e, { type: 'mark-end', cancel: true });
    this.markFade(e);
  }

  // Everything off at once.
  hide() {
    this.markCancel();
    this.clear();
    this.hud({ hide: true });
    this.buddy(null);
  }

  // A screenshot for the model must not contain our own marks: fade the windows while it is taken.
  setCaptureHidden(on) {
    this.captureHidden = !!on;
    for (const e of this.wins.values()) if (!e.win.isDestroyed() && e.win.isVisible()) e.win.setOpacity(on ? 0 : 1);
  }
}

module.exports = { Overlay };
