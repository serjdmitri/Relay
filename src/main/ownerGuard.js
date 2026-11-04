// Owner guard: the camera page compares each face it sees with your enrolled face (a list of 128-number templates, never a picture). When a face
// is in view that is NOT you, and you are not in view, an "access denied" alarm starts and a countdown runs; if you come back in time (seen in two
// frames in a row) the alarm stops, otherwise the Mac is locked. Locking is the only thing it does: it never unlocks the Mac. After the lock, getting
// back in is up to macOS (and Glance, if you use it). Pure logic here; main.js supplies the lock, the alarm window and the camera.
//
// Honest limits: recognition can be wrong (poor light, glasses, a different angle: you may be flagged for a few seconds, which is why two frames of
// you cancel it), a VIDEO of you blinking can fool it (a still photo cannot: the liveness check wants a blink), and covering the camera makes it blind rather than suspicious.

const DEFAULTS = { enabled: false, seconds: 20, threshold: 0.363, awayScreen: true, awaySeconds: 45, liveness: true, margin: 0.12, photos: true }; // 0.363 is the published cosine threshold for the SFace model
const clamp = (v, lo, hi, d) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
function config(raw) {
  const c = raw && typeof raw === 'object' ? raw : {};
  return { enabled: c.enabled === true, seconds: Math.round(clamp(c.seconds, 5, 120, DEFAULTS.seconds)), threshold: clamp(c.threshold, 0.2, 0.7, DEFAULTS.threshold), awayScreen: c.awayScreen !== false, awaySeconds: Math.round(clamp(c.awaySeconds, 10, 600, DEFAULTS.awaySeconds)), liveness: c.liveness !== false, margin: clamp(c.margin, 0, 0.3, DEFAULTS.margin), photos: c.photos !== false };
}

// ---- matching ----
const norm = (v) => { let s = 0; for (const x of v) s += x * x; return Math.sqrt(s) || 1; };
function cosine(a, b) {
  if (!a || !b || a.length !== b.length || !a.length) return null;
  let d = 0; for (let i = 0; i < a.length; i++) d += a[i] * b[i];
  return d / (norm(a) * norm(b));
}
// The best match of one face against all enrolled templates, or null when it cannot be compared.
function bestScore(embedding, templates) {
  if (!embedding || !Array.isArray(templates) || !templates.length) return null;
  let best = null;
  for (const t of templates) { const s = cosine(embedding, t); if (s !== null && (best === null || s > best)) best = s; }
  return best;
}

// Keep enrollment samples that add something: the new one is skipped when it is nearly identical to one already kept (a still face makes 12 copies).
function addSample(samples, embedding, { max = 12, tooSimilar = 0.95 } = {}) {
  if (!Array.isArray(embedding) || embedding.length !== 128 || embedding.some((x) => !Number.isFinite(x))) return { samples, added: false, why: 'bad' };
  if (samples.length >= max) return { samples, added: false, why: 'full' };
  if (samples.some((s) => cosine(s, embedding) >= tooSimilar)) return { samples, added: false, why: 'similar' };
  return { samples: [...samples, embedding.map((x) => Math.round(x * 1e5) / 1e5)], added: true };
}

// What the enrollment window sends back: [{ pose, embedding }] for the nine poses. Only a set that really covers your face from around is kept: straight ahead plus at least six of
// the eight directions, every embedding 128 finite numbers, nothing else. Returns { ok, templates, poses } or { ok: false, why } in words.
const ENROLL_POSES = ['center', 'left', 'topLeft', 'top', 'topRight', 'right', 'bottomRight', 'bottom', 'bottomLeft'];
function acceptEnrollment(samples, { minDirections = 6, max = 24 } = {}) {
  if (!Array.isArray(samples) || !samples.length) return { ok: false, why: 'No face samples arrived.' };
  const templates = [], poses = new Set();
  for (const s of samples.slice(0, max)) {
    if (!s || !ENROLL_POSES.includes(s.pose) || !Array.isArray(s.embedding) || s.embedding.length !== 128 || s.embedding.some((x) => typeof x !== 'number' || !Number.isFinite(x))) continue;
    templates.push(s.embedding.map((x) => Math.round(x * 1e5) / 1e5)); poses.add(s.pose);
  }
  if (!poses.has('center')) return { ok: false, why: 'The straight-ahead pose is missing.' };
  const directions = [...poses].filter((p) => p !== 'center').length;
  if (directions < minDirections) return { ok: false, why: `Only ${directions} of the 8 directions were captured; at least ${minDirections} are needed.` };
  return { ok: true, templates, poses: [...poses] };
}

// Which of the faces in view are a trusted person (someone you enrolled by name): the face matches a trusted profile, does not match YOU, and (when the blink check is on)
// has blinked. A trusted person is neither the owner nor a stranger: they never start the alarm or the viewer countdown, and they cannot stand in for you (arm the guard,
// lift the standby screen). scores: each face's best match against YOUR face; trustedScores: against the trusted profiles; live: the blink check per face.
function trustedFlags({ scores = [], trustedScores = [], live = [], threshold = DEFAULTS.threshold } = {}) {
  return scores.map((owner, i) => {
    const t = trustedScores[i];
    return Number.isFinite(t) && t >= threshold && !(Number.isFinite(owner) && owner >= threshold) && live[i] !== false;
  });
}

// ---- the guard ----
class OwnerGuard {
  // lock(): Promise. onAlarm({ seconds, demo }), onCount(secondsLeft), onClear(reason: 'owner' | 'ended'), onLocked(): the window and sound. getConfig(): settings.owner.
  constructor({ lock, onAlarm = () => {}, onCount = () => {}, onClear = () => {}, onLocked = () => {}, onAway = () => {}, onOwnerSeen = () => {}, getConfig = () => ({}), hasTemplates = () => true, getIdleSeconds = () => Infinity, now = Date.now, strangerFrames = 5, ownerFrames = 2, calmFrames = 10, armFrames = 3 }) {
    Object.assign(this, { onOwnerSeen, getIdleSeconds, armFrames, lock, onAlarm, onCount, onClear, onLocked, onAway, getConfig, hasTemplates, now, strangerFrames, ownerFrames, calmFrames });
    this.reset();
  }
  reset() { this.state = 'idle'; this.strangers = 0; this.owners = 0; this.calm = 0; this.deadline = null; this.demo = false; this.seen = 'nobody'; this.awayActive = false; this.noFaceSince = null;
    // Armed once YOU have been recognised (alive) for a few frames in a row this session. Until then nothing alarms, locks or blanks the screen: if recognition does not work
    // for you, it must never be able to lock you out. lastScore is the best match seen, for "owner recognition status".
    this.armed = false; this.lastScore = null; this.lookingAway = false; this.lastDownAt = 0; this.quietUntil = 0; this.watchStart = null; this.lastFrameAt = null; this.activeSteps = 0; this.trustedFrames = 0; }

  // faces: how many; scores: best match per face (null = could not tell). Returns 'alarm', 'cleared', 'locked' or null (when nothing changed).
  // live: per face, false when it matches you but has not blinked lately (a picture). That is treated as a stranger, never as you.
  // trusted: per face, true for a recognised trusted person (see trustedFlags).
  frame({ faces = 0, scores = [], live = [], down = false, trusted = [] } = {}) {
    const cfg = config(this.getConfig());
    if (!cfg.enabled || !this.hasTemplates()) { if (this.state !== 'idle' && !this.demo) this.clear('ended'); if (this.awayActive) { this.awayActive = false; this.onAway(false); } this.noFaceSince = null; this.watchStart = null; return null; }
    if (this.watchStart === null) this.watchStart = this.now();
    this.lastFrameAt = this.now();
    const known = scores.map((s, i) => ({ s, alive: !cfg.liveness || live[i] !== false, trusted: trusted[i] === true })).filter((k) => Number.isFinite(k.s));
    const trustedHere = known.some((k) => k.trusted);
    // A score between (threshold - margin) and the threshold is "not sure" (a face that is far, turned or badly lit): neither you nor a stranger. Only a clearly low score, or a match with no blink, counts against you.
    const owner = known.some((k) => k.s >= cfg.threshold && k.alive), stranger = known.some((k) => !k.trusted && (k.s < cfg.threshold - cfg.margin || (k.s >= cfg.threshold && !k.alive)));
    this.seen = owner ? 'owner' : stranger ? 'stranger' : trustedHere ? 'trusted' : faces ? 'unclear' : 'nobody';
    this.trustedFrames = trustedHere && !owner && !stranger ? this.trustedFrames + 1 : 0;
    if (known.length) this.lastScore = Math.max(...known.map((k) => k.s));
    this.owners = owner ? this.owners + 1 : 0;
    this.strangers = stranger && !owner ? this.strangers + 1 : 0;
    this.calm = stranger ? 0 : this.calm + 1;
    if (owner && this.owners >= this.armFrames) this.armed = true;
    if (faces > 0) this.lookingAway = !!down;
    if (down) this.lastDownAt = this.now();
    this.noFaceSince = faces > 0 ? null : (this.noFaceSince ?? this.now());
    const out = this.step(cfg);
    // you have just been seen (the first look in a streak of looks): the place to tell you what happened while you were away
    if (owner && this.owners === this.ownerFrames) { try { this.onOwnerSeen(); } catch { /* a failing report must not stop the guard */ } }
    return out;
  }

  // How often the camera page should look: quickly while Relay is waiting to see YOU (the first moments after turning it on, the away screen, the alarm countdown), so you are
  // recognised in under a second, and once a second otherwise. Quick looking only changes WHEN frames arrive, never how many it takes to alarm: the alarm and the lock after one
  // still count the same frames in the same state (the stranger count only runs while idle and armed, which is the slow pace).
  pace(fastMs = 400, slowMs = 1000, warmMs = 30000) {
    const cfg = config(this.getConfig());
    if (!cfg.enabled || !this.hasTemplates()) return slowMs;
    if (this.awayActive || this.state === 'alarm') return fastMs;
    if (!this.armed && this.watchStart !== null && this.now() - this.watchStart < warmMs) return fastMs;
    return slowMs;
  }

  // Called every second as well, so the countdown ends on time even if the camera stops sending pictures.
  step(cfg = config(this.getConfig())) {
    const t = this.now();
    // The away screen: nobody in view for a while (and you are not in the middle of an alarm) puts the Mac on standby until you are seen again. It must never trap you, so:
    //  - it does not appear while the keyboard or mouse have been used lately (someone is there, whatever the camera sees),
    //  - it does not appear, and goes away, when the camera has stopped sending pictures (blind is not the same as nobody there),
    //  - and once it is up, touching the keyboard or mouse for two seconds in a row clears it (a stranger who sits down is seen by the camera and gets the alarm instead).
    const idle = Number(this.getIdleSeconds()), blind = this.lastFrameAt !== null && t - this.lastFrameAt > 8000, usingMac = Number.isFinite(idle) && idle < Math.min(cfg.awaySeconds, 30);
    this.activeSteps = Number.isFinite(idle) && idle < 1.5 ? this.activeSteps + 1 : 0;
    if (cfg.enabled && cfg.awayScreen && !this.demo && this.armed) {
      if (!this.awayActive && t >= this.quietUntil && this.state === 'idle' && !blind && !usingMac && this.noFaceSince !== null && t - this.noFaceSince >= cfg.awaySeconds * 1000 * this.awayFactor()) { this.awayActive = true; this.onAway(true); }
      else if (this.awayActive && (this.owners >= this.ownerFrames || blind || this.activeSteps >= 2)) {
        if (this.owners < this.ownerFrames) { this.quietUntil = Math.max(this.quietUntil, t + 120000); this.noFaceSince = null; } // cleared without seeing you: leave it be for two minutes
        this.awayActive = false; this.onAway(false);
      }
    } else if (this.awayActive) { this.awayActive = false; this.onAway(false); }
    if (this.state === 'idle') {
      if (cfg.enabled && this.armed && t >= this.quietUntil && this.strangers >= this.strangerFrames) { this.state = 'alarm'; this.deadline = t + cfg.seconds * 1000; this.demo = false; this.awayActive = false; this.onAlarm({ seconds: cfg.seconds, demo: false }); return 'alarm'; }
      return null;
    }
    if (this.state === 'alarm') {
      if (this.owners >= this.ownerFrames && !this.demo) return this.clear('owner');
      if (this.trustedFrames >= this.ownerFrames && !this.demo) return this.clear('trusted'); // an approved person is at the desk and no stranger is: nothing to alarm about (the Mac is not unlocked by this, only the alarm stops)
      if (t >= this.deadline) return this.end();
      this.onCount(this.secondsLeft());
      return null;
    }
    // locked: quiet until you have been seen again, or nobody strange has been in view for a while, so one stranger is not alarmed over and over
    if (this.owners >= this.ownerFrames || this.calm >= this.calmFrames) { this.state = 'idle'; this.strangers = 0; }
    return null;
  }

  // Looking down at the keyboard can lose the face altogether. If the face vanished right after it was seen looking down, that is most likely you, not an empty chair: wait three times as long.
  awayFactor() { return this.lastDownAt && this.noFaceSince !== null && this.noFaceSince - this.lastDownAt < 6000 ? 3 : 1; }

  // You proved it is you another way (a fingerprint): stop the alarm or the standby screen, and stay quiet for a few minutes so a friend in view does not start it again.
  dismiss(reason = 'fingerprint', minutes = 5) {
    this.quietUntil = this.now() + minutes * 60000; this.armed = true;
    if (this.state === 'alarm') this.clear(reason);
    if (this.awayActive) { this.awayActive = false; this.onAway(false); }
  }

  end() {
    if (this.demo) { this.clear('ended'); return 'cleared'; }
    this.state = 'locked'; this.deadline = null;
    Promise.resolve().then(() => this.lock()).catch(() => {});
    this.onLocked(); return 'locked';
  }
  clear(reason) { this.state = 'idle'; this.deadline = null; this.strangers = 0; this.demo = false; this.onClear(reason); return 'cleared'; }

  // "Test the access denied screen": the same alarm for a few seconds, which never locks and ignores who is in view.
  startDemo(seconds = 6) { this.state = 'alarm'; this.demo = true; this.deadline = this.now() + seconds * 1000; this.onAlarm({ seconds, demo: true }); }
  secondsLeft() { return this.state === 'alarm' && this.deadline ? Math.max(0, Math.ceil((this.deadline - this.now()) / 1000)) : null; }
}

// "enroll my face", "forget my face", "turn on owner recognition", "set the lock countdown to 30 seconds", "owner recognition status", "test the access denied screen".
function parseOwnerCommand(text) {
  const n = String(text || '').trim().replace(/[“”"]/g, '').replace(/[.!?]+$/, '').replace(/^(?:hey |ok |okay )?(?:relay|jarvis)[, ]+/i, '').replace(/^please /i, '').replace(/\s+/g, ' ').toLowerCase();
  if (/^(?:enroll|enrol|register|save|add|learn|scan|set up) my face$|^(?:set up|start) (?:face|owner) (?:recognition|enrollment|enrolment)$/.test(n)) return { type: 'enroll' };
  if (/^(?:forget|delete|remove|erase|clear) my face(?: data)?$|^(?:forget|delete|erase) (?:the )?(?:face|owner) (?:data|templates?)$/.test(n)) return { type: 'forget' };
  if (/^(?:turn on|enable|start|switch on) (?:the )?(?:owner|face) (?:recognition|check|guard|lock)$|^(?:owner|face) (?:recognition|guard) on$/.test(n)) return { type: 'on' };
  if (/^(?:turn off|disable|stop|switch off) (?:the )?(?:owner|face) (?:recognition|check|guard|lock)$|^(?:owner|face) (?:recognition|guard) off$/.test(n)) return { type: 'off' };
  const m = /^(?:set|change|make) (?:the )?(?:lock |access denied |intruder )?(?:countdown|timer|delay|time)(?: (?:for|of) (?:the )?(?:owner|face|access denied|lock)[a-z ]*)? (?:to|at) (\d{1,3})(?: ?(s|sec|secs|seconds?|m|min|mins|minutes?))?$/.exec(n);
  if (m) { const v = Number(m[1]); return { type: 'seconds', seconds: /^m/.test(m[2] || '') ? v * 60 : v }; }
  if (/^(?:turn on|enable|switch on) (?:the )?(?:liveness|blink|photo|anti[- ]?spoof(?:ing)?) (?:check|test|protection|detection)$/.test(n)) return { type: 'liveness-on' };
  if (/^(?:turn off|disable|switch off) (?:the )?(?:liveness|blink|photo|anti[- ]?spoof(?:ing)?) (?:check|test|protection|detection)$/.test(n)) return { type: 'liveness-off' };
  if (/^(?:turn on|enable|start|switch on) (?:the )?(?:away|standby|stand-by) (?:screen|mode)$/.test(n)) return { type: 'away-on' };
  if (/^(?:turn off|disable|stop|switch off) (?:the )?(?:away|standby|stand-by) (?:screen|mode)$/.test(n)) return { type: 'away-off' };
  if (/^(?:test|show|preview|try) (?:the )?(?:away|standby|stand-by) (?:screen|mode)$/.test(n)) return { type: 'away-demo' };
  if (/^(?:show|open|see|view|list)(?: me)?(?: the| my)? (?:intruders?|strangers?|security)(?: pictures?| photos?| log| visits| shots)?$|^who (?:was|sat|tried|came|has been|used|touched) (?:at|to use|using|on) my (?:computer|mac|laptop)(?: while i was (?:away|gone|out))?$|^who was (?:at|on) my (?:computer|mac|laptop)$/.test(n)) return { type: 'intruders' };
  if (/^(?:turn on|enable|start|switch on) (?:the )?(?:intruder|stranger) (?:photos?|pictures?|snapshots?|camera)$/.test(n)) return { type: 'photos-on' };
  if (/^(?:turn off|disable|stop|switch off) (?:the )?(?:intruder|stranger) (?:photos?|pictures?|snapshots?|camera)$/.test(n)) return { type: 'photos-off' };
  if (/^(?:delete|clear|erase|remove) (?:all )?(?:the |my )?(?:intruder|stranger) (?:photos?|pictures?|log|visits|shots)$/.test(n)) return { type: 'intruders-clear' };
  if (/^(?:owner|face) (?:recogn\w*|guard|check) (?:status|settings?)$|^is (?:the )?(?:owner|face) (?:recogn\w*|guard|check) (?:on|working|enabled)$/.test(n)) return { type: 'status' };
  if (/^(?:test|show|preview|try) (?:the )?(?:access denied|intruder|not your computer)(?: screen| alarm| warning)?$/.test(n)) return { type: 'demo' };
  return null;
}

// Ask macOS to confirm it is the owner: the Touch ID sheet first. If the system cannot show that sheet at all (an error that is not "cancelled" or "not recognised"), fall
// back to macOS's own authorization prompt, which also takes Touch ID or the password. A finger that is not recognised never falls back. Throws a short, readable message.
async function authenticateOwner({ touchId, admin, onProblem = () => {} }) {
  try { await touchId(); return { ok: true, via: 'touchid' }; } catch (e) {
    const m = String((e && e.message) || e || '');
    if (/cancel/i.test(m)) throw new Error('Cancelled.');
    if (/fail|not recogni|not match|did not match/i.test(m)) throw new Error('Fingerprint not recognised.');
    onProblem(m.slice(0, 120));
    try { await admin(); return { ok: true, via: 'macos' }; } catch (e2) {
      throw new Error(/cancel|-128/i.test(String((e2 && e2.message) || e2)) ? 'Cancelled.' : `Could not confirm it is you: ${m.slice(0, 60)}`);
    }
  }
}

// Your enrolled face on disk: only ever encrypted (the Mac's keychain-backed safeStorage, passed in), as { v, enc, count, at }. v is 2: version 1 was made with a rougher
// face alignment that does not match the current one, so it is ignored and you enroll again.
function sealTemplates(templates, encrypt, at = Date.now()) { return { v: 2, enc: encrypt(JSON.stringify({ templates })), count: templates.length, at }; }
function openTemplates(rec, decrypt) {
  try {
    if (!rec || rec.v !== 2 || typeof rec.enc !== 'string') return [];
    const t = JSON.parse(decrypt(rec.enc)).templates;
    return Array.isArray(t) ? t.filter((x) => Array.isArray(x) && x.length === 128 && x.every(Number.isFinite)) : [];
  } catch { return []; }
}

module.exports = { OwnerGuard, authenticateOwner, acceptEnrollment, trustedFlags, ENROLL_POSES, config, cosine, bestScore, addSample, sealTemplates, openTemplates, parseOwnerCommand, DEFAULTS };
