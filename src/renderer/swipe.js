// The two-finger desktop swipe, worked out from the 21 points of a hand. The gesture is three steps, in this order, so an ordinary wave of the hand never counts:
//   1. two fingers up (a peace sign, held for a moment)  2. the two fingers pointed at the camera (they look short, because they point straight at it)
//   3. the fingers turned to the side (they look long again, pointing left or right).
// Turning to the left or right is told by which side the fingertips end up on, and by how far they turned: a hand cannot turn as far to the right as to the left, so the right turn needs less
// (leftDeg and rightDeg). Plain functions and a small state machine on {x, y} points, so it is tested on its own. It never looks at a picture, only at points.
import { poseOf } from './hand-pose.js';

// The two-finger arrow: from the middle of the two knuckles to the middle of the two fingertips, in units of the picture height (x is stretched by the picture's shape).
export function twoFingerVector(l, aspect = 4 / 3) {
  if (!l || l.length < 21) return null;
  const x = ((l[8].x + l[12].x) / 2 - (l[5].x + l[9].x) / 2) * aspect;
  const y = (l[8].y + l[12].y) / 2 - (l[5].y + l[9].y) / 2;
  return { x, y, len: Math.hypot(x, y) };
}

export const degrees = (ratio) => (Math.asin(Math.max(0, Math.min(1, ratio))) * 180) / Math.PI;

export class TwoFingerSwipe {
  // leftDeg / rightDeg: how far (in degrees, from pointing at the camera to pointing sideways) the fingers must turn toward your left / right.
  // The default for the right is smaller because the wrist turns less that way. aspect: picture width / height. mirrored: the picture is already flipped like a mirror.
  // onStage(stage): called whenever the step changes ('idle', 'up', 'toward', 'locked'), for the badge that shows what the camera sees.
  constructor({ leftDeg = 55, rightDeg = 40, aspect = 4 / 3, mirrored = false, upHoldMs = 100, stepMs = 2000, cooldownMs = 800, confirmFrames = 2, towardRatio = 0.55, onStage = null } = {}) {
    Object.assign(this, { leftDeg, rightDeg, aspect, mirrored, upHoldMs, stepMs, cooldownMs, confirmFrames, towardRatio, onStage });
    this._stage = 'idle';
    this.reset();
  }

  get stage() { return this._stage; }
  set stage(v) { if (v !== this._stage) { this._stage = v; try { this.onStage && this.onStage(v); } catch { /* the badge must never stop the swipe */ } } }

  reset() { this.stage = 'idle'; this.upSince = null; this.upLast = 0; this.ref = 0; this.enteredAt = 0; this.confirm = 0; this.lockedAt = 0; this.neutralSince = null; this.lostSince = null; this.lastMissAt = -Infinity; }

  // One picture: l = the hand's 21 points (or null when no hand), t = time in ms. Returns null, { type: 'swipe', dir: 'left' | 'right', deg } or { type: 'miss', why } (a miss is only for the log).
  push(l, t) {
    const f = l ? twoFingerVector(l, this.aspect) : null;
    const miss = (why) => { this.stage = 'idle'; this.upSince = null; this.confirm = 0; if (t - this.lastMissAt < 1000) return null; this.lastMissAt = t; return { type: 'miss', why }; };
    const upright = f && poseOf(l) === 'Victory' && Math.abs(f.x) <= 0.6 * f.len && f.y < 0;

    if (this.stage === 'locked') {
      // one swipe is one desktop: nothing more happens until the hand has gone, or the fingers are no longer turned out to the side
      const turned = f && this.ref > 0 && f.len / this.ref >= 0.6 && Math.abs(f.x) >= 0.7 * f.len;
      if (turned) this.neutralSince = null; else if (this.neutralSince === null) this.neutralSince = t;
      if (t - this.lockedAt >= this.cooldownMs && this.neutralSince !== null && t - this.neutralSince >= 250) { this.stage = 'idle'; this.upSince = null; }
      return null;
    }

    if (this.stage === 'idle') {
      if (!upright) { this.upSince = null; return null; }
      if (this.upSince === null) this.upSince = t;
      if (t - this.upSince >= this.upHoldMs) { this.stage = 'up'; this.ref = f.len; this.upLast = t; }
      return null;
    }

    if (this.stage === 'up') {
      if (upright) { this.ref = 0.7 * this.ref + 0.3 * f.len; this.upLast = t; this.lostSince = null; return null; }
      // The hand finder often loses a hand whose fingers point straight at it. A hand that vanishes for a moment right after the two fingers were shown counts as pointing at the camera.
      if (!f) { if (this.lostSince == null) this.lostSince = t; if (t - this.lostSince >= 100 && t - this.upLast <= this.stepMs) { this.stage = 'toward'; this.enteredAt = t; this.confirm = 0; this.lostSince = null; return null; } }
      else this.lostSince = null;
      if (f && f.len / this.ref <= this.towardRatio && t - this.upLast <= this.stepMs) { this.stage = 'toward'; this.enteredAt = t; this.confirm = 0; return null; }
      if (t - this.upLast > this.stepMs) return miss('the two fingers were shown, but not pointed at the camera in time');
      return null;
    }

    // stage 'toward': the fingers point at the camera; now they must turn to one side
    if (t - this.enteredAt > this.stepMs) return miss(this.shortBy ? `turned ${Math.round(this.shortBy.deg)} degrees to the ${this.shortBy.dir}, needs ${this.shortBy.need}` : 'pointed at the camera, but not turned to the side in time');
    if (!f) { this.confirm = 0; return null; }
    const ratio = f.len / this.ref;
    if (ratio <= 0.6) { this.confirm = 0; return null; } // still pointing at the camera
    if (Math.abs(f.x) < 0.7 * f.len) { this.confirm = 0; return null; } // turning, but not sideways (up or down)
    let dir = f.x > 0 ? 'left' : 'right'; // the camera sees you from the front: fingers going to the right of the picture are going to your left
    if (this.mirrored) dir = dir === 'left' ? 'right' : 'left';
    const need = dir === 'left' ? this.leftDeg : this.rightDeg, deg = degrees(ratio);
    // two degrees of leeway: the log showed "turned 40 degrees, needs 40" over and over (39.6 is not 40)
    if (deg < need - 2) { this.confirm = 0; this.shortBy = { dir, deg, need }; return null; }
    if (++this.confirm < this.confirmFrames) return null;
    this.stage = 'locked'; this.lockedAt = t; this.neutralSince = null; this.shortBy = null;
    return { type: 'swipe', dir, deg: Math.round(deg) };
  }
}


// A closed fist held toward the camera for a moment, which turns hand control on. It only runs while hand control is off (once it is on, a fist grabs). The hand must be close enough to be a
// deliberate sign and not one far away, it must be held without a break, and after it has fired the fist has to open before it can fire again.
export class FistHold {
  // onStage('holding' | 'idle'): for the badge at the pointer.
  constructor({ holdMs = 700, showMs = 150, minPalm = 0.1, gapMs = 150, aspect = 4 / 3, onStage = null } = {}) {
    Object.assign(this, { holdMs, showMs, minPalm, gapMs, aspect, onStage });
    this._stage = 'idle'; this.since = null; this.lastFist = 0; this.armed = true; this.openSince = null;
  }

  get stage() { return this._stage; }
  set stage(v) { if (v !== this._stage) { this._stage = v; try { this.onStage && this.onStage(v); } catch { /* the badge must never stop it */ } } }

  // l: the hand's 21 points (or null), t: ms. Returns { type: 'fist' } once when the fist has been held long enough.
  push(l, t) {
    const palm = l && l.length >= 21 ? Math.hypot((l[0].x - l[9].x) * this.aspect, l[0].y - l[9].y) : 0;
    const fist = !!l && palm >= this.minPalm && poseOf(l) === 'Closed_Fist';
    if (fist) {
      this.openSince = null;
      if (this.since === null) this.since = t;
      this.lastFist = t;
      if (!this.armed) return null;
      if (t - this.since >= this.showMs) this.stage = 'holding';
      if (t - this.since >= this.holdMs) { this.armed = false; this.stage = 'idle'; this.since = null; return { type: 'fist' }; }
      return null;
    }
    if (this.since !== null && t - this.lastFist > this.gapMs) { this.since = null; this.stage = 'idle'; }
    if (!this.armed) { if (this.openSince === null) this.openSince = t; if (t - this.openSince >= 600) this.armed = true; }
    return null;
  }
}

// Two open palms held up to the camera for a moment turn hand control on again (it switches itself off after a while with no hand). ls: the hands in view, each as its 21 points.
export class PalmsHold {
  constructor({ holdMs = 1200, minPalm = 0.1, aspect = 4 / 3 } = {}) { Object.assign(this, { holdMs, minPalm, aspect }); this.since = null; this.armed = true; this.downSince = null; }

  push(ls, t) {
    const palm = (l) => (l && l.length >= 21 ? Math.hypot((l[0].x - l[9].x) * this.aspect, l[0].y - l[9].y) : 0);
    const both = Array.isArray(ls) && ls.length === 2 && ls.every((l) => palm(l) >= this.minPalm && poseOf(l) === 'Open_Palm');
    if (both) {
      this.lastBoth = t;
      this.downSince = null;
      if (this.since === null) this.since = t;
      if (this.armed && t - this.since >= this.holdMs) { this.armed = false; return { type: 'palms' }; }
      return null;
    }
    // a flicker of one picture (a hand read as something else for a moment) does not start the hold over; 0.4 seconds of anything else, or lowering the hands, does
    if (Array.isArray(ls) && ls.length && this.lastBoth !== undefined && t - this.lastBoth <= 400) return null;
    this.since = null;
    if (!this.armed) { if (this.downSince === null) this.downSince = t; if (t - this.downSince >= 800) this.armed = true; }
    return null;
  }
}
