// What a hand is doing, from its 21 landmarks (the model's own gesture names are unreliable for a hand held at an odd angle, so the pose
// is worked out from the finger joints: a finger is out when its tip is clearly farther from the wrist than its middle joint). Plain
// functions on {x, y} points, so they are tested on their own.

const d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

// Which fingers are stretched out: { thumb, index, middle, ring, pinky }.
export function fingers(l) {
  const w = l[0];
  const out = (mcp, pip, tip) => d(l[tip], w) > d(l[pip], w) * 1.06 && d(l[tip], w) > d(l[mcp], w) * 1.3;
  return {
    thumb: d(l[4], l[17]) > d(l[3], l[17]) * 1.12 && d(l[4], l[17]) > d(l[2], l[17]) * 1.05,
    index: out(5, 6, 8), middle: out(9, 10, 12), ring: out(13, 14, 16), pinky: out(17, 18, 20)
  };
}

// 'Closed_Fist' | 'Open_Palm' | 'Victory' | 'Pointing_Up' | 'None' (the names the rest of Relay uses)
export function poseOf(l) {
  if (!l || l.length < 21) return 'None';
  const f = fingers(l);
  const n = [f.index, f.middle, f.ring, f.pinky].filter(Boolean).length;
  if (n === 0) return 'Closed_Fist';
  if (f.index && f.middle && !f.ring && !f.pinky) return 'Victory';
  if (f.index && !f.middle && !f.ring && !f.pinky) return 'Pointing_Up';
  if (n >= 3) return 'Open_Palm';
  return 'None';
}

// How close thumb tip and index tip are, against the size of the hand (about 0.1 pinched, 0.8 open).
export function pinchOf(l) {
  const size = d(l[0], l[9]) || 1e-6;
  return d(l[4], l[8]) / size;
}
