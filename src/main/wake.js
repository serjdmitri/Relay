// "Hey Jarvis": listening for a wake phrase while Relay is idle. It uses the same on-device speech helper as dictation,
// so nothing is recorded and nothing leaves the Mac. The words are read into text, compared with the phrase, and thrown away.

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

// Does the text end with (or contain, near its end) the wake phrase? "Hey Jarvis" also matches "okay jarvis" and "hi jarvis".
function heardWake(text, phrase) {
  const heard = clean(text).split(' ').filter(Boolean).slice(-12);
  const want = clean(phrase).split(' ').filter(Boolean);
  if (!want.length || !heard.length) return false;
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
  constructor({ speech, getConfig, canListen, onWake, onArmed = () => {}, getDevice = () => 'auto', log = console, restartMs = 90000, setTimer = setTimeout, clearTimer = clearTimeout }) {
    this.speech = speech;
    this.getConfig = getConfig;
    this.canListen = canListen;
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
    this.onPartial = (text) => this.partial(text);
    speech.on('partial', this.onPartial);
  }

  get wanted() {
    const c = this.getConfig();
    return !!c.enabled && !!c.phrase && !!this.canListen();
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
    try { this.speech.cancel(); } catch {}
    this.onArmed(false);
  }

  partial(text) {
    if (!this.armed) return;
    const c = this.getConfig();
    if (!heardWake(text, c.phrase)) return;
    if (Date.now() - this.lastWake < 1500) return;
    this.lastWake = Date.now();
    this.disarm();
    this.onWake(text);
  }
}

module.exports = { WakeWord, heardWake, clean };
