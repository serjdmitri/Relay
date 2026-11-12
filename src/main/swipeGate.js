// Decides whether a swipe seen by the camera page may switch the desktop. Only you: the camera that checks it is you must have recognised you a moment ago, and nobody else may be in view.
// Without owner recognition set up it falls back to "exactly one face in view". It also stays quiet when the screen is locked, in a meeting, or just after a swipe.
// Plain object in, answer out, with the time and the state of the camera passed in, so all of it is tested.

// Turning the two fingers to your left slides the screen to the left, so you see the desktop on the right (and the other way round). flip reverses it.
// 124 and 123 are the right and left arrow keys, which macOS uses with Control to move between desktops.
function desktopFor(dir, flip = false) {
  const toRight = (dir === 'left') !== !!flip;
  return toRight ? { name: 'right', keyCode: 124 } : { name: 'left', keyCode: 123 };
}

class SwipeGate {
  // getConfig(): settings.swipe. ownerEnrolled(): is owner recognition set up. owner(): { seen: 'owner' | 'stranger' | …, lastOwnerAt: ms }. faces(): { count, at: ms }. blocked(): '' or a reason to stay quiet.
  constructor({ getConfig, ownerEnrolled = () => false, owner = () => ({}), faces = () => ({ count: 0, at: 0 }), blocked = () => '', now = Date.now, ownerWindowMs = 8000, faceWindowMs = 3000, cooldownMs = 700 }) {
    Object.assign(this, { getConfig, ownerEnrolled, owner, faces, blocked, now, ownerWindowMs, faceWindowMs, cooldownMs });
    this.last = -Infinity;
  }

  // evt: { dir: 'left' | 'right' }. Returns { ok: true, key } or { ok: false, why }.
  check(evt = {}) {
    if (!(this.getConfig() || {}).enabled) return { ok: false, why: 'off' };
    if (evt.dir !== 'left' && evt.dir !== 'right') return { ok: false, why: 'not a direction' };
    const r = this.peek(false);
    if (r.ok) { this.last = this.now(); r.key = desktopFor(evt.dir, (this.getConfig() || {}).flip === true); }
    return r;
  }

  // Would a swipe be let through right now? (the same rules, without counting as one): the cursor badge uses it to show whether you are recognised.
  peek(ignoreCooldown = true) {
    const cfg = this.getConfig() || {};
    if (!cfg.enabled) return { ok: false, why: 'off' };
    const t = this.now();
    if (!ignoreCooldown && t - this.last < this.cooldownMs) return { ok: false, why: 'too soon after the last swipe' };
    const reason = this.blocked();
    if (reason) return { ok: false, why: reason };
    const f = this.faces();
    if (this.ownerEnrolled()) {
      const o = this.owner() || {};
      if (o.seen === 'stranger') return { ok: false, why: 'someone else is in view' };
      if (!(t - (o.lastOwnerAt || 0) <= this.ownerWindowMs)) return { ok: false, why: 'you were not recognised just now' };
      if (f.count > 1 && o.seen !== 'owner') return { ok: false, why: 'more than one face in view' };
    } else if (!(f.count === 1 && t - f.at <= this.faceWindowMs)) return { ok: false, why: f.count > 1 ? 'more than one face in view' : 'no face in view' };
    return { ok: true };
  }
}

module.exports = { SwipeGate, desktopFor };
