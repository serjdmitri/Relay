// Watches the hand frames for a middle finger held up to the camera. It must be held for a moment before it counts (a hand passing through the shape
// does nothing) and must be gone for a moment before it is put away (a flicker of the finder does not make it blink). Plain numbers in, three calls
// out: onShow(hand) once, onMove(hand) while it stays, onHide() once. The clock is injected.
class FingerWatch {
  constructor({ onShow = () => {}, onMove = () => {}, onHide = () => {}, holdMs = 220, dropMs = 450, now = Date.now } = {}) {
    Object.assign(this, { onShow, onMove, onHide, holdMs, dropMs, now });
    this.reset(false);
  }

  reset(notify = true) {
    const was = this.shown;
    this.shown = false; this.since = null; this.lastSeen = 0;
    if (was && notify) this.onHide();
  }

  update(f) {
    const t = Number.isFinite(f?.t) && f.t > 0 ? f.t : this.now();
    const h = (f?.hands || []).find((x) => x && x.score !== 0 && x.gesture === 'Middle_Finger' && Number.isFinite(x.x) && Number.isFinite(x.y));
    if (h) {
      this.lastSeen = t;
      if (this.since === null) this.since = t;
      if (!this.shown && t - this.since >= this.holdMs) { this.shown = true; this.onShow(h); }
      else if (this.shown) this.onMove(h);
      return;
    }
    this.since = null;
    if (this.shown && t - this.lastSeen >= this.dropMs) { this.shown = false; this.onHide(); }
  }
}

module.exports = { FingerWatch };
