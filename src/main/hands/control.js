// Hand control: the camera finds your hands (in a hidden page, on this Mac), the gesture logic (logic.js) turns that into pointer events,
// and this puts them on the holograms. A grab (fist) carries a hologram or a piece; a pinch clicks, or turns the model while held; two
// hands resize; a peace sign opens the mic for the hologram under your hand. A small ring shows where your hand is. Opt-in: the camera is
// on only while this is on, and no picture is ever kept or sent. The window and the camera are injected, so the mapping is tested.

const { HandPointer } = require('./logic');
const { recognizeStroke } = require('./shape');

class HandControl {
  // holos: the HoloManager; display(): the display bounds the hand's screen is; createCamera(): a window-like object that has loaded the camera
  // page; createCursor(): the small ring window; askAccess(): Promise<boolean>; onMic(holoId); notify(message)
  constructor({ holos, display, createCamera, createCursor, askAccess, onMic = () => {}, notify = () => {}, air = () => {}, shape = () => {}, preview = false, now = Date.now }) {
    Object.assign(this, { holos, display, createCamera, createCursor, askAccess, onMic, notify, air, shape, now });
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
    return { ok: true };
  }

  disable() {
    this.enabled = false;
    this.status = 'off'; this.message = '';
    this.release();
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
    if (f.hands.length) { clearTimeout(this.handTimer); this.handTimer = null; this.setHandMode(true); }
    else if (this.handMode && !this.handTimer) this.handTimer = setTimeout(() => { this.handTimer = null; this.setHandMode(false); }, 2500);
    this.pointer.update(f);
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

  release() {
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
      this.ringState(e.held ? 'held' : 'open');
      const h = this.target(pt);
      if (h) { const now = this.now(); if (now - this.lastMoveSent >= 16) { this.lastMoveSent = now; this.send(h, 'mouseMove', pt, this.captured ? { modifiers: ['leftButtonDown'] } : {}); } }
      return;
    }
    if (e.type === 'grab') {
      const h = this.target(pt);
      this.ringState('held');
      if (!h) return;
      this.send(h, 'mouseMove', pt);
      const mode = await h.win.webContents.executeJavaScript('window.__holoTest ? window.__holoTest.mode() : "whole"').catch(() => 'whole');
      this.captured = h;
      this.send(h, 'mouseDown', pt, mode === 'parts' ? {} : { modifiers: ['alt'] }); // a piece or a shape is carried; anything else moves the whole hologram
      return;
    }
    if (e.type === 'release') { this.ringState('open'); this.release(); return; }
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
    if (e.type === 'swipe') { const h = this.holos.holoNear(pt, 330); if (h) this.holos.step(h.id, e.dir === 'right' ? 1 : -1); return; }
    if (e.type === 'thumbup') { const h = this.holos.holoNear(pt, 330); if (h) { this.holos.pin(h.id, true); h.win.webContents.send('holo:state', 'pinned', true); this.ringState('click'); setTimeout(() => this.ringState('open'), 500); } return; }
    if (e.type === 'thumbdown') { const h = this.holos.holoNear(pt, 330); if (h) this.holos.close(h.id); return; }
    if (e.type === 'mic') {
      const h = this.holos.holoNear(pt, 330) || this.holos.latest();
      this.ringState('mic');
      setTimeout(() => this.ringState('open'), 900);
      this.onMic(h?.id || null);
    }
  }
}

module.exports = { HandControl };
