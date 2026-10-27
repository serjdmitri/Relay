// Hand control: the camera finds your hands (in a hidden page, on this Mac), the gesture logic (logic.js) turns that into pointer events,
// and this puts them on the holograms. A grab (fist) carries a hologram or a piece; a pinch clicks, or turns the model while held; two
// hands resize; a peace sign opens the mic for the hologram under your hand. A small ring shows where your hand is. Opt-in: the camera is
// on only while this is on, and no picture is ever kept or sent. The window and the camera are injected, so the mapping is tested.

const { HandPointer } = require('./logic');

class HandControl {
  // holos: the HoloManager; display(): the display bounds the hand's screen is; createCamera(): a window-like object that has loaded the camera
  // page; createCursor(): the small ring window; askAccess(): Promise<boolean>; onMic(holoId); notify(message)
  constructor({ holos, display, createCamera, createCursor, askAccess, onMic = () => {}, notify = () => {}, now = Date.now }) {
    Object.assign(this, { holos, display, createCamera, createCursor, askAccess, onMic, notify, now });
    this.enabled = false;
    this.status = 'off';
    this.message = '';
    this.cam = null;
    this.ring = null;
    this.pos = null; // the hand on the screen, in screen points
    this.captured = null; // the hologram a grab or a held pinch belongs to
    this.pointer = new HandPointer({ onEvent: (e) => this.handle(e).catch(() => {}) });
    this.lastMoveSent = 0;
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
    this.ring = this.createCursor();
    return { ok: true };
  }

  disable() {
    this.enabled = false;
    this.status = 'off'; this.message = '';
    this.release();
    try { this.cam?.close?.(); } catch { /* gone */ }
    try { this.ring?.close?.(); } catch { /* gone */ }
    this.cam = null; this.ring = null; this.pos = null;
    this.pointer = new HandPointer({ onEvent: (e) => this.handle(e).catch(() => {}) });
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
    if (this.enabled && f && Array.isArray(f.hands)) this.pointer.update(f);
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
    if (e.type === 'lost') { this.release(); this.ring?.hide?.(); this.pos = null; return; }
    if (e.type === 'scale') { const h = this.target(this.pos || { x: 0, y: 0 }); if (h) h.win.webContents.send('holo:state', 'hand-scale', e.factor); return; }
    if (e.x === undefined) return;
    const pt = this.toScreen(e);
    this.pos = pt;
    this.ring?.moveTo?.(pt);
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
    if (e.type === 'pinchdown') { const h = this.target(pt); this.ringState('pinch'); if (h) { this.captured = h; this.send(h, 'mouseMove', pt); this.send(h, 'mouseDown', pt); } return; }
    if (e.type === 'pinchup') { this.ringState('open'); this.release(); return; }
    if (e.type === 'click') {
      this.ringState('click');
      setTimeout(() => this.ringState('open'), 220);
      const h = this.target(pt);
      if (h) { this.send(h, 'mouseMove', pt); this.send(h, 'mouseDown', pt); this.send(h, 'mouseUp', pt); }
      return;
    }
    if (e.type === 'mic') {
      const h = this.holos.holoNear(pt, 330) || this.holos.latest();
      this.ringState('mic');
      setTimeout(() => this.ringState('open'), 900);
      this.onMic(h?.id || null);
    }
  }
}

module.exports = { HandControl };
