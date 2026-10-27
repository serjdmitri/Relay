// Turns what the camera sees of your hands into pointer actions. Input: a frame every ~30 ms with each hand's position (the middle knuckle,
// 0..1 across the picture), the gesture the model recognised, and how close thumb and index finger are. Output: events.
//   open hand            moves the pointer
//   fist                 grabs: 'grab', moves while held, 'release' when the hand opens
//   thumb + index tap    a click; held (and moved) it is a press-and-drag: 'pinchdown' ... 'pinchup'
//   both hands pinching, moving apart or together               'scale' (resize); turning them like a wheel: 'twist' (roll)
//   both hands in fists, pulled apart or pushed together         'pull' (take the model apart into pieces / put it back)
//   a quick sideways swipe of the open hand                      'swipe' (the next or the previous model)
//   a pointing finger held for a moment                          'point' (pick what it points at)
//   a peace sign held for a moment                               'mic' (start listening)
//   a thumb up held / a thumb down held                          'thumbup' (keep it) / 'thumbdown' (close it)
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
    this.holds = {}; // gesture name -> { since, away, done }
    this.trail = []; // recent positions of the open hand, for swipes
    this.swipeAt = 0;
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

    // ---- signs held a moment: a peace sign opens the mic, a thumb up keeps, a thumb down closes ----
    this.hold('Victory', 'mic', h, t, dt, x, y);
    this.hold('Thumb_Up', 'thumbup', h, t, dt, x, y);
    this.hold('Thumb_Down', 'thumbdown', h, t, dt, x, y);
    this.hold('Pointing_Up', 'point', h, t, dt, x, y);

    // ---- two hands: pinching resizes and turns, fists pull it apart ----
    const second = hands[1];
    const fist = (g) => g.gesture === 'Closed_Fist';
    const pinched = (g) => g.pinch !== undefined && g.pinch < 0.3;
    if (second && ((fist(h) && fist(second)) || (pinched(h) && pinched(second)))) {
      const mode = fist(h) && fist(second) ? 'fist' : 'pinch';
      const [l, r] = [this.map(h), this.map(second)].sort((p, q) => p.x - q.x);
      const d = Math.hypot(l.x - r.x, l.y - r.y);
      const angle = Math.atan2(r.y - l.y, r.x - l.x);
      if (!this.two || this.two.mode !== mode) { this.releaseAll(x, y); this.two = { d, angle, mode, total: 1 }; this.emit({ type: 'twohands', mode, x, y }); return; }
      if (this.two.d > 0.02) {
        const f = d / this.two.d;
        if (Math.abs(f - 1) > 0.015) {
          if (mode === 'pinch') this.emit({ type: 'scale', factor: f, x, y });
          else { // fists: far enough apart takes the model apart, far enough back together puts it back
            this.two.total *= f;
            if (this.two.total > 1.3) { this.emit({ type: 'pull', open: true, x, y }); this.two.total = 1; }
            else if (this.two.total < 0.75) { this.emit({ type: 'pull', open: false, x, y }); this.two.total = 1; }
          }
          this.two.d = d;
        }
      }
      let da = angle - this.two.angle;
      while (da > Math.PI) da -= 2 * Math.PI;
      while (da < -Math.PI) da += 2 * Math.PI;
      if (mode === 'pinch' && Math.abs(da) > 0.012) { this.emit({ type: 'twist', angle: da, x, y }); this.two.angle = angle; } else if (mode === 'fist') this.two.angle = angle;
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
    this.swipe(t, x, y, h);
    this.emit({ type: 'move', x, y, held: false });
  }

  // A sign held for a moment fires once, and again only after it was put down for a while.
  hold(name, type, h, t, dt, x, y) {
    const k = this.holds[name] || (this.holds[name] = { since: 0, away: Infinity, done: false });
    if (h.gesture === name) {
      if (!k.since) k.since = t;
      k.away = 0;
      if (!k.done && t - k.since >= 600) { k.done = true; this.emit({ type, x, y }); }
    } else if (k.since) {
      k.away += dt * 1000;
      if (k.away > 900) { k.since = 0; k.done = false; }
    }
  }

  // A quick flick of the open hand sideways: the next or the previous. Slow pointing is never a swipe.
  swipe(t, x, y, h) {
    if (h.gesture !== 'Open_Palm' || h.pinch < 0.42) { this.trail.length = 0; return; }
    this.trail.push({ t, x, y });
    while (this.trail.length && t - this.trail[0].t > 240) this.trail.shift();
    if (t - this.swipeAt < 900 || this.trail.length < 3) return;
    const a = this.trail[0];
    const dx = x - a.x, dy = y - a.y;
    if (Math.abs(dx) > 0.3 && Math.abs(dy) < 0.14) { this.swipeAt = t; this.trail.length = 0; this.emit({ type: 'swipe', dir: dx > 0 ? 'right' : 'left', x, y }); }
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
      this.holds = {}; this.trail.length = 0;
      this.sx.reset(); this.sy.reset();
      this.fistFrames = 0; this.openFrames = 0; this.pinchOn = 0; this.pinchOff = 0;
      this.emit({ type: 'lost' });
    }
  }
}

module.exports = { HandPointer, Smooth, CLICK_MS };
