// One question, asked in more than one place (the Mac and your phone). The first answer wins and the others are told it is settled.
// What happens when nobody answers is your choice: expire (default, after 30 minutes), ask again every hour up to 3 times, or wait forever.

const MIN = 60000;

class ConfirmHub {
  constructor({ unanswered = () => 'expire', ttlMs = 30 * MIN, reaskMs = 60 * MIN, now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
    this.unanswered = unanswered; // () => 'expire' | 'reask' | 'forever'
    this.ttlMs = ttlMs;
    this.reaskMs = reaskMs;
    this.now = now;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.items = new Map();
    this.listeners = { open: [], settle: [], reask: [] };
  }

  on(event, fn) { this.listeners[event].push(fn); }

  emit(event, ...args) { for (const fn of this.listeners[event]) { try { fn(...args); } catch { /* a listener must not break the others */ } } }

  // Opens a question. Returns { id, answer } where answer resolves to { yes, by } (by: the source that answered, or 'expired').
  open({ id, question, origin = '' }) {
    if (this.items.has(id)) return { id, answer: this.items.get(id).promise };
    const item = { id, question, origin, asked: this.now(), reasks: 0, timer: null, settled: false };
    item.promise = new Promise((resolve) => { item.resolve = resolve; });
    this.items.set(id, item);
    this.emit('open', item);
    this.arm(item);
    return { id, answer: item.promise };
  }

  arm(item) {
    this.clearTimer(item.timer);
    const mode = this.unanswered();
    if (mode === 'forever') return;
    if (mode === 'reask') {
      item.timer = this.setTimer(() => {
        if (item.settled) return;
        if (item.reasks >= 3) return this.settle(item, false, 'expired');
        item.reasks++;
        this.emit('reask', item, item.reasks);
        this.arm(item);
      }, this.reaskMs);
      return;
    }
    item.timer = this.setTimer(() => this.settle(item, false, 'expired'), this.ttlMs);
  }

  // An answer from one place. Only the first counts; returns whether this one was it.
  answer(id, yes, by) {
    const item = this.items.get(id);
    if (!item || item.settled) return false;
    this.settle(item, !!yes, by);
    return true;
  }

  settle(item, yes, by) {
    if (item.settled) return;
    item.settled = true;
    this.clearTimer(item.timer);
    this.items.delete(item.id);
    item.resolve({ yes, by });
    this.emit('settle', item, { yes, by });
  }

  pending() { return [...this.items.values()].map((i) => ({ id: i.id, question: i.question, origin: i.origin, asked: i.asked })); }

  // The most recent open question: what a bare "yes" or "no" text is answering.
  latest() { const p = this.pending(); return p.length ? p[p.length - 1] : null; }
}

// "yes", "yep, do it", "no", "don't" ... or null when the text is not an answer.
function parseAnswer(text) {
  const t = String(text || '').trim().toLowerCase().replace(/[.!]+$/, '');
  if (/^(?:y|yes|yep|yeah|yup|sure|ok|okay|do it|go ahead|go for it|approve|confirm|send it|please do)(?:\b.*)?$/.test(t) && t.length <= 24) return true;
  if (/^(?:n|no|nope|nah|don'?t|do not|stop|cancel|deny|decline|never mind|skip it)(?:\b.*)?$/.test(t) && t.length <= 24) return false;
  return null;
}

module.exports = { ConfirmHub, parseAnswer };
