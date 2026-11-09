// Watches the hand frames for a number held up with the fingers: one hand shows 1 to 5, two hands add up (up to 9, and 9 means "the last one").
// The number must be held steady for about a second, so a hand on its way to another sign never counts, and it fires once; to fire the same
// number again, put the hand down (or change the number). Plain numbers in, onNumber(n) out. The clock is injected.
const SHOWING = new Set(['Open_Palm', 'Victory', 'Pointing_Up', 'None']); // a fist, a thumb, a middle finger or a pinch is never a number

class CountWatch {
  constructor({ onNumber = () => {}, holdMs = 1000, steady = 0.85, now = Date.now } = {}) {
    Object.assign(this, { onNumber, holdMs, steady, now });
    this.reset();
  }

  reset() { this.samples = []; this.fired = 0; this.lowSince = null; }

  // The number a frame shows, or 0 when it shows none.
  static totalOf(f) {
    const hands = (f?.hands || []).filter((h) => h && h.score !== 0);
    if (!hands.length || hands.length > 2) return 0;
    let total = 0;
    for (const h of hands) {
      if (!SHOWING.has(h.gesture) || (h.pinch !== undefined && h.pinch < 0.3) || !(h.count >= 1)) return 0;
      total += Math.min(5, Math.round(h.count));
    }
    return Math.min(9, total);
  }

  update(f) {
    const t = Number.isFinite(f?.t) && f.t > 0 ? f.t : this.now();
    const n = CountWatch.totalOf(f);
    if (n === 0) { if (this.lowSince === null) this.lowSince = t; if (t - this.lowSince >= 500) this.fired = 0; } else this.lowSince = null;
    this.samples.push({ t, n });
    while (this.samples.length && t - this.samples[0].t > this.holdMs + 150) this.samples.shift();
    const span = t - this.samples[0].t;
    if (n === 0 || span < this.holdMs || n === this.fired) return;
    const same = this.samples.filter((s) => s.n === n).length;
    if (same / this.samples.length >= this.steady) { this.fired = n; this.samples = []; this.onNumber(n); }
  }
}

module.exports = { CountWatch };
