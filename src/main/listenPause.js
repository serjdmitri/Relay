// "Pause listening": switch "Hey Jarvis" (and the answers to questions you overhear, which ride on it) off for a while, by voice, without going into Settings. For a meeting, a call, a
// nap, a movie. "Pause listening for an hour" resumes by itself; plain "pause listening" stays paused until you resume it. While it is paused the microphone is not opened at all
// for the wake phrase; the Option key (push to talk) and typing still work, and so does "resume listening" said that way, or the menu bar item. Not saved: restarting Relay listens again.
// Pure: the clock and the timer are passed in.

const { parseDuration } = require('./when');

class ListenPause {
  constructor({ now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout, onChange = () => {} } = {}) { Object.assign(this, { now, setTimer, clearTimer, onChange }); this.until = null; this.on = false; this.timer = null; }

  // seconds: how long, or null for "until I say so".
  pause(seconds = null) {
    this.clearTimer(this.timer); this.timer = null;
    const s = Number(seconds);
    this.on = true;
    this.until = Number.isFinite(s) && s > 0 ? this.now() + Math.min(s, 24 * 3600) * 1000 : null;
    if (this.until) { this.timer = this.setTimer(() => this.resume(), this.until - this.now() + 50); this.timer?.unref?.(); }
    this.onChange();
  }

  resume() { const was = this.paused(); this.clearTimer(this.timer); this.timer = null; this.on = false; this.until = null; if (was) this.onChange(); return was; }

  // Checked every time the wake phrase is considered, so a missed timer can never leave it off.
  paused() {
    if (!this.on) return false;
    if (this.until && this.now() >= this.until) { this.on = false; this.until = null; return false; }
    return true;
  }

  describe() {
    if (!this.paused()) return 'I am listening for Hey Jarvis.';
    if (!this.until) return 'Listening is paused until you say resume.';
    const m = Math.max(1, Math.round((this.until - this.now()) / 60000));
    return `Listening is paused for about ${m >= 90 ? Math.round(m / 60) + ' more hours' : m + ' more minute' + (m === 1 ? '' : 's')}.`;
  }
}

// "pause listening", "pause listening for an hour", "stop listening for 30 minutes", "mute hey jarvis", "resume listening", "start listening again"
function parseListenCommand(text) {
  const n = String(text || '').trim().replace(/[“”"]/g, '').replace(/^(?:hey |ok |okay )?(?:jarvis|relay)[, ]+/i, '').replace(/^please[, ]+/i, '').replace(/[.!?,]+$/g, '').replace(/\s+/g, ' ').toLowerCase();
  if (/^(?:resume|restart|unpause|start|turn on|continue) (?:listening|hey jarvis|the wake word)(?: again)?$|^(?:start|begin) listening again$|^(?:you can )?listen again$/.test(n)) return { type: 'listen-resume' };
  if (/^(?:are you|is jarvis) (?:still )?(?:listening|paused)$|^listening status$/.test(n)) return { type: 'listen-status' };
  const m = /^(?:pause|stop|mute|silence|turn off|disable) (?:the )?(?:listening|hey jarvis|the wake word|wake word|voice activation)(?: (?:for|during|over)(?: the next)? (.+?))?$/.exec(n);
  if (m) {
    if (!m[1]) return { type: 'listen-pause', seconds: null };
    const s = parseDuration(m[1].replace(/^a (?=\d)/, ''));
    return s ? { type: 'listen-pause', seconds: s } : null;
  }
  return null;
}

module.exports = { ListenPause, parseListenCommand };
