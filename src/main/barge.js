// Interrupt by talking: while Relay is speaking, the microphone listens (on this Mac, like the wake phrase). If you say stop, or start talking over it,
// it stops mid-sentence. Relay's own voice also reaches the microphone, so conversation.js compares what is heard with what is being said.

const { interruption } = require('./conversation');

class BargeIn {
  // speech: the Speech wrapper. getConfig(): { enabled, mode }. getSpoken(): the text being spoken. onInterrupt(kind, heard): 'stop' | 'talk'.
  constructor({ speech, getConfig, getSpoken, getDevice = () => 'auto', onInterrupt, log = console, settleMs = 900, setTimer = setTimeout, clearTimer = clearTimeout }) {
    Object.assign(this, { speech, getConfig, getSpoken, getDevice, onInterrupt, log, settleMs, setTimer, clearTimer });
    this.armed = false;
    this.arming = false;
    this.since = 0;
    this.timer = null;
    this.onPartial = (text) => this.partial(text);
    speech.on('partial', this.onPartial);
  }

  async arm() {
    const c = this.getConfig() || {};
    if (!c.enabled || this.armed || this.arming) return;
    this.arming = true;
    const epoch = this.epoch = (this.epoch || 0) + 1;
    try {
      const result = await this.speech.listen(this.getDevice(), { echoCancellation: c.echoCancellation === true });
      if (c.echoCancellation && result?.echoActive !== true) this.log.warn?.('Microphone echo processing is unavailable on the selected audio route.');
      if (this.epoch !== epoch) return;
      this.armed = true;
      this.since = Date.now();
    } catch (e) {
      this.log.error?.('interrupt by talking:', e.message); // the microphone may be busy: it simply does not listen this time
    } finally {
      if (this.epoch === epoch) this.arming = false;
    }
  }

  disarm() {
    this.clearTimer(this.timer);
    this.epoch = (this.epoch || 0) + 1;
    const active = this.armed || this.arming;
    this.armed = this.arming = false;
    if (!active) return;
    try { this.speech.cancel(); } catch {}
  }

  partial(text) {
    if (!this.armed) return;
    if (Date.now() - this.since < this.settleMs && !/^\s*(?:stop|quiet)\b/i.test(text)) return; // the first moments are only the start of its own voice
    const c = this.getConfig() || {};
    const kind = interruption(text, this.getSpoken(), { mode: c.mode === 'word' ? 'word' : 'talk' });
    if (!kind) return;
    this.disarm();
    this.onInterrupt(kind, text);
  }
}

module.exports = { BargeIn };
