// Guided face enrollment, the way Glance does it: nine head poses (straight ahead, then the eight compass directions around it), two samples each, captured only when the
// head really is turned that way and has stayed there. This file is the head-angle maths and the state machine that decides when to capture; the window (enroll.js) draws the
// camera and the ring and does the face-to-numbers step. Pure, so it can be tested without a camera.
//
// Signs, as seen in the MIRRORED preview (the way a mirror shows you): yaw is positive when you turn toward your own left, pitch is positive when you look up. Angles are in
// degrees and measured from where YOUR head sat at the "straight ahead" pose, so a camera that sits a little high or low does not matter.

// Glance's numbers (radians there, degrees here): a turn counts from about 14 degrees sideways or 10 up/down, and past about 29 / 21 degrees the face is too turned to be a
// useful sample. Straight ahead allows about 10 / 9 degrees of wobble.
export const BANDS = { yawInner: 14, yawCenter: 10, yawOuter: 29, pitchInner: 10, pitchCenter: 8.6, pitchOuter: 21 };

export const POSES = [
  { id: 'center', label: 'Look straight at the camera', yaw: 0, pitch: 0, compass: null, leniency: 1 },
  { id: 'left', label: 'Turn your head slightly left', yaw: 1, pitch: 0, compass: 270, leniency: 1 },
  { id: 'topLeft', label: 'Turn your head to the top left', yaw: 1, pitch: 1, compass: 315, leniency: 1 },
  { id: 'top', label: 'Tilt your head slightly up', yaw: 0, pitch: 1, compass: 0, leniency: 1 },
  { id: 'topRight', label: 'Turn your head to the top right', yaw: -1, pitch: 1, compass: 45, leniency: 1 },
  { id: 'right', label: 'Turn your head slightly right', yaw: -1, pitch: 0, compass: 90, leniency: 1 },
  { id: 'bottomRight', label: 'Turn your head to the bottom right', yaw: -1, pitch: -1, compass: 135, leniency: 1.5 },
  { id: 'bottom', label: 'Tilt your head slightly down', yaw: 0, pitch: -1, compass: 180, leniency: 1.2 },
  { id: 'bottomLeft', label: 'Turn your head to the bottom left', yaw: 1, pitch: -1, compass: 225, leniency: 1.5 }
];
export const POSE_IDS = POSES.map((p) => p.id);

const deg = (rad) => (rad * 180) / Math.PI;

// Head turn from the face landmarker's 478 points (x, y normalised to the picture, z in roughly the same scale as x, smaller = nearer the camera). The picture is the camera's
// own, not mirrored: a nose that moves toward the right of that picture is the person turning toward THEIR left. Yaw: how much farther the right cheek is than the left;
// pitch: how much farther the forehead is than the chin. Returns { yaw, pitch, roll } in degrees (yaw positive = toward your left, pitch positive = up), or null.
export function headAngles(lm, width = 1, height = 1) {
  if (!Array.isArray(lm) || lm.length < 478) return null;
  const P = (i) => lm[i];
  const need = [1, 10, 33, 152, 234, 263, 454];
  if (!need.every((i) => P(i) && [P(i).x, P(i).y, P(i).z].every(Number.isFinite))) return null;
  const dx = (P(454).x - P(234).x) * width, dzYaw = (P(454).z - P(234).z) * width;
  const dy = (P(152).y - P(10).y) * height, dzPitch = (P(10).z - P(152).z) * width;
  if (!(dx > 1e-6) || !(dy > 1e-6)) return null;
  const roll = deg(Math.atan2((P(263).y - P(33).y) * height, (P(263).x - P(33).x) * width));
  return { yaw: deg(Math.atan2(dzYaw, dx)), pitch: deg(Math.atan2(dzPitch, dy)), roll };
}

// ---- the state machine ----
export class PoseCapture {
  // samplesPerPose: 2 (so 18 in all). holdMs: how long the pose must be held before samples count. streak: matching looks in a row after that. stallMs: how long a pose may
  // take before the bands are relaxed (each time by a quarter, up to doubled), so an unusual camera angle cannot strand anyone. initialDelayMs: nothing is taken in the first moments.
  constructor({ samplesPerPose = 2, holdMs = 500, streak = 3, stallMs = 12000, initialDelayMs = 1500 } = {}) {
    Object.assign(this, { samplesPerPose, holdMs, streakNeeded: streak, stallMs, initialDelayMs });
    this.reset();
  }

  reset() {
    this.index = 0; this.captured = 0; this.baseline = null; this.baseSum = { yaw: 0, pitch: 0, n: 0 };
    this.startedAt = null; this.poseStartedAt = null; this.holdStart = null; this.streak = 0;
    this.done = false; this.capturedPoses = new Set(); this.progress = 0; this.hint = 'ready'; this.angles = null;
  }

  get pose() { return POSES[Math.min(this.index, POSES.length - 1)]; }
  get total() { return POSES.length * this.samplesPerPose; }
  get count() { return this.index * this.samplesPerPose + this.captured; }

  // How much the bands are relaxed for the current pose: 1, then 1.25 after stallMs, 1.5 after twice that, and so on up to 2.
  widen(now) { return this.poseStartedAt === null ? 1 : Math.min(2, 1 + 0.25 * Math.floor((now - this.poseStartedAt) / this.stallMs)); }

  // angles: { yaw, pitch } in degrees (raw, from headAngles), or null when no usable face. problem: a reason the picture cannot be used right now
  // ('none' no face, 'many' more than one, 'far' too small, 'near' too big), which becomes the hint. Returns { capture: bool, pose } where capture says "take a sample now".
  update({ angles = null, problem = '' } = {}, now = Date.now()) {
    if (this.done) return { capture: false, pose: this.pose };
    if (this.startedAt === null) { this.startedAt = now; this.poseStartedAt = now; }
    this.angles = angles;
    const stop = (hint, progress) => { this.streak = 0; this.holdStart = null; this.hint = hint; if (progress !== undefined) this.progress = progress; return { capture: false, pose: this.pose }; };
    if (problem) return stop(problem, 0);
    if (!angles || !Number.isFinite(angles.yaw) || !Number.isFinite(angles.pitch)) return stop('none', 0);

    const pose = this.pose, f = this.widen(now) * pose.leniency;
    const rel = this.baseline ? { yaw: angles.yaw - this.baseline.yaw, pitch: angles.pitch - this.baseline.pitch } : { yaw: angles.yaw, pitch: angles.pitch };
    const yawOK = pose.yaw === 0 ? Math.abs(rel.yaw) < BANDS.yawCenter * f : pose.yaw * rel.yaw > BANDS.yawInner / f && pose.yaw * rel.yaw < BANDS.yawOuter;
    const pitchOK = pose.pitch === 0 ? Math.abs(rel.pitch) < BANDS.pitchCenter * f : pose.pitch * rel.pitch > BANDS.pitchInner / f && pose.pitch * rel.pitch < BANDS.pitchOuter;

    // how far the turn has gone toward this pose (0..1), for the ring
    // (only the axes being turned count; wobble on the other one is not "progress". Straight ahead has no turn, so it shows how steady the head is.)
    const turn = (want, v, inner) => Math.max(0, Math.min(1, (want * v) / (inner / f)));
    const steady = (v, centre) => Math.max(0, 1 - Math.abs(v) / (centre * f));
    const parts = [];
    if (pose.yaw !== 0) parts.push(turn(pose.yaw, rel.yaw, BANDS.yawInner));
    if (pose.pitch !== 0) parts.push(turn(pose.pitch, rel.pitch, BANDS.pitchInner));
    this.progress = parts.length ? Math.min(...parts) : Math.min(steady(rel.yaw, BANDS.yawCenter), steady(rel.pitch, BANDS.pitchCenter));

    // far past the useful range: the numbers from such a turn are not a good sample
    if (this.baseline && (Math.abs(rel.yaw) >= BANDS.yawOuter || Math.abs(rel.pitch) >= BANDS.pitchOuter)) return stop('toofar');
    if (!this.baseline && (Math.abs(angles.yaw) >= BANDS.yawOuter || Math.abs(angles.pitch) >= BANDS.pitchOuter)) return stop('straighten', 0);
    if (!(yawOK && pitchOK)) return stop(this.progress > 0.55 ? 'almost' : 'turn');
    if (now - this.startedAt < this.initialDelayMs) return stop('hold');

    // matching: it has to be held, then seen a few times in a row, before a sample is taken
    if (this.holdStart === null) this.holdStart = now;
    this.hint = 'hold';
    if (now - this.holdStart < this.holdMs) return { capture: false, pose };
    if (++this.streak < this.streakNeeded) return { capture: false, pose };
    this.streak = 0;
    return { capture: true, pose };
  }

  // The caller took the sample (it can fail: the face may not align at that angle). This moves on.
  recorded(angles, now = Date.now()) {
    if (this.done) return;
    if (this.pose.id === 'center' && angles) { this.baseSum.yaw += angles.yaw; this.baseSum.pitch += angles.pitch; this.baseSum.n++; }
    this.captured++; this.holdStart = null; this.streak = 0;
    if (this.captured >= this.samplesPerPose) {
      if (this.pose.id === 'center') this.baseline = this.baseSum.n ? { yaw: this.baseSum.yaw / this.baseSum.n, pitch: this.baseSum.pitch / this.baseSum.n } : { yaw: 0, pitch: 0 };
      else this.capturedPoses.add(this.pose.id);
      this.index++; this.captured = 0; this.poseStartedAt = now; this.progress = 0;
      if (this.index >= POSES.length) { this.done = true; this.hint = 'done'; }
    }
  }
}

// What the person is told, for each hint.
export const HINTS = {
  ready: 'Getting ready…',
  none: 'I cannot see your face. Move into the picture.',
  many: 'Only you should be in the picture.',
  far: 'Move a little closer to the camera.',
  near: 'Move back a little.',
  straighten: 'Face the camera, then start turning.',
  toofar: 'That is too far. Turn back a little.',
  turn: '',
  almost: 'Almost there. A little more.',
  hold: 'Hold it there…',
  done: 'All done.'
};
