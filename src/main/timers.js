// Timers and alarms. They are saved, so a restart does not lose them; one that came due while Relay was
// closed fires on the next launch, marked as missed.

const crypto = require('crypto');

function humanDuration(seconds) {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s} second${s === 1 ? '' : 's'}`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const parts = [];
  if (h) parts.push(`${h} hour${h === 1 ? '' : 's'}`);
  if (m) parts.push(`${m} minute${m === 1 ? '' : 's'}`);
  if (!h && sec && m < 5) parts.push(`${sec} second${sec === 1 ? '' : 's'}`);
  return parts.join(' ') || '0 seconds';
}

class Timers {
  constructor({ store, onFire, now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout }) {
    this.store = store;
    this.onFire = onFire;
    this.now = now;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.handles = new Map();
  }

  get items() {
    return this.store.get('timers') || [];
  }

  start() {
    for (const t of [...this.items]) this._schedule(t);
  }

  _schedule(t) {
    const wait = t.endsAt - this.now();
    if (wait <= 0) return this._fire(t, true);
    // setTimeout caps near 24 days; re-check in long hops
    const hop = Math.min(wait, 2 ** 30);
    this.handles.set(t.id, this.setTimer(() => (this.now() >= t.endsAt - 50 ? this._fire(t, false) : this._schedule(t)), hop));
  }

  _fire(t, missed) {
    this.handles.delete(t.id);
    this.store.data.timers = this.items.filter((x) => x.id !== t.id);
    this.store.save();
    this.onFire({ ...t, missed });
  }

  add(seconds, label = '') {
    const t = { id: crypto.randomUUID(), endsAt: this.now() + seconds * 1000, seconds, label };
    this.store.data.timers = [...this.items, t];
    this.store.save();
    this._schedule(t);
    return t;
  }

  list() {
    return [...this.items].sort((a, b) => a.endsAt - b.endsAt);
  }

  remainingSeconds(t) {
    return Math.max(0, Math.round((t.endsAt - this.now()) / 1000));
  }

  cancel(id) {
    const had = this.items.some((t) => t.id === id);
    this.clearTimer(this.handles.get(id));
    this.handles.delete(id);
    this.store.data.timers = this.items.filter((t) => t.id !== id);
    this.store.save();
    return had;
  }

  cancelAll() {
    const n = this.items.length;
    for (const t of this.items) this.clearTimer(this.handles.get(t.id));
    this.handles.clear();
    this.store.data.timers = [];
    this.store.save();
    return n;
  }
}

module.exports = { Timers, humanDuration };
