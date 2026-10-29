// Hand control: the camera finds your hands (in a hidden page, on this Mac), the gesture logic (logic.js) turns that into pointer events,
// and this puts them on the holograms. A grab (fist) carries a hologram or a piece; a pinch clicks, or turns the model while held; two
// hands resize; a peace sign opens the mic for the hologram under your hand. A small ring shows where your hand is. Opt-in: the camera is
// on only while this is on, and no picture is ever kept or sent. The window and the camera are injected, so the mapping is tested.

const { HandPointer } = require('./logic');
const { recognizeStroke } = require('./shape');
const { HandTracks } = require('./tracks');
const momentum = require('./momentum');

class HandControl {
  // holos: the HoloManager; display(): the display bounds the hand's screen is; createCamera(): a window-like object that has loaded the camera
  // page; createCursor(): the small ring window; askAccess(): Promise<boolean>; onMic(holoId); notify(message)
  constructor({ holos, display, createCamera, createCursor, askAccess, onMic = () => {}, notify = () => {}, air = () => {}, shape = () => {}, preview = false, now = Date.now, secondary = false, floatingAt = () => null, sensitivity = () => 0.12, saveMargin = () => {}, onThrow = () => {}, shortcut = () => 'listen', onShortcut = () => {} }) {
    Object.assign(this, { holos, display, createCamera, createCursor, askAccess, onMic, notify, air, shape, now });
    this.sensitivity = sensitivity;
    this.saveMargin = saveMargin;
    this.onThrow = onThrow;
    this.shortcut = shortcut;
    this.onShortcut = onShortcut;
    this.paused = false;
    this.pauseHold = null;
    this.pauseLatched = false;
    this.calibration = null;
    this.secondary = secondary;
    this.floatingAt = floatingAt;
    this.tracks = new HandTracks();
    this.peer = null;
    this.drag = null;
    this.claims = new Map();
    this.glides = new Map();
    this.claim = null;
    this.generation = 0;
    this.preview = !!preview; // the camera view in the top right of the screen (what the hand finder sees, its hand outlines, the gesture and the hand count)
    this.drawing = false; // a fist in one hand and a pinch in the other: the pinching hand draws a glowing line in the air, and a rough shape becomes a model
    this.stroke = []; // the points of what is being drawn, in screen points
    this.enabled = false;
    this.status = 'off';
    this.message = '';
    this.cam = null;
    this.ring = null;
    this.pos = null; // the hand on the screen, in screen points
    this.captured = null; // the hologram a grab or a held pinch belongs to
    this.pointer = new HandPointer({ onEvent: (e) => this.handle(e).catch(() => {}) });
    this.lastMoveSent = 0;
    this.handMode = false;
    this.handTimer = null;
    this.onChange = () => {};
  }

  // Where the hand is while it holds something: the holograms follow it instead of the real pointer.
  virtualCursor() {
    return this.captured && this.pos ? { x: Math.round(this.pos.x), y: Math.round(this.pos.y) } : null;
  }

  async enable() {
    if (this.enabled) return { ok: true };
    this.status = 'starting'; this.message = ''; this.onChange();
    if (!(await this.askAccess())) { this.status = 'error'; this.message = 'Camera access is off. Turn it on for Relay in System Settings > Privacy & Security > Camera.'; this.onChange(); return { ok: false, error: this.message }; }
    this.enabled = true;
    this.cam = await this.createCamera();
    this.cam?.setPreview?.(this.preview);
    this.ring = this.createCursor();
    if (!this.secondary) {
      this.peer = new HandControl({ holos: this.holos, display: this.display, createCursor: this.createCursor, floatingAt: this.floatingAt, sensitivity: this.sensitivity, onThrow: this.onThrow, shortcut: this.shortcut, onShortcut: this.onShortcut, onMic: this.onMic, now: this.now, secondary: true });
      this.peer.claims = this.claims;
      this.peer.glides = this.glides;
      this.peer.enabled = true;
      this.peer.ring = this.createCursor();
    }
    return { ok: true };
  }

  disable() {
    this.enabled = false;
    this.status = 'off'; this.message = '';
    clearTimeout(this.calibration?.timer); this.calibration = null; this.paused = false; this.pauseHold = null; this.pauseLatched = false;
    this.release();
    if (this.peer) { this.peer.release(); this.peer.ring?.close?.(); this.peer.enabled = false; this.peer = null; }
    for (const key of [...this.glides.keys()]) this.stopGlide(key);
    this.tracks.reset();
    try { this.cam?.close?.(); } catch { /* gone */ }
    try { this.ring?.close?.(); } catch { /* gone */ }
    clearTimeout(this.handTimer); this.handTimer = null;
    this.setHandMode(false);
    this.cam = null; this.ring = null; this.pos = null;
    this.pointer = new HandPointer({ onEvent: (e) => this.handle(e).catch(() => {}) });
    this.onChange();
  }

  // Show or put away the camera view. Hand control itself is not changed.
  setPreview(on) {
    this.preview = !!on;
    try { this.cam?.setPreview?.(this.preview); } catch { /* the view is only a hint */ }
    this.onChange();
  }

  setPaused(on) {
    this.paused = !!on;
    this.release(); this.peer?.release();
    this.ring?.hide?.(); this.peer?.ring?.hide?.();
    this.pointer = new HandPointer({ onEvent: e => this.handle(e).catch(() => {}) });
    if (this.peer) this.peer.pointer = new HandPointer({ onEvent: e => this.peer?.handle(e).catch(() => {}) });
    this.notify(this.paused ? 'Hand control paused. Hold both palms up to resume.' : 'Hand control resumed.');
  }

  calibrate() {
    if (!this.enabled) return { ok: false, error: 'Turn on hand control first.' };
    clearTimeout(this.calibration?.timer);
    this.release(); this.peer?.release();
    const c = { minX: 1, maxX: 0, minY: 1, maxY: 0, samples: 0, timer: null };
    this.calibration = c;
    this.notify('Move one hand comfortably around the edges of the camera view for eight seconds.');
    c.timer = setTimeout(() => {
      if (this.calibration !== c) return;
      this.calibration = null;
      if (c.samples < 20 || c.maxX - c.minX < 0.15 || c.maxY - c.minY < 0.15) { this.notify('Calibration did not see enough movement. Try again with your hand visible.'); return; }
      const margin = Math.max(0.04, Math.min(0.35, Math.min(c.minX, 1 - c.maxX, c.minY, 1 - c.maxY)));
      this.saveMargin(Math.round(margin * 100) / 100);
      this.notify('Hand reach calibrated.');
    }, 8000);
    return { ok: true };
  }

  // From the camera page.
  setStatus(s) {
    if (!this.enabled) return;
    if (s?.state === 'running') { this.status = 'running'; this.message = ''; }
    else if (s?.state === 'error') { this.status = 'error'; this.message = s.message || 'Hand control stopped.'; this.notify(this.message); }
    else if (s?.state === 'model') this.status = 'starting';
    this.onChange();
  }

  frame(f) {
    if (!this.enabled || !f || !Array.isArray(f.hands)) return;
    if (this.calibration) {
      const h = f.hands.find(x => x && x.score !== 0);
      if (h && Number.isFinite(h.x) && Number.isFinite(h.y)) { const c = this.calibration; c.minX = Math.min(c.minX, h.x); c.maxX = Math.max(c.maxX, h.x); c.minY = Math.min(c.minY, h.y); c.maxY = Math.max(c.maxY, h.y); c.samples++; }
      return;
    }
    const palms = f.hands.filter(h => h && h.score !== 0 && h.gesture === 'Open_Palm' && h.pinch > 0.42).length >= 2;
    if (!palms) { this.pauseHold = null; this.pauseLatched = false; }
    else if (!this.pauseLatched) {
      if (this.pauseHold === null) this.pauseHold = f.t;
      if (f.t - this.pauseHold >= 1500) { this.pauseLatched = true; this.setPaused(!this.paused); }
    }
    if (this.paused) return;
    if (f.hands.length) { clearTimeout(this.handTimer); this.handTimer = null; this.setHandMode(true); }
    else if (this.handMode && !this.handTimer) this.handTimer = setTimeout(() => { this.handTimer = null; this.setHandMode(false); }, 2500);
    const margin = Number(this.sensitivity());
    const safeMargin = Number.isFinite(margin) ? Math.max(0.04, Math.min(0.35, margin)) : 0.12;
    this.pointer.margin = safeMargin;
    this.peer.pointer.margin = safeMargin;
    const [first, second] = this.tracks.update(f.hands);
    // Keep the established two-hand gestures when both hands address the same hologram.
    const a = first && this.holos.holoNear(this.toScreen(this.pointer.map(first)), 0);
    const b = second && this.holos.holoNear(this.toScreen(this.pointer.map(second)), 0);
    const closed = h => h && (h.gesture === 'Closed_Fist' || h.pinch < 0.28);
    const drawing = first && second && ((first.gesture === 'Closed_Fist' && second.gesture !== 'Closed_Fist' && second.pinch < 0.28) || (second.gesture === 'Closed_Fist' && first.gesture !== 'Closed_Fist' && first.pinch < 0.28));
    const combined = drawing || (first && second && a && a === b && closed(first) && closed(second));
    if (combined) {
      this.peer.release();
      this.peer.pointer = new HandPointer({ onEvent: e => this.peer?.handle(e).catch(() => {}) });
      const pt = this.toScreen(this.pointer.map(second));
      this.peer.ring?.moveTo?.(pt);
      this.pointer.update({ ...f, hands: [first, second] });
    } else {
      this.pointer.update({ ...f, hands: first ? [first] : [] });
      this.peer.pointer.update({ ...f, hands: second ? [second] : [] });
    }
  }

  // While a hand is in view the holograms show bigger controls (easy to hit from a distance); they go back to normal after the hand has left.
  setHandMode(on) {
    if (on === this.handMode) return;
    this.handMode = on;
    this.holos.handMode = on;
    for (const h of this.holos.holos.values()) if (!h.win.isDestroyed()) h.win.webContents.send('holo:state', 'hand-mode', on);
  }

  toScreen(e) {
    const b = this.display();
    return { x: b.x + e.x * (b.width - 1), y: b.y + e.y * (b.height - 1) };
  }

  // The hologram a point is on or near (a piece can float a good way from the middle), unless one is already held.
  target(pt) {
    return this.captured || this.holos.holoNear(pt, 230) || null;
  }

  local(h, pt) {
    return { x: Math.round(pt.x - (h.disp?.x || 0)), y: Math.round(pt.y - (h.disp?.y || 0)) };
  }

  send(h, type, pt, extra = {}) {
    if (!h || h.win.isDestroyed()) return;
    const l = this.local(h, pt);
    h.win.webContents.sendInputEvent({ type, x: l.x, y: l.y, button: 'left', clickCount: 1, ...extra });
  }

  ringState(cls) {
    try { this.ring?.setState?.(cls); } catch { /* the ring is only a hint */ }
  }

  dismissThrown(target) {
    if (typeof target.undo === 'function') this.onThrow(target.undo);
    target.close();
  }

  stopGlide(key) {
    const glide = this.glides.get(key);
    if (!glide) return;
    clearInterval(glide.timer);
    this.glides.delete(key);
    try { glide.target.finish?.(); } catch { /* it may already be closed */ }
  }

  glide(drag, initial, bounds) {
    const key = drag.target.key;
    this.stopGlide(key);
    const last = drag.trail.at(-1);
    let point = { x: last.x, y: last.y }, v = initial, frames = 0;
    const g = { target: drag.target, timer: null };
    g.timer = setInterval(() => {
      if (!this.enabled || ++frames > 100) return this.stopGlide(key);
      const next = momentum.step(point, v, bounds);
      point = next.point; v = next.velocity;
      try {
        drag.target.move(point.x - drag.ax, point.y - drag.ay);
        if (next.close) { clearInterval(g.timer); this.glides.delete(key); this.dismissThrown(drag.target); return; }
      } catch { return this.stopGlide(key); }
      if (Math.hypot(v.vx, v.vy) < 0.06) this.stopGlide(key);
    }, 16);
    g.timer.unref?.();
    this.glides.set(key, g);
  }

  release({ throwAtEdge = false } = {}) {
    this.generation++;
    if (this.claim && this.claims.get(this.claim) === this) this.claims.delete(this.claim);
    this.claim = null;
    const drag = this.drag;
    this.drag = null;
    if (drag) {
      const b = this.display();
      const recent = drag.trail.filter(p => this.now() - p.t <= 500);
      const start = recent[0];
      const finish = recent.at(-1);
      const thrown = throwAtEdge && start && finish && finish.x >= b.x + b.width * 0.9 && finish.x - start.x >= Math.max(90, b.width * 0.1);
      const v = throwAtEdge ? momentum.velocity(drag.trail, this.now()) : null;
      if (thrown) this.dismissThrown(drag.target); else if (v) this.glide(drag, v, b); else drag.target.finish?.();
      this.captured = null;
      return;
    }
    const h = this.captured;
    this.captured = null;
    if (h && !h.win.isDestroyed() && this.pos) this.send(h, 'mouseUp', this.pos);
  }

  async handle(e) {
    if (!this.enabled) return;
    if (this.preview && e.type !== 'move') { try { this.cam?.action?.({ type: e.type, dir: e.dir, open: e.open, factor: e.factor }); } catch { /* the view is only a hint */ } }
    if (e.type === 'lost') { if (this.drawing) { this.drawing = false; this.air('end', 0, 0); this.stroke = []; } this.release(); this.ring?.hide?.(); this.pos = null; return; }
    if (e.type === 'scale') { const h = this.target(this.pos || { x: 0, y: 0 }); if (h) h.win.webContents.send('holo:state', 'hand-scale', e.factor); return; }
    if (e.type === 'twist') { const h = this.target(this.pos || { x: 0, y: 0 }); if (h) h.win.webContents.send('holo:state', 'hand-twist', e.angle); return; }
    if (e.type === 'pull') { const h = this.target(this.pos || { x: 0, y: 0 }); if (h) h.win.webContents.send('holo:state', 'hand-explode', e.open); return; }
    if (e.x === undefined) return;
    const pt = this.toScreen(e);
    this.pos = pt;
    this.ring?.moveTo?.(pt);
    if (e.type === 'drawstart') { this.release(); this.drawing = true; this.stroke = [pt]; this.ringState('pinch'); this.air('start', pt.x, pt.y); return; }
    if (e.type === 'drawmove') { if (this.drawing) { this.stroke.push(pt); this.air('point', pt.x, pt.y); } return; }
    if (e.type === 'drawend') {
      if (!this.drawing) return;
      this.drawing = false;
      this.air('end', pt.x, pt.y);
      this.ringState('open');
      const r = recognizeStroke(this.stroke);
      this.stroke = [];
      if (r.kind !== 'none') this.shape(r);
      else if (r.why === 'unclear' || r.why === 'not closed') this.notify('That did not look like a circle, a box, a triangle or a line. Draw it a little bigger and close the shape.');
      return;
    }
    if (e.type === 'move') {
      if (this.drag) {
        this.drag.target.move(pt.x - this.drag.ax, pt.y - this.drag.ay);
        const now = this.now();
        this.drag.trail.push({ x: pt.x, y: pt.y, t: now });
        this.drag.trail = this.drag.trail.filter(p => now - p.t <= 500);
        this.ringState('held');
        return;
      }
      this.ringState(e.held ? 'held' : 'open');
      const h = this.target(pt);
      if (h) { const now = this.now(); if (now - this.lastMoveSent >= 16) { this.lastMoveSent = now; this.send(h, 'mouseMove', pt, this.captured ? { modifiers: ['leftButtonDown'] } : {}); } }
      return;
    }
    if (e.type === 'grab') {
      const floating = this.floatingAt(pt);
      if (floating) {
        this.stopGlide(floating.key);
        if (this.claims.has(floating.key)) return;
        this.claim = floating.key; this.claims.set(this.claim, this);
        const origin = floating.position();
        this.drag = { target: floating, ax: pt.x - origin.x, ay: pt.y - origin.y, trail: [{ x: pt.x, y: pt.y, t: this.now() }] };
        this.ringState('held');
        return;
      }
      const h = this.target(pt);
      this.ringState('held');
      if (!h) return;
      this.stopGlide(`holo:${h.id}`);
      if (this.claims.has(`holo:${h.id}`)) return;
      this.claim = `holo:${h.id}`; this.claims.set(this.claim, this);
      const generation = this.generation;
      this.send(h, 'mouseMove', pt);
      const mode = await h.win.webContents.executeJavaScript('window.__holoTest ? window.__holoTest.mode() : "whole"').catch(() => 'whole');
      if (!this.enabled || generation !== this.generation || h.win.isDestroyed()) return;
      if (mode !== 'parts') {
        const original = { title: h.title, items: h.items, options: h.options, pinned: h.pinned, x: h.x, y: h.y, scale: h.scale, solid: h.solid, annotations: h.annotations };
        const target = { key: `holo:${h.id}`, undo: () => this.holos.show(original), position: () => ({ x: h.x, y: h.y }), move: (x, y) => { h.x = Math.round(x); h.y = Math.round(y); this.holos.place(h); if (!h.win.isDestroyed()) h.win.webContents.send('holo:state', 'pos', this.holos.local(h)); }, finish: () => this.holos.persist(), close: () => this.holos.close(h.id) };
        this.captured = h;
        this.drag = { target, ax: pt.x - h.x, ay: pt.y - h.y, trail: [{ x: pt.x, y: pt.y, t: this.now() }] };
        return;
      }
      this.captured = h;
      this.send(h, 'mouseDown', pt, {}); // a piece or a shape is carried; anything else moves the whole hologram
      return;
    }
    if (e.type === 'release') { this.ringState('open'); this.release({ throwAtEdge: true }); return; }
    if (e.type === 'pinchdown') { const h = this.target(pt); this.ringState('pinch'); if (h) { this.captured = h; this.send(h, 'mouseMove', pt); this.send(h, 'mouseDown', pt); } return; } // a pinch held on a hologram turns it; drawing needs the other hand to be a fist
    if (e.type === 'pinchup') { this.ringState('open'); this.release(); return; }
    if (e.type === 'click') {
      this.ringState('click');
      setTimeout(() => this.ringState('open'), 220);
      const h = this.target(pt);
      if (h) { this.send(h, 'mouseMove', pt); this.send(h, 'mouseDown', pt); this.send(h, 'mouseUp', pt); }
      return;
    }
    if (e.type === 'point') { const h = this.holos.holoNear(pt, 330); if (h) { this.ringState('click'); setTimeout(() => this.ringState('open'), 300); this.send(h, 'mouseMove', pt); this.send(h, 'mouseDown', pt); this.send(h, 'mouseUp', pt); } return; }
    if (e.type === 'swipe') {
      const panel = this.floatingAt(pt);
      if (panel && !this.claims.has(panel.key)) {
        this.stopGlide(panel.key);
        const b = this.display(), origin = panel.position();
        const x = Math.max(b.x, Math.min(b.x + b.width - (origin.width || 100), origin.x + (e.dir === 'right' ? 1 : -1) * b.width * 0.15));
        panel.move(x, origin.y);
        panel.finish?.();
        return;
      }
      const h = this.holos.holoNear(pt, 330); if (h) this.holos.step(h.id, e.dir === 'right' ? 1 : -1); return;
    }
    if (e.type === 'thumbup') { const h = this.holos.holoNear(pt, 330); if (h) { this.holos.pin(h.id, true); h.win.webContents.send('holo:state', 'pinned', true); this.ringState('click'); setTimeout(() => this.ringState('open'), 500); } return; }
    if (e.type === 'thumbdown') { const panel = this.floatingAt(pt); if (panel && !this.claims.has(panel.key)) { this.stopGlide(panel.key); panel.close(); return; } const h = this.holos.holoNear(pt, 330); if (h) this.holos.close(h.id); return; }
    if (e.type === 'mic') {
      const choice = this.shortcut();
      if (choice !== 'listen') { this.onShortcut(choice); return; }
      const h = this.holos.holoNear(pt, 330) || this.holos.latest();
      this.ringState('mic');
      setTimeout(() => this.ringState('open'), 900);
      this.onMic(h?.id || null);
    }
  }
}

module.exports = { HandControl };
