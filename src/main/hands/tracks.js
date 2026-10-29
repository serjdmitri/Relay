// Keep two cursor identities stable when the detector reorders its results.
// Prefer its handedness label; otherwise associate with the nearest last position.
class HandTracks {
  constructor(count = 2) { this.count = Math.max(1, Math.min(4, count)); this.slots = Array(this.count).fill(null); }
  update(hands) {
    const remaining = (hands || []).filter(h => h && h.score !== 0).slice(0, this.count);
    const next = Array(this.count).fill(null);
    for (let i = 0; i < this.count; i++) {
      const prev = this.slots[i];
      if (!prev?.handed) continue;
      // Two people can both present the same handedness. Match the closest
      // hand with that label, not whichever the detector returned first.
      let j = -1, closest = Infinity;
      for (let k = 0; k < remaining.length; k++) {
        const h = remaining[k];
        if (!h.handed || h.handed !== prev.handed) continue;
        const distance = Math.hypot(prev.x - h.x, prev.y - h.y);
        if (distance < closest) { closest = distance; j = k; }
      }
      if (j >= 0) next[i] = remaining.splice(j, 1)[0];
    }
    while (remaining.length) {
      let best = null;
      for (let i = 0; i < this.count; i++) {
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
  reset() { this.slots = Array(this.count).fill(null); }
}
module.exports = { HandTracks };
