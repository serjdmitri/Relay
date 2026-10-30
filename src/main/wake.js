// "Hey Jarvis": listening for a wake phrase while Relay is idle. It uses the same on-device speech helper as dictation,
// so nothing is recorded and nothing leaves the Mac. The words are read into text, compared with the phrase, and thrown away.

const { wakeAllowedIn } = require('./conversation');

const GREETINGS = new Set(['hey', 'hi', 'ok', 'okay', 'hay', 'a', 'hello']);

const clean = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim();

function distance(a, b) {
  const m = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) m[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) m[i][j] = Math.min(m[i - 1][j] + 1, m[i][j - 1] + 1, m[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return m[a.length][b.length];
}

// Speech recognition mishears names, so a long word may be one letter off ("jarvus", "jervis").
const same = (heard, want) => heard === want || (want.length >= 5 && heard.length >= 4 && distance(heard, want) <= 1);

// A conservative two-impulse gate over the existing, on-device microphone level.
// Levels are sampled about 20 times per second, so a real microphone check is needed.
class ClapGate {
  constructor() { this.reset(); }
  reset() { this.high = false; this.first = null; this.until = 0; }
  level(value, now) {
    const high = Number(value) >= 0.55;
    if (!high) { this.high = false; return false; }
    if (this.high) return false;
    this.high = true;
    if (this.first !== null && now - this.first >= 120 && now - this.first <= 900) {
      this.first = null; this.until = now + 5000; return true;
    }
    this.first = now;
    return false;
  }
  ready(now) { return this.until > 0 && now <= this.until; }
}

// Does the text end with (or contain, near its end) the wake phrase? "Hey Jarvis" also matches "okay jarvis" and "hi jarvis".
function heardWake(text, phrase) {
  const heard = clean(text).split(' ').filter(Boolean).slice(-12);
  const want = clean(phrase).split(' ').filter(Boolean);
  if (!want.length || !heard.length) return false;
  // The default Jarvis phrase also accepts the explicit "Jarvis, wake up".
  // Custom phrases are left alone, and the complete wake-up wording is required.
  if (want.join(' ') === 'hey jarvis') {
    for (let i = 0; i + 2 < heard.length; i++) {
      if (same(heard[i], 'jarvis') && heard[i + 1] === 'wake' && heard[i + 2] === 'up') return true;
    }
  }
  const greeting = GREETINGS.has(want[0]);
  const name = greeting ? want.slice(1) : want;
  if (!name.length) return false;
  for (let i = 0; i + name.length <= heard.length; i++) {
    if (!name.every((w, k) => same(heard[i + k], w))) continue;
    if (!greeting) return true;
    const before = heard[i - 1];
    if (before && GREETINGS.has(before)) return true;
  }
  return false;
}

class WakeWord {
  // speech: the Speech wrapper (events 'partial', and listen()/cancel()).
  // getConfig(): { enabled, phrase }. canListen(): false while Relay is busy, speaking or being configured.
  constructor({ speech, getConfig, canListen, getFront = () => null, onWake, onArmed = () => {}, getDevice = () => 'auto', log = console, restartMs = 90000, setTimer = setTimeout, clearTimer = clearTimeout }) {
    this.speech = speech;
    this.getConfig = getConfig;
    this.canListen = canListen;
    this.getFront = getFront; // the app in front (only asked when the wake phrase is limited to some apps)
    this.onWake = onWake;
    this.onArmed = onArmed;
    this.getDevice = getDevice;
    this.log = log;
    this.restartMs = restartMs;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.armed = false;
    this.arming = false;
    this.timer = null;
    this.retry = null;
    this.errors = 0;
    this.lastWake = 0;
    this.claps = new ClapGate();
    this.lastPartial = '';
    this.clapPrefix = '';
    this.onPartial = (text) => this.partial(text);
    speech.on('partial', this.onPartial);
    speech.on('level', (level) => {
      if (!this.armed || !this.getConfig().requireClaps) return;
      if (this.claps.level(level, Date.now())) this.clapPrefix = clean(this.lastPartial);
    });
  }

  get wanted() {
    const c = this.getConfig();
    return !!c.enabled && !!c.phrase && !!this.canListen() && wakeAllowedIn(c.apps, c.apps && c.apps.length ? this.getFront() : null);
  }

  // Start or stop listening to match what should be happening right now. Safe to call as often as you like.
  async refresh() {
    if (this.wanted) await this.arm();
    else this.disarm();
  }

  async arm() {
    if (this.armed || this.arming) return;
    this.arming = true;
    try {
      await this.speech.listen(this.getDevice());
      if (!this.wanted) { this.speech.cancel(); return; } // things changed while the microphone opened
      this.armed = true;
      this.errors = 0;
      this.onArmed(true);
      this.clearTimer(this.timer);
      this.timer = this.setTimer(() => this.cycle(), this.restartMs); // a fresh session now and then keeps the recogniser light
    } catch (e) {
      this.log.error?.('wake word:', e.message);
      this.errors++;
      this.onArmed(false);
      if (this.errors < 5) { // the microphone may just be busy: try again in a moment
        this.clearTimer(this.retry);
        this.retry = this.setTimer(() => this.refresh(), 2000 * this.errors);
      }
    } finally {
      this.arming = false;
    }
  }

  cycle() {
    this.disarm();
    this.setTimer(() => this.refresh(), 400);
  }

  disarm() {
    this.clearTimer(this.timer);
    this.clearTimer(this.retry);
    if (!this.armed) return;
    this.armed = false;
    this.claps.reset();
    this.lastPartial = '';
    this.clapPrefix = '';
    try { this.speech.cancel(); } catch {}
    this.onArmed(false);
  }

  partial(text) {
    if (!this.armed) return;
    const c = this.getConfig();
    this.lastPartial = text;
    let candidate = text;
    if (c.requireClaps) {
      if (!this.claps.ready(Date.now())) return;
      const current = clean(text);
      if (this.clapPrefix && !current.startsWith(`${this.clapPrefix} `)) return;
      candidate = this.clapPrefix ? current.slice(this.clapPrefix.length).trim() : current;
    }
    if (!heardWake(candidate, c.phrase)) return;
    if (Date.now() - this.lastWake < 1500) return;
    this.lastWake = Date.now();
    this.disarm();
    this.onWake(text);
  }
}

module.exports = { WakeWord, ClapGate, heardWake, clean };
