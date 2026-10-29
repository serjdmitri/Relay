// Keep two cursor identities stable when the detector reorders its results.
// Prefer its handedness label; otherwise associate with the nearest last position.
class HandTracks {
  constructor() { this.slots = [null, null]; }
  update(hands) {
    const remaining = (hands || []).filter(h => h && h.score !== 0).slice(0, 2);
    const next = [null, null];
    for (let i = 0; i < 2; i++) {
      const prev = this.slots[i];
      if (!prev?.handed) continue;
      const j = remaining.findIndex(h => h.handed && h.handed === prev.handed);
      if (j >= 0) next[i] = remaining.splice(j, 1)[0];
    }
    while (remaining.length) {
      let best = null;
      for (let i = 0; i < 2; i++) {
        if (next[i]) continue;
        for (let j = 0; j < remaining.length; j++) {
          const p = this.slots[i];
          const distance = p ? Math.hypot(p.x - remaining[j].x, p.y - remaining[j].y) : Infinity;
          if (!best || distance < best.distance) best = { i, j, distance };
        }
      }
      if (!best) break;
      next[best.i] = remaining.splice(best.j, 1)[0];
    }
    this.slots = next;
    return next;
  }
  reset() { this.slots = [null, null]; }
}
module.exports = { HandTracks };
