// Turns what the camera sees of your hands into pointer actions. Input: a frame every ~30 ms with each hand's position (the middle knuckle,
// 0..1 across the picture), the gesture the model recognised, and how close thumb and index finger are. Output: events.
//   open hand            moves the pointer
//   fist                 grabs: 'grab', moves while held, 'release' when the hand opens
//   thumb + index tap    a click; held (and moved) it is a press-and-drag: 'pinchdown' ... 'pinchup'
//   both hands pinching or in fists, moving apart or together   'scale' (resize)
//   a peace sign held for a moment                               'mic' (start listening)
// Positions come out as 0..1 across the screen: the picture is mirrored (your right is the screen's right) and only its middle part is
// used, so the pointer reaches the screen's edges without stretching the arm. No Electron in here, so it can be tested.

const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));

// A light filter that is steady when the hand is still and quick when it moves (the "One Euro" idea).
class Smooth {
  constructor(minCutoff = 1.4, beta = 0.04) { this.minCutoff = minCutoff; this.beta = beta; this.x = null; this.dx = 0; }
  alpha(cutoff, dt) { const tau = 1 / (2 * Math.PI * cutoff); return 1 / (1 + tau / dt); }
  filter(v, dt) {
    if (this.x === null) { this.x = v; return v; }
    const d = (v - this.x) / dt;
    this.dx += this.alpha(1, dt) * (d - this.dx);
    this.x += this.alpha(this.minCutoff + this.beta * Math.abs(this.dx), dt) * (v - this.x);
    return this.x;
  }
  reset() { this.x = null; this.dx = 0; }
}

const CLICK_MS = 380;
const CLICK_MOVE = 0.035;

class HandPointer {
  constructor({ onEvent, margin = 0.12 }) {
    this.emit = onEvent;
    this.margin = margin;
    this.sx = new Smooth();
    this.sy = new Smooth();
    this.state = 'none'; // none | open | fist | pinch
    this.fistFrames = 0; this.openFrames = 0; this.pinchOn = 0; this.pinchOff = 0; this.lost = 0;
    this.pinch = null; // { t0, x0, y0, held }
    this.two = null; // { d }
    this.victoryMs = 0; this.victorySince = 0; this.victoryAway = Infinity; this.victoryDone = false;
    this.last = 0;
  }

  map(h) { return { x: clamp((1 - h.x - this.margin) / (1 - 2 * this.margin)), y: clamp((h.y - this.margin) / (1 - 2 * this.margin)) }; }

  update(frame) {
    const t = frame.t;
    const dt = Math.max(0.005, Math.min(0.2, (t - (this.last || t - 33)) / 1000));
    this.last = t;
    const hands = (frame.hands || []).filter((h) => h && h.score !== 0).sort((a, b) => (b.size || 0) - (a.size || 0));
    if (!hands.length) return this.noHand();
    this.lost = 0;
    const h = hands[0];
    const p = this.map(h);
    const x = this.sx.filter(p.x, dt), y = this.sy.filter(p.y, dt);
    const isFist = h.gesture === 'Closed_Fist';

    // ---- the mic sign: a peace sign held ----
    if (h.gesture === 'Victory') {
      if (!this.victorySince) this.victorySince = t;
      this.victoryAway = 0;
      if (!this.victoryDone && t - this.victorySince >= 600) { this.victoryDone = true; this.emit({ type: 'mic', x, y }); }
    } else {
      if (this.victorySince && (this.victoryAway += dt * 1000) > 900) { this.victorySince = 0; this.victoryDone = false; }
      else if (!this.victorySince) this.victoryAway = Infinity;
    }

    // ---- two hands: resize ----
    const second = hands[1];
    const holding = (g) => g.gesture === 'Closed_Fist' || (g.pinch !== undefined && g.pinch < 0.3);
    if (second && holding(h) && holding(second)) {
      const a = this.map(h), b = this.map(second);
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (!this.two) { this.two = { d }; this.releaseAll(x, y); this.emit({ type: 'twohands', x, y }); }
      else if (this.two.d > 0.02) {
        const f = d / this.two.d;
        if (Math.abs(f - 1) > 0.015) { this.emit({ type: 'scale', factor: f, x, y }); this.two.d = d; }
      }
      return;
    }
    if (this.two) { this.two = null; this.state = 'none'; this.fistFrames = 0; this.pinchOn = 0; }

    // ---- fist: grab ----
    if (isFist) { this.fistFrames++; this.openFrames = 0; } else { this.openFrames++; if (this.openFrames > 2) this.fistFrames = 0; }
    if (this.state !== 'fist' && this.fistFrames >= 3) {
      if (this.state === 'pinch') this.endPinch(x, y);
      this.state = 'fist';
      this.emit({ type: 'grab', x, y });
    } else if (this.state === 'fist' && this.openFrames >= 3) {
      this.state = 'open';
      this.emit({ type: 'release', x, y });
    }
    if (this.state === 'fist') { this.emit({ type: 'move', x, y, held: true }); return; }

    // ---- pinch: click, or press and drag ----
    const close = h.pinch !== undefined && h.pinch < 0.28 && !isFist;
    const far = h.pinch === undefined || h.pinch > 0.42;
    if (this.state !== 'pinch') { if (close) this.pinchOn++; else this.pinchOn = 0; }
    else if (far) this.pinchOff++; else this.pinchOff = 0;
    if (this.state !== 'pinch' && this.pinchOn >= 2) {
      this.state = 'pinch'; this.pinchOff = 0;
      this.pinch = { t0: t, x0: x, y0: y, held: false };
    } else if (this.state === 'pinch' && this.pinchOff >= 2) {
      this.endPinch(x, y);
      this.state = 'open';
    }
    if (this.state === 'pinch' && this.pinch) {
      const moved = Math.hypot(x - this.pinch.x0, y - this.pinch.y0);
      if (!this.pinch.held && (t - this.pinch.t0 > CLICK_MS || moved > CLICK_MOVE)) { this.pinch.held = true; this.emit({ type: 'pinchdown', x: this.pinch.x0, y: this.pinch.y0 }); }
      this.emit({ type: 'move', x: this.pinch.held ? x : this.pinch.x0, y: this.pinch.held ? y : this.pinch.y0, held: this.pinch.held });
      return;
    }
    if (this.state === 'none') this.state = 'open';
    this.emit({ type: 'move', x, y, held: false });
  }

  endPinch(x, y) {
    const pz = this.pinch;
    this.pinch = null;
    if (!pz) return;
    if (pz.held) this.emit({ type: 'pinchup', x, y });
    else this.emit({ type: 'click', x: pz.x0, y: pz.y0 });
  }

  releaseAll(x, y) {
    if (this.state === 'fist') this.emit({ type: 'release', x, y });
    if (this.state === 'pinch' && this.pinch?.held) this.emit({ type: 'pinchup', x, y });
    this.pinch = null;
    this.state = 'none';
  }

  noHand() {
    this.lost++;
    if (this.lost === 8) {
      this.releaseAll(this.sx.x ?? 0, this.sy.x ?? 0);
      this.two = null;
      this.victorySince = 0; this.victoryDone = false;
      this.sx.reset(); this.sy.reset();
      this.fistFrames = 0; this.openFrames = 0; this.pinchOn = 0; this.pinchOff = 0;
      this.emit({ type: 'lost' });
    }
  }
}

module.exports = { HandPointer, Smooth, CLICK_MS };
