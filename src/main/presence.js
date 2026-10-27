// Presence: "pause my music when I leave the desk". Opt-in. A small hidden page watches the camera at one picture a second and only counts faces (nothing is
// recognised, saved or sent); this turns those counts into "you went away" and "you are back". The camera is injected, so all of it can be tested.

class PresenceTracker {
  // awayAfterMs: how long with no face before it counts as away (a glance at your phone or a turn of the head must not). backFrames: faces in a row to count as back.
  constructor({ awayAfterMs = 60000, backFrames = 2, onAway = () => {}, onBack = () => {} } = {}) {
    Object.assign(this, { awayAfterMs, backFrames, onAway, onBack });
    this.state = 'unknown'; // unknown | present | away
    this.lastSeen = null;
    this.run = 0; // faces seen in a row
  }

  // One sample: { faces, t } (t in ms). Returns 'away', 'back' or null.
  update({ faces, t }) {
    if (faces > 0) {
      this.run++;
      this.lastSeen = t;
      if (this.state === 'unknown') { this.state = 'present'; return null; }
      if (this.state === 'away' && this.run >= this.backFrames) { this.state = 'present'; this.onBack(); return 'back'; }
      return null;
    }
    this.run = 0;
    if (this.state === 'present' && this.lastSeen !== null && t - this.lastSeen >= this.awayAfterMs) { this.state = 'away'; this.onAway(); return 'away'; }
    return null;
  }

  reset() { this.state = 'unknown'; this.lastSeen = null; this.run = 0; }
}

class PresenceControl {
  // createCamera(): a window-like object with close(); askAccess(): Promise<boolean>; getConfig(): { enabled, awayAfter (seconds) }
  constructor({ createCamera, askAccess, getConfig, onAway = () => {}, onBack = () => {}, notify = () => {}, now = Date.now }) {
    Object.assign(this, { createCamera, askAccess, getConfig, notify, now });
    this.cam = null;
    this.status = 'off';
    this.message = '';
    this.faces = 0;
    this.onChange = () => {};
    this.tracker = new PresenceTracker({ awayAfterMs: 60000, onAway, onBack });
  }

  get enabled() { return !!this.cam; }
  get state() { return this.tracker.state; }

  async enable() {
    if (this.cam) return { ok: true };
    this.status = 'starting'; this.message = ''; this.onChange();
    if (!(await this.askAccess())) { this.status = 'error'; this.message = 'Camera access is off. Turn it on for Relay in System Settings > Privacy & Security > Camera.'; this.onChange(); return { ok: false, error: this.message }; }
    this.tracker.reset();
    this.cam = await this.createCamera();
    return { ok: true };
  }

  disable() {
    try { this.cam?.close?.(); } catch { /* gone */ }
    this.cam = null;
    this.status = 'off'; this.message = '';
    this.faces = 0;
    this.tracker.reset();
    this.onChange();
  }

  // From the camera page: { state: 'running' | 'error', message }.
  setStatus(s) {
    if (!this.cam) return;
    if (s?.state === 'running') { this.status = 'running'; this.message = ''; }
    else if (s?.state === 'error') { this.status = 'error'; this.message = s.message || 'Presence stopped.'; this.notify(this.message); }
    this.onChange();
  }

  // From the camera page: one count of faces a second.
  frame(f) {
    if (!this.cam || !f || !Number.isFinite(f.faces)) return;
    this.faces = f.faces;
    const secs = Math.min(600, Math.max(10, Number(this.getConfig()?.awayAfter) || 60));
    this.tracker.awayAfterMs = secs * 1000;
    this.tracker.update({ faces: f.faces, t: this.now() });
  }
}

module.exports = { PresenceTracker, PresenceControl };
