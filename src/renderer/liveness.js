// Liveness: a photo does not blink. This follows each face in the camera picture (by where its nose is) and remembers when it last blinked, so owner recognition
// can tell a face that is alive from a picture held up to the camera. A face counts as alive for 30 seconds after a blink, and for 8 seconds after it first
// appears (so you are not flagged while sitting down). A video of you blinking would still pass: this makes a spoof harder, not impossible.

export const LIVE_FOR_MS = 30000; // people staring at a screen blink less, and a blink is quick: be generous
export const GRACE_MS = 8000;
const MATCH = 0.12; // how far a nose may move between looks and still be the same face (fraction of the picture)
const CLOSED = 0.35, OPEN = 0.22; // eye-blink blendshape scores: above CLOSED is a closed eye, below OPEN an open one

// Is this face looking away from the camera (down at the keyboard, or turned aside)? From the landmarker: the eyes' downward-gaze scores (0..1) and the face's 4x4
// pose matrix (column-major). Pitch and yaw are measured as sizes, so it works whichever way the matrix's axes point. Used so that looking down is not mistaken
// for leaving the desk or for a stranger: a face turned away cannot be judged.
export function lookingAway({ gazeDownL, gazeDownR, matrix } = {}) {
  const g = (Number(gazeDownL) + Number(gazeDownR)) / 2;
  if (Number.isFinite(g) && g >= 0.4) return true;
  const m = matrix && matrix.length >= 16 ? Array.from(matrix) : null;
  if (!m || !m.every(Number.isFinite)) return false;
  const r = (row, col) => m[col * 4 + row];
  const pitch = (Math.atan2(r(2, 1), Math.abs(r(2, 2))) * 180) / Math.PI;
  const yaw = (Math.asin(Math.max(-1, Math.min(1, r(2, 0)))) * 180) / Math.PI;
  return Math.abs(pitch) > 20 || Math.abs(yaw) > 30; // someone working at the screen faces it within these angles; you glancing at your phone or the room does not
}

export class LivenessTracker {
  constructor() { this.tracks = []; }

  // faces: [{ x, y, blinkL, blinkR }] from the face landmarker (normalised 0..1; blink scores 0..1). Called often (several times a second).
  update(faces, now) {
    const used = new Set();
    for (const f of faces) {
      if (![f.x, f.y].every(Number.isFinite)) continue;
      let t = null, best = MATCH;
      for (const c of this.tracks) { if (used.has(c)) continue; const d = Math.hypot(c.x - f.x, c.y - f.y); if (d < best) { best = d; t = c; } }
      if (!t) { t = { x: f.x, y: f.y, bornAt: now, lastBlink: null, eyesOpen: false, seenAt: now }; this.tracks.push(t); }
      used.add(t); t.x = f.x; t.y = f.y; t.seenAt = now;
      const l = Number(f.blinkL), r = Number(f.blinkR);
      if (!Number.isFinite(l) || !Number.isFinite(r)) continue;
      if (l < OPEN && r < OPEN) t.eyesOpen = true;
      else if (l > CLOSED && r > CLOSED && t.eyesOpen) { t.lastBlink = now; t.eyesOpen = false; } // both eyes shut after being open: a blink
    }
    this.tracks = this.tracks.filter((c) => now - c.seenAt < 4000);
  }

  // Is the face whose nose is at (x, y) alive? false = seen, but never blinked; null = no face tracked there.
  isLive(x, y, now) {
    let t = null, best = MATCH;
    for (const c of this.tracks) { const d = Math.hypot(c.x - x, c.y - y); if (d < best) { best = d; t = c; } }
    if (!t) return null;
    if (t.lastBlink !== null && now - t.lastBlink < LIVE_FOR_MS) return true;
    return now - t.bornAt < GRACE_MS;
  }
}
