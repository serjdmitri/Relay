// Second-viewer guard: while Presence has the camera on, more faces in view than you expect starts a short countdown, and the Mac locks when it ends.
// This counts faces. It does not know WHO anyone is, so it cannot tell an approved person from a stranger, and a poster or a photo counts as a face.
// Anyone beside or behind the screen, out of the camera's view, is not seen. It only ever locks; it never unlocks anything. Opt-in, off by default.

const DEFAULTS = { enabled: false, seconds: 10, expected: 1 };
const clampInt = (v, lo, hi, d) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
function config(raw) {
  const c = raw && typeof raw === 'object' ? raw : {};
  return { enabled: c.enabled === true, seconds: clampInt(c.seconds, 3, 60, DEFAULTS.seconds), expected: clampInt(c.expected, 1, 5, DEFAULTS.expected) };
}

class ViewerGuard {
  // lock(): Promise; notify(text); getConfig(): the settings object. confirmFrames: crowded frames in a row before the countdown starts (a passing face is not enough).
  constructor({ lock, notify = () => {}, getConfig = () => ({}), now = Date.now, confirmFrames = 2, calmFrames = 3 }) {
    Object.assign(this, { lock, notify, getConfig, now, confirmFrames, calmFrames });
    this.reset();
  }

  reset() { this.state = 'watching'; this.crowded = 0; this.calm = 0; this.deadline = null; this.snoozeUntil = 0; }

  // One camera sample, about once a second: { faces }. Returns 'countdown', 'cancelled', 'locked' or null (when nothing changed).
  frame({ faces }) {
    const cfg = config(this.getConfig());
    if (!cfg.enabled || !Number.isFinite(faces)) { if (this.state !== 'watching') this.reset(); return null; }
    const t = this.now();
    if (t < this.snoozeUntil) return null;
    const crowded = faces > cfg.expected;
    this.crowded = crowded ? this.crowded + 1 : 0;
    this.calm = crowded ? 0 : this.calm + 1;

    if (this.state === 'watching') {
      if (this.crowded >= this.confirmFrames) {
        this.state = 'countdown'; this.deadline = t + cfg.seconds * 1000;
        this.notify(`Someone else is in view of the camera. Locking the screen in ${cfg.seconds} seconds unless they step away. Say "it's fine" to pause this guard for 30 minutes.`);
        return 'countdown';
      }
      return null;
    }
    if (this.state === 'countdown') {
      if (this.calm >= this.calmFrames) { this.state = 'watching'; this.deadline = null; return 'cancelled'; }
      if (t >= this.deadline) { this.state = 'locked'; this.deadline = null; Promise.resolve().then(() => this.lock()).catch(() => this.notify('Could not lock the Mac. Lock it manually with Control+Command+Q.')); return 'locked'; }
      return null;
    }
    // locked: stay quiet until the view has been back to normal for a while, so a locked screen is not locked again and again
    if (this.calm >= this.calmFrames) this.state = 'watching';
    return null;
  }

  // "It's fine": no countdown for a while.
  snooze(minutes = 30) { this.snoozeUntil = this.now() + minutes * 60000; this.state = 'watching'; this.crowded = 0; this.deadline = null; return this.snoozeUntil; }
  secondsLeft() { return this.state === 'countdown' && this.deadline ? Math.max(0, Math.ceil((this.deadline - this.now()) / 1000)) : null; }
}

// "turn on the viewer guard", "it's fine" (pause it), "viewer guard off".
function parseViewerGuardCommand(text) {
  const n = String(text || '').trim().replace(/[“”"]/g, '').replace(/[.!?]+$/, '').replace(/^(?:hey |ok |okay )?(?:relay|jarvis)[, ]+/i, '').replace(/^please /i, '').replace(/\s+/g, ' ').toLowerCase();
  const name = String.raw`(?:(?:second|extra|other) viewer|shoulder[- ]?surf(?:ing)?|over[- ]the[- ]shoulder) (?:guard|protection|watch)|viewer guard`;
  if (new RegExp(`^(?:turn on|enable|start|switch on) (?:the |my )?(?:${name})$|^(?:${name}) on$`).test(n)) return { type: 'on' };
  if (new RegExp(`^(?:turn off|disable|stop|switch off) (?:the |my )?(?:${name})$|^(?:${name}) off$`).test(n)) return { type: 'off' };
  if (/^(?:it'?s|its|that'?s|thats) (?:fine|ok|okay|alright)$|^(?:pause|snooze) (?:the )?(?:viewer|second viewer|shoulder[- ]?surf(?:ing)?) (?:guard|protection|watch)$/.test(n)) return { type: 'snooze' };
  return null;
}

module.exports = { ViewerGuard, parseViewerGuardCommand, config, DEFAULTS };
