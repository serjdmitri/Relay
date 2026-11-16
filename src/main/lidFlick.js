// Lid flick: a quick small flick of the MacBook's lid (open a little and back, or close a little and back) sends the current item to your paired phone.
// Three plain parts, so each can be tested without a Mac lid: the detector (angles in, "that was a flick" out), the sensor (the native helper that reads the angle,
// behind a tiny interface: start({ onAngle, onState }) and stop(), which tests replace with a replay of fake angles), and LidFlick, which decides what to send and whether to.

const { spawn } = require('child_process');
const fs = require('fs');

const ACTIONS = ['finder', 'clipboard', 'screenshot'];

// Reads lid angles (degrees, whole numbers) with their times (ms) and says when a deliberate flick happened: the lid was still, moved a few degrees quickly, and came back
// to where it was, all within a moment. Opening or closing the lid for real (it keeps going), a slow wobble, a nudge of the desk, a sleep and a wake are not flicks.
class LidFlickDetector {
  constructor({ restMs = 300, restTol = 1.5, minPeak = 6, maxPeak = 40, minSpeed = 60, returnTol = 3, maxMs = 900, gapMs = 2500, cooldownMs = 3000, minAngle = 20 } = {}) {
    Object.assign(this, { restMs, restTol, minPeak, maxPeak, minSpeed, returnTol, maxMs, gapMs, cooldownMs, minAngle });
    this.reset();
  }

  reset() {
    this.mode = 'rest'; // rest: the lid is (about) still at base; out: it has left base and may come back
    this.base = null; this.stableSince = null; this.lastT = null; this.lastAngle = null;
    this.out = null; this.firedAt = -Infinity;
    this.last = null; // how the latest excursion ended: { fired, reason, peak, speed, ms, dir }, for tuning
  }

  // angle in degrees, t in ms. True once per flick.
  push(angle, t) {
    angle = Number(angle); t = Number(t);
    if (!Number.isFinite(angle) || !Number.isFinite(t)) return false;
    if (this.lastT !== null && t < this.lastT) return false; // out of order
    if (this.lastT !== null && t - this.lastT > this.gapMs) { // the Mac slept, or the sensor went quiet: whatever was going on is over
      this.mode = 'rest'; this.out = null; this.base = angle; this.stableSince = t; this.lastT = t; this.lastAngle = angle;
      return false;
    }
    const prevT = this.lastT, prevAngle = this.lastAngle;
    this.lastT = t; this.lastAngle = angle;
    if (this.base === null) { this.base = angle; this.stableSince = t; return false; }

    if (this.mode === 'rest') {
      if (Math.abs(angle - this.base) <= this.restTol) return false; // still
      const rested = t - this.stableSince >= this.restMs && this.base >= this.minAngle && t - this.firedAt >= this.cooldownMs;
      if (!rested) { this.base = angle; this.stableSince = t; return false; } // just moving about (opening, closing, settling): look from here
      const dt = Math.max(5, Math.min(t - prevT, 100)); // the lid was still until a moment ago, so the first step cannot have taken longer than a poll
      this.mode = 'out';
      this.out = { start: t - dt, sign: angle > this.base ? 1 : -1, peak: Math.abs(angle - this.base), speed: Math.abs(angle - prevAngle) / (dt / 1000) };
      return this._outStep(angle, t);
    }
    return this._outStep(angle, t, prevT, prevAngle);
  }

  _outStep(angle, t, prevT, prevAngle) {
    const o = this.out, dev = angle - this.base;
    if (prevT !== undefined && t - prevT >= 20) o.speed = Math.max(o.speed, Math.abs(angle - prevAngle) / ((t - prevT) / 1000)); // a step needs a measurable time
    o.peak = Math.max(o.peak, Math.abs(dev));
    const ms = t - o.start;
    const finish = (fired, reason) => {
      this.last = { fired, reason, peak: o.peak, speed: Math.round(o.speed), ms, dir: o.sign > 0 ? 'open' : 'close' };
      this.mode = 'rest'; this.out = null; this.base = angle; this.stableSince = t;
      if (fired) this.firedAt = t;
      return fired;
    };
    if (o.peak > this.maxPeak) return finish(false, 'too far: that is opening or closing the lid');
    if (Math.abs(dev) > this.returnTol) o.left = true; // it has really left; before that, "near base" is just the start of the move
    if (o.left ? Math.abs(dev) <= this.returnTol : Math.abs(dev) <= this.restTol) {
      if (o.peak < this.minPeak) return finish(false, 'too small');
      if (o.speed < this.minSpeed) return finish(false, 'too slow');
      return finish(true, 'flick');
    }
    if (ms > this.maxMs) return finish(false, 'did not come back');
    return false;
  }
}

// The native helper (native/relay-lid) that reads the lid angle. It prints JSON lines: {"angle":99,"t":ms}, {"ready":true,...}, {"error":"no-sensor"}.
// state: off | starting | on | no-sensor | failed. A helper that keeps dying is given up on; one that says this Mac has no sensor is not started again.
class LidSensor {
  constructor({ binPath, spawnFn = spawn, exists = (p) => fs.existsSync(p), log = () => {} }) {
    Object.assign(this, { binPath, spawnFn, exists, log });
    this.child = null; this.state = 'off'; this.deaths = 0; this.handlers = null; this.retry = null;
  }

  get available() { return !!this.binPath && this.exists(this.binPath); }

  start(handlers = {}) {
    this.handlers = handlers;
    if (this.child || this.state === 'no-sensor' || this.state === 'failed') return this.state;
    if (!this.available) return this._set('failed', 'the lid helper is missing');
    const child = this.spawnFn(this.binPath, [], { stdio: ['pipe', 'pipe', 'ignore'] });
    this.child = child; this._set('starting');
    let buf = '';
    child.stdin?.on?.('error', () => {});
    child.stdout?.on('data', (d) => {
      buf += String(d);
      let i;
      while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (line) this._line(line, child); }
    });
    child.on('error', () => this._died(child));
    child.on('exit', () => this._died(child));
    return this.state;
  }

  _line(line, child) {
    let m; try { m = JSON.parse(line); } catch { return; }
    if (this.child !== child || !m || typeof m !== 'object') return;
    if (m.error === 'no-sensor') { this._set('no-sensor', 'this Mac has no lid angle sensor'); this._kill(); return; }
    if (m.error) { this.log(`lid helper error: ${m.error}`); return; }
    if (m.ready && this.state !== 'on') this._set('on');
    if (Number.isFinite(m.angle) && Number.isFinite(m.t)) { if (this.state !== 'on') this._set('on'); this.deaths = 0; this.handlers?.onAngle?.(m.angle, m.t); }
  }

  _died(child) {
    if (this.child !== child) return;
    this.child = null;
    if (this.state === 'no-sensor' || this.state === 'off') return;
    this.deaths += 1;
    if (this.deaths >= 3) { this._set('failed', 'the lid helper keeps stopping'); return; }
    this._set('starting');
    this.retry = setTimeout(() => { this.retry = null; if (this.handlers && this.state === 'starting') this.start(this.handlers); }, 2000 * this.deaths);
    this.retry.unref?.();
  }

  _set(state, why) { if (state !== this.state) { this.state = state; if (why) this.log(why); this.handlers?.onState?.(state); } return state; }

  _kill() { const c = this.child; this.child = null; if (!c) return; try { c.stdin?.end?.(); } catch {} setTimeout(() => { try { c.kill(); } catch {} }, 300).unref?.(); }

  stop() {
    clearTimeout(this.retry); this.retry = null;
    this.handlers = null;
    this._kill();
    if (this.state !== 'no-sensor' && this.state !== 'failed') this.state = 'off';
  }
}

// Wires it together: angles from the sensor go to the detector; a flick fetches what the chosen action means and hands it to the phone.
// Nothing is gathered or sent unless the feature is on, the Mac is unlocked, a phone is paired and connected, and there is something to send.
class LidFlick {
  // sensor: { start({ onAngle, onState }), stop(), state }; getSettings() -> { enabled, action }; isLocked() -> bool;
  // phone: { deliver(item) -> { ok, reason } , status() -> { paired: n, connected: n } }; items: { finder(), clipboard(), screenshot() } -> item | null (async)
  constructor({ sensor, detector = new LidFlickDetector(), getSettings, isLocked = () => false, phone, items, notify = () => {}, log = () => {}, now = Date.now }) {
    Object.assign(this, { sensor, detector, getSettings, isLocked, phone, items, notify, log, now });
    this.running = false; this.busy = false; this.lastResult = null;
  }

  get settings() {
    const s = this.getSettings?.() || {};
    return { enabled: s.enabled === true, action: ACTIONS.includes(s.action) ? s.action : 'finder' };
  }

  // Makes the sensor match the setting: reading while it is on, not at all (no helper running) while it is off.
  sync() {
    const on = this.settings.enabled;
    if (on && !this.running) { this.running = true; this.detector.reset(); this.sensor.start({ onAngle: (a, t) => this.onAngle(a, t), onState: () => this.onState?.() }); }
    else if (!on && this.running) { this.running = false; this.sensor.stop(); }
    return this.running;
  }

  stop() { this.running = false; this.sensor.stop(); }

  onAngle(angle, t) {
    if (!this.running) return false;
    const fired = this.detector.push(angle, t);
    if (fired) this.flick().catch(() => {});
    return fired;
  }

  // What a flick does. Resolves to { sent, reason, name? } and remembers it in lastResult.
  async flick() {
    const done = (r) => { this.lastResult = { ...r, at: this.now() }; this.log(`flick: ${r.sent ? `sent ${r.name}` : `not sent (${r.reason})`}; ${JSON.stringify(this.detector.last)}`); return r; };
    if (!this.settings.enabled) return done({ sent: false, reason: 'off' });
    if (this.busy) return done({ sent: false, reason: 'busy' });
    if (this.isLocked()) return done({ sent: false, reason: 'locked' });
    const st = this.phone.status();
    if (!st.paired) return done({ sent: false, reason: 'not-paired' });
    if (!st.connected) { this.notify('Your phone is not connected, so nothing was sent.'); return done({ sent: false, reason: 'phone-offline' }); }
    this.busy = true;
    try {
      const action = this.settings.action;
      let item = null;
      try { item = await this.items[action](); } catch (e) { return done({ sent: false, reason: 'gather-failed' }); }
      if (!item || !item.bytes?.length) { this.notify(NOTHING[action]); return done({ sent: false, reason: 'nothing' }); }
      if (this.isLocked()) return done({ sent: false, reason: 'locked' }); // it locked while the item was being gathered
      const r = this.phone.deliver(item);
      if (!r?.ok) { if (r?.reason === 'too-big') this.notify('That is too big to send to your phone (30 MB at most).'); return done({ sent: false, reason: r?.reason || 'not-delivered' }); }
      this.notify(`Sent ${item.name} to your phone.`);
      return done({ sent: true, reason: 'sent', name: item.name });
    } finally { this.busy = false; }
  }

  info() {
    const s = this.settings;
    return { enabled: s.enabled, action: s.action, state: this.running ? this.sensor.state : 'off', last: this.lastResult };
  }
}

const NOTHING = {
  finder: 'Select a file in Finder first, then flick the lid.',
  clipboard: 'The clipboard is empty, so there is nothing to send.',
  screenshot: 'Relay\'s window could not be captured, so nothing was sent.'
};

module.exports = { LidFlickDetector, LidSensor, LidFlick, ACTIONS };
