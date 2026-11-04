// "Hey Jarvis" on the phone page. The phone's speech recogniser listens while the page is open, and when it hears the wake phrase the words after it become the command. Pure logic with the
// recogniser and timers passed in, so it is tested without a phone.
//
// What a web page on an iPhone can and cannot do: it listens only while the page is open and the screen is on (the page keeps the screen awake while this is on); locking the phone or switching apps
// stops it. It is not a background service like the Mac's.

// How the recogniser tends to hear it: "hey jarvis", "hey jarvus", "hey harvis", "a jarvis", "ok jarvis", or just "jarvis" at the start.
const NAME = '(?:jarvis|jarvus|jarvas|jervis|harvis|jarviss|jarvice)';
const WAKE = new RegExp(`(?:\\b(?:hey|hay|hi|hello|ok|okay|a|eh|yo)[,.!]?\\s+${NAME}\\b|^\\s*${NAME}\\b)`, 'i');

// -> { woke, command }: whether the wake phrase is in the text, and what was said after it (punctuation trimmed).
export function extractWake(text) {
  const t = String(text || '');
  const m = WAKE.exec(t);
  if (!m) return { woke: false, command: '' };
  const command = t.slice(m.index + m[0].length).replace(/^[\s,.:;!?-]+/, '').replace(/\s+/g, ' ').trim();
  return { woke: true, command };
}

export class WakeLoop {
  // makeRecognizer(): a new SpeechRecognition-like object (continuous, interim results). Callbacks: onWake(), onCommand(text), onGiveUp(), onState(state, detail).
  // quietMs: silence after a command that means "that is all"; waitMs: how long to wait for a command after only "hey Jarvis".
  constructor({ makeRecognizer, onWake = () => {}, onCommand = () => {}, onGiveUp = () => {}, onState = () => {}, quietMs = 1400, waitMs = 6000, setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = (t) => clearTimeout(t) } = {}) {
    Object.assign(this, { makeRecognizer, onWake, onCommand, onGiveUp, onState, quietMs, waitMs, setTimer, clearTimer });
    this.enabled = false; this.paused = false; this.rec = null; this.armed = false; this.command = '';
    this.timer = null; this.restartTimer = null; this.errors = 0;
  }

  start() { if (this.enabled) return; this.enabled = true; this.errors = 0; this.state('listening'); this.open(); }
  stop() { this.enabled = false; this.armed = false; this.close(); this.clearTimer(this.timer); this.clearTimer(this.restartTimer); this.state('off'); }
  // Pause while the phone is speaking or you are holding the reactor, so it does not hear itself.
  setPaused(paused) {
    paused = !!paused;
    if (paused === this.paused) return;
    this.paused = paused;
    if (paused) { this.close(); this.state('paused'); } else if (this.enabled) { this.state('listening'); this.open(); }
  }

  state(s, detail) { this.onState(s, detail); }
  close() { const r = this.rec; this.rec = null; if (r) { r.onend = null; r.onerror = null; r.onresult = null; try { r.abort ? r.abort() : r.stop(); } catch { /* already over */ } } }

  open() {
    if (!this.enabled || this.paused || this.rec) return;
    let r;
    try { r = this.makeRecognizer(); } catch { this.state('error', 'unsupported'); this.enabled = false; return; }
    this.rec = r; this.armed = false; this.command = '';
    r.onresult = (e) => this.heard(e);
    r.onerror = (e) => {
      const code = (e && e.error) || '';
      if (code === 'not-allowed' || code === 'service-not-allowed') { this.enabled = false; this.close(); this.state('blocked', code); return; }
      if (code === 'language-not-supported') { this.enabled = false; this.close(); this.state('error', code); return; }
      if (code !== 'no-speech' && code !== 'aborted') this.errors++;
    };
    r.onend = () => { if (this.rec === r) this.rec = null; this.again(); };
    try { r.start(); } catch { this.rec = null; this.errors++; this.again(); }
  }

  // The recogniser ends by itself every so often (and when nothing is said): start a fresh session after a short beat, slower after repeated trouble.
  again() {
    if (!this.enabled || this.paused) return;
    this.clearTimer(this.restartTimer);
    if (this.errors >= 8) { this.enabled = false; this.state('error', 'repeated'); return; }
    this.restartTimer = this.setTimer(() => this.open(), Math.min(5000, 250 + this.errors * 600));
  }

  heard(e) {
    const text = Array.from((e && e.results) || []).map((x) => (x && x[0] ? x[0].transcript : '')).join(' ');
    this.errors = 0;
    const m = extractWake(text);
    if (!this.armed) {
      if (!m.woke) return;
      this.armed = true; this.onWake(); this.state('heard');
    }
    this.command = m.woke ? m.command : this.command;
    this.clearTimer(this.timer);
    this.timer = this.setTimer(() => this.finish(), this.command ? this.quietMs : this.waitMs);
  }

  finish() {
    const command = this.command; this.armed = false; this.command = ''; this.timer = null;
    this.close(); // a new session, so the words just used are not heard again
    if (command) this.onCommand(command); else this.onGiveUp();
    this.again();
  }
}
