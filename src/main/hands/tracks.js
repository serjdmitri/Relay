// Assign detector results to stable cursor slots. Handedness is only a hint:
// several people can present the same hand and the detector can relabel one.
const MAX_DISTANCE = 0.35;
const LABEL_PENALTY = 0.08;
const MISSING_FRAMES = 5;

class HandTracks {
  constructor(count = 2) { this.count = Math.max(1, Math.min(4, count)); this.reset(); }

  update(hands) {
    const input = (hands || []).filter((h) => h && h.score !== 0 && Number.isFinite(h.x) && Number.isFinite(h.y)).slice(0, this.count);
    let best = { count: -1, cost: Infinity, assignments: [] };
    // At most four hands: find the globally closest assignment, avoiding the
    // slot-order bias of picking each hand greedily.
    const visit = (slot, used, assignments, matched, cost) => {
      if (slot === this.count) {
        if (matched > best.count || (matched === best.count && cost < best.cost)) best = { count: matched, cost, assignments: [...assignments] };
        return;
      }
      assignments[slot] = -1;
      visit(slot + 1, used, assignments, matched, cost);
      const previous = this.slots[slot];
      if (!previous) return;
      for (let i = 0; i < input.length; i++) {
        if (used.has(i)) continue;
        const hand = input[i];
        const distance = Math.hypot(previous.x - hand.x, previous.y - hand.y);
        if (distance > MAX_DISTANCE) continue;
        const penalty = previous.handed && hand.handed && previous.handed !== hand.handed ? LABEL_PENALTY : 0;
        used.add(i); assignments[slot] = i;
        visit(slot + 1, used, assignments, matched + 1, cost + distance + penalty);
        used.delete(i);
      }
      assignments[slot] = -1;
    };
    visit(0, new Set(), [], 0, 0);
    const output = Array(this.count).fill(null);
    const used = new Set();
    for (let i = 0; i < this.count; i++) {
      const j = best.assignments[i];
      if (j >= 0) { output[i] = input[j]; used.add(j); this.slots[i] = input[j]; this.missing[i] = 0; }
      else if (this.slots[i] && ++this.missing[i] > MISSING_FRAMES) { this.slots[i] = null; this.missing[i] = 0; }
    }
    for (let j = 0; j < input.length; j++) {
      if (used.has(j)) continue;
      let slot = output.findIndex((h, i) => !h && !this.slots[i]);
      if (slot < 0) slot = output.findIndex((h) => !h);
      if (slot < 0) break;
      output[slot] = input[j]; this.slots[slot] = input[j]; this.missing[slot] = 0;
    }
    return output;
  }

  reset() { this.slots = Array(this.count).fill(null); this.missing = Array(this.count).fill(0); }
}
module.exports = { HandTracks };
