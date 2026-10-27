// The activity log's one-tap undo: for actions Relay took that can be reversed, the way to reverse them is kept here (in memory, so it lasts until Relay
// quits; what a restart cannot undo is not offered). Each can be used once. Pure.

class UndoRegistry {
  constructor({ max = 80 } = {}) {
    this.max = max;
    this.map = new Map(); // action id -> { fn, label }
  }

  register(id, fn, label = '') {
    if (!id || typeof fn !== 'function') return;
    this.map.set(id, { fn, label });
    while (this.map.size > this.max) this.map.delete(this.map.keys().next().value);
  }

  has(id) { return this.map.has(id); }
  ids() { return new Set(this.map.keys()); }

  // Reverses it once. Returns { ok, message }.
  async run(id) {
    const u = this.map.get(id);
    if (!u) return { ok: false, message: 'That cannot be undone any more.' };
    this.map.delete(id);
    try { return { ok: true, message: String(await u.fn()) }; } catch (e) { return { ok: false, message: `Could not undo it: ${e.message}` }; }
  }
}

module.exports = { UndoRegistry };
