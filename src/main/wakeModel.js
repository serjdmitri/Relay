// The dedicated "Hey Jarvis" detector. A small hidden page (wakemodel.html) listens on the microphone with a tiny on-device model, instead of running full speech
// recognition all day. This class decides when that page should be open, ignores what it hears while Relay is busy, and says when the older speech-based wake word
// should stay off because this one is covering it. If the page cannot start (microphone refused, model missing), it gives up after a few tries and the speech-based
// wake word keeps working as before. The page is injected, so all of this is tested without Electron.

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

class WakeModelControl {
  // createPage(): { close(), send(channel, payload) } for the hidden page. getConfig(): { enabled, mode, phrase, engine, ambient, threshold }.
  // canWake(): is Relay idle and allowed to wake right now? onWake(): start listening. onState(): the covering state changed (the speech wake word re-checks itself).
  constructor({ createPage, getConfig, canWake, onWake, onState = () => {}, log = console, now = Date.now, failLimit = 3, setTimer = setTimeout, clearTimer = clearTimeout }) {
    Object.assign(this, { createPage, getConfig, canWake, onWake, onState, log, now, failLimit, setTimer, clearTimer });
    this.page = null;
    this.state = 'off'; // off | loading | listening | failed
    this.errors = 0;
    this.lastWake = -Infinity;
    this.vad = { p: 0, at: 0 };
    this.watchSent = 0;
    this.retry = null;
    this.generation = 0;
  }

  // Does the setting ask for this detector? It only knows "hey jarvis", only for the plain phrase mode, and it leaves ambient answers (which read the speech text) to the speech engine.
  get wantedByConfig() {
    const c = this.getConfig() || {};
    return !!c.enabled && c.engine !== 'speech' && (c.mode || 'voice') === 'voice' && norm(c.phrase || 'hey jarvis') === 'hey jarvis' && !c.ambient && this.state !== 'failed';
  }

  // True while this detector is really listening, so the speech-based wake word stays off.
  get covers() { return this.wantedByConfig && this.state === 'listening'; }

  // Open or close the page to match the settings. Safe to call as often as you like.
  async refresh() {
    if (this.state === 'failed' && this.failedAt && this.now() - this.failedAt > 600000) { this.state = 'off'; this.errors = 0; this.failedAt = 0; } // another chance after ten minutes
    const want = this.wantedByConfig;
    if (want && !this.page && !this.retry) return this.open();
    if (!want && this.page) this.close();
    if (!want && this.state === 'failed' && (this.getConfig() || {}).engine === 'speech') { this.state = 'off'; this.errors = 0; }
  }

  open() {
    const generation = ++this.generation;
    this.state = 'loading';
    try {
      this.page = this.createPage({ onClosed: () => this.pageClosed(generation) }) || null;
      if (!this.page) { this.state = 'off'; return; } // the app has not set the page up yet: the next refresh opens it, and this is not counted as a failure
    } catch (e) {
      this.log.error?.('wake model page:', e && e.message);
      this.page = null;
      return this.failure('The page would not open.');
    }
    this.onState();
  }

  close() {
    this.generation++;
    this.clearTimer(this.retry); this.retry = null;
    const p = this.page;
    this.page = null;
    const was = this.state;
    if (this.state !== 'failed') this.state = 'off';
    try { p && p.close(); } catch { /* already gone */ }
    if (was !== this.state || was === 'listening') this.onState();
  }

  pageClosed(generation) {
    if (generation !== this.generation) return;
    this.page = null;
    if (this.state !== 'failed') this.state = 'off';
    this.onState();
    if (this.wantedByConfig) this.failure('The page closed.');
  }

  // A report from the page: { state: 'listening' } when the microphone and models are ready, { state: 'error', message } when they are not.
  status(st = {}) {
    if (!this.page) return;
    if (st.state === 'listening') { this.errors = 0; if (this.state !== 'listening') { this.state = 'listening'; this.log.info?.('wake model listening'); this.onState(); } return; }
    if (st.state === 'error') { const p = this.page; this.page = null; this.generation++; try { p.close(); } catch { /* gone */ } this.failure(String(st.message || 'error').slice(0, 160)); }
  }

  failure(why) {
    this.errors++;
    this.log.warn?.('wake model:', why, 'attempt', this.errors);
    this.clearTimer(this.retry); this.retry = null;
    if (this.errors >= this.failLimit) { this.state = 'failed'; this.failedAt = this.now(); this.lastError = why; this.onState(); return; }
    this.state = 'off';
    // the retry is set first, so the state change below cannot cause an instant second attempt
    this.retry = this.setTimer(() => { this.retry = null; this.refresh().catch(() => {}); }, 2000 * this.errors);
    this.retry && this.retry.unref && this.retry.unref();
    this.onState();
  }

  // The page heard the phrase. Ignored while Relay is busy, speaking, or not meant to wake.
  heard(score = 1) {
    if (!this.page || !this.covers) return false;
    if (!this.canWake()) return false;
    if (this.now() - this.lastWake < 1500) return false;
    this.lastWake = this.now();
    this.onWake('', score);
    return true;
  }

  // Voice reports from the page (only while someone is being listened to): the chance that a voice, not a fan or a TV, is speaking.
  voice(p) { this.vad = { p: Math.max(0, Math.min(1, Number(p) || 0)), at: this.now() }; }

  // The latest voice chance, or null when there is no fresh reading (then the caller falls back to the loudness check).
  voiceChance() { return this.page && this.state === 'listening' && this.now() - this.vad.at < 600 ? this.vad.p : null; }

  // Ask the page to report voice for the next couple of seconds. Cheap to call often.
  watch() {
    if (!this.page || this.state !== 'listening') return;
    const t = this.now();
    if (t - this.watchSent < 700) return;
    this.watchSent = t;
    try { this.page.send('wakemodel:watch', true); } catch { /* the page is going away */ }
  }
}

module.exports = { WakeModelControl };
