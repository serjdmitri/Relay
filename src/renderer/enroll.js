/* global relay */
// The face setup window: the camera in a circle (as a mirror), a ring of eight directions around it, and the nine head poses Glance uses, one at a time. The face landmarker
// finds your face and head angle (enrollpose.js decides when a pose has really been reached and held), and each time it says "now" the face is turned into 128 numbers
// (faceid.js). Only the finished set of numbers goes to Relay; the picture is only drawn here.
import { FaceLandmarker, FilesetResolver } from './vendor/mediapipe/vision_bundle.mjs';
import { createEmbedder } from './faceid.js';
import { PoseCapture, POSES, HINTS, headAngles, assessEnrollment, scanVerdict } from './enrollpose.js';

const $ = (id) => document.getElementById(id);
const video = $('v'), ringEl = $('ring');
const NS = 'http://www.w3.org/2000/svg';
const capture = new PoseCapture();
let samples = [], threshold = 0.363, liveScores = [], checkStarted = 0, report = null, landmarker = null, embed = null, stream = null, phase = 'loading', stopped = false, busy = false, timer = 0, embedFails = 0, overrideUntil = 0, override = '', smooth = null;

// ---- the ring: eight arcs around the picture, 30 degrees wide, centred on the compass directions (0 = up, clockwise) ----
const R = 100;
const pt = (a, r = R) => [(r * Math.sin((a * Math.PI) / 180)).toFixed(2), (-r * Math.cos((a * Math.PI) / 180)).toFixed(2)];
const arc = (a) => { const [x1, y1] = pt(a - 15), [x2, y2] = pt(a + 15); return `M${x1} ${y1}A${R} ${R} 0 0 1 ${x2} ${y2}`; };
const sectors = new Map(), fills = new Map();
for (const p of POSES) {
  if (p.compass === null) continue;
  const base = document.createElementNS(NS, 'path'); base.setAttribute('d', arc(p.compass)); base.setAttribute('class', 'sector'); base.setAttribute('pathLength', '100');
  const fill = document.createElementNS(NS, 'path'); fill.setAttribute('d', arc(p.compass)); fill.setAttribute('class', 'fill'); fill.setAttribute('pathLength', '100'); fill.setAttribute('stroke-dasharray', '0 100');
  ringEl.append(base, fill); sectors.set(p.id, base); fills.set(p.id, fill);
}
const dots = POSES.map(() => { const d = document.createElement('span'); d.className = 'dot'; $('dots').append(d); return d; });

const WARN = new Set(['none', 'many', 'far', 'near', 'toofar', 'straighten']);
function say(line1, line2, warn = false) { $('line1').textContent = line1; $('line2').textContent = line2; document.body.classList.toggle('warn', warn); }

function draw(now) {
  const p = capture.pose, done = capture.done;
  for (const [id, el] of sectors) {
    const weakNow = report && report.weak.includes(id);
    el.setAttribute('class', `sector${capture.capturedPoses.has(id) && !weakNow ? ' done' : ''}${weakNow ? ' weak' : ''}${!done && id === p.id ? ' target' : ''}`);
  }
  // a zero-length arc with a round end would still draw a dot, so an empty one is not drawn at all
  for (const [id, el] of fills) { const shown = !done && id === p.id && capture.progress > 0.02; el.style.display = shown ? '' : 'none'; if (shown) el.setAttribute('stroke-dasharray', `${(capture.progress * 100).toFixed(1)} 100`); }
  ringEl.classList.toggle('center', !done && p.id === 'center');
  const cue = $('cue'), on = !done && p.compass !== null && phase === 'running';
  cue.classList.toggle('on', on);
  if (p.compass !== null) { cue.style.setProperty('--dx', Math.sin((p.compass * Math.PI) / 180).toFixed(3)); cue.style.setProperty('--dy', (-Math.cos((p.compass * Math.PI) / 180)).toFixed(3)); }
  dots.forEach((d, i) => { d.className = `dot${i < capture.index ? ' done' : i === capture.index && !done ? ' now' : ''}`; });
  $('count').textContent = `${capture.count} of ${capture.total} captured`;
  if (phase === 'running') {
    const hint = now < overrideUntil ? override : HINTS[capture.hint] || '';
    say(p.label, hint || (capture.progress > 0 ? 'Keep going.' : 'Follow the glow.'), WARN.has(capture.hint) || now < overrideUntil);
  }
  if (!$('debug').hidden) { const a = capture.angles, b = capture.baseline; $('debug').textContent = a ? `yaw ${(a.yaw - (b?.yaw || 0)).toFixed(0)}°  pitch ${(a.pitch - (b?.pitch || 0)).toFixed(0)}°  hint ${capture.hint}  progress ${(capture.progress * 100).toFixed(0)}%` : 'no face'; }
}

// ---- one look at the camera ----
async function look() {
  if (stopped || (phase !== 'running' && phase !== 'checking') || busy || video.readyState < 2) return;
  busy = true;
  const now = Date.now();
  try {
    if (phase === 'checking') { await checkLook(now); return; }
    const r = landmarker.detectForVideo(video, performance.now());
    const faces = r.faceLandmarks || [];
    let angles = null, problem = '';
    if (!faces.length) problem = 'none';
    else if (faces.length > 1) problem = 'many';
    else {
      const lm = faces[0], xs = lm.map((q) => q.x), width = Math.max(...xs) - Math.min(...xs);
      if (width < 0.2) problem = 'far'; else if (width > 0.8) problem = 'near';
      else {
        const raw = headAngles(lm, video.videoWidth || 640, video.videoHeight || 480);
        if (raw) { smooth = smooth ? { yaw: smooth.yaw * 0.4 + raw.yaw * 0.6, pitch: smooth.pitch * 0.4 + raw.pitch * 0.6 } : { yaw: raw.yaw, pitch: raw.pitch }; angles = { ...smooth }; } else problem = 'none';
        if (angles) angles.lm = lm;
      }
    }
    if (problem) smooth = null;
    const res = capture.update({ angles, problem }, now);
    if (res.capture && angles) {
      const e = await embed(video, { lm: angles.lm });
      if (e) { samples.push({ pose: res.pose.id, embedding: e }); capture.recorded({ yaw: angles.yaw, pitch: angles.pitch }, Date.now()); embedFails = 0; }
      else if (++embedFails >= 3) { embedFails = 0; override = 'I cannot see your whole face from there. Turn a little less.'; overrideUntil = Date.now() + 2500; }
    }
    draw(now);
    if (capture.done) await finish();
  } catch { /* a bad picture: skip it */ } finally { busy = false; }
}

async function finish() {
  phase = 'saving'; draw(Date.now());
  say('Saving…', 'Turning what I saw into your face numbers.');
  let r;
  try { r = await relay.enrollFinish(samples); } catch (e) { r = { ok: false, message: String(e?.message || 'The face could not be saved.') }; }
  if (r?.ok) {
    if (Number.isFinite(r.threshold)) threshold = r.threshold;
    // saved. Now see how well it really works: a few fresh looks at the camera, not part of the scan
    phase = 'checking'; liveScores = []; checkStarted = Date.now(); smooth = null; $('cue').classList.remove('on');
    say('Saved. Checking how well it works…', 'Look straight at the camera for a moment.');
  } else {
    phase = 'failed'; say('That did not work', r?.message || 'The face could not be saved. Try again.', true); $('again').hidden = false;
  }
}

const best = (e, list) => list.reduce((m, t) => { let d = 0, x = 0, y = 0; for (let i = 0; i < e.length; i++) { d += e[i] * t[i]; x += e[i] * e[i]; y += t[i] * t[i]; } return Math.max(m, d / (Math.sqrt(x) * Math.sqrt(y) || 1)); }, -1);
// the live check: up to six looks with you facing the camera, each compared with the saved scan
async function checkLook(now) {
  const r = landmarker.detectForVideo(video, performance.now()), faces = r.faceLandmarks || [];
  if (faces.length === 1) {
    const raw = headAngles(faces[0], video.videoWidth || 640, video.videoHeight || 480), b = capture.baseline || { yaw: 0, pitch: 0 };
    if (raw && Math.abs(raw.yaw - b.yaw) < 12 && Math.abs(raw.pitch - b.pitch) < 10 && liveScores.length < 6 && now - (checkLook.last || 0) > 350) {
      const e = await embed(video, { lm: faces[0] });
      if (e) { liveScores.push(best(e, samples.map((s) => s.embedding))); checkLook.last = Date.now(); }
    }
  }
  if (liveScores.length >= 6 || now - checkStarted > 9000) showReport();
}

function showReport() {
  const live = liveScores.length >= 3 ? { passed: liveScores.filter((x) => x >= threshold).length, total: liveScores.length, mean: liveScores.reduce((a, b) => a + b, 0) / liveScores.length } : null;
  report = assessEnrollment(samples, { threshold, live }); phase = 'report';
  const v = scanVerdict(report), tone = (n) => (n >= 90 ? 'good' : n >= 75 ? 'mid' : 'bad');
  $('sAcc').textContent = `${report.accuracy}%`; $('sAcc').parentElement.className = `stat ${tone(report.accuracy)}`;
  $('sRel').textContent = `${report.reliability}%`; $('sRel').parentElement.className = `stat ${tone(report.reliability + 15)}`;
  $('sLive').textContent = report.live ? `${report.live.passed}/${report.live.total}` : 'skipped'; $('sLive').parentElement.className = `stat ${report.live ? tone(report.live.accuracy) : ''}`;
  $('chips').replaceChildren(...POSES.filter((p) => p.compass !== null || report.per.some((q) => q.pose === p.id)).map((p) => { const q = report.per.find((x) => x.pose === p.id), c = document.createElement('span'); c.className = `chip ${q && q.weak ? 'weak' : 'good'}`; c.textContent = p.id === 'center' ? 'straight' : p.id.replace(/([A-Z])/g, ' $1').toLowerCase(); return c; }));
  $('report').hidden = false; document.body.classList.add('report'); if (report.status === 'good') document.body.classList.add('done');
  say(v.title, v.line, report.status !== 'good');
  $('redoweak').hidden = !(report.status !== 'good' && report.weak.length && report.weak.length < 9);
  $('again').hidden = report.status === 'good'; $('again').textContent = report.status === 'poor' ? 'Redo the whole scan' : 'Redo everything';
  $('cancel').textContent = report.status === 'good' ? 'Done' : 'Keep it as it is';
  draw(Date.now());
  if (report.status === 'good') setTimeout(() => { if (phase === 'report') relay.enrollClose(); }, 12000);
}

function leaveReport() { report = null; $('report').hidden = true; document.body.classList.remove('report', 'done'); $('redoweak').hidden = true; $('again').hidden = true; $('cancel').textContent = 'Cancel'; }
function redoWeak() {
  if (!report || !report.weak.length) return;
  const ids = [...report.weak]; samples = samples.filter((s) => !ids.includes(s.pose)); leaveReport();
  capture.redo(ids); smooth = null; embedFails = 0; phase = 'running'; draw(Date.now());
}

function restart() { leaveReport(); capture.reset(); samples = []; smooth = null; embedFails = 0; phase = 'running'; draw(Date.now()); }
function stopCamera() { try { stream?.getTracks().forEach((t) => t.stop()); } catch { /* gone */ } stream = null; }
function close() { stopped = true; clearInterval(timer); stopCamera(); try { landmarker?.close?.(); } catch { /* gone */ } relay.enrollClose(); }

$('x').onclick = $('cancel').onclick = close;
$('again').onclick = restart; $('redoweak').onclick = redoWeak;
addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); if (e.key === 'd' || e.key === 'D') $('debug').hidden = !$('debug').hidden; });
addEventListener('beforeunload', () => { stopped = true; clearInterval(timer); stopCamera(); try { landmarker?.close?.(); } catch { /* gone */ } });

// ---- start ----
(async () => {
  try {
    const st = await relay.enrollState();
    if (st?.name) $('title').textContent = `ADD ${st.name.toUpperCase()}`;
    const [fileset, em] = await Promise.all([FilesetResolver.forVisionTasks('./vendor/mediapipe/wasm'), createEmbedder()]);
    embed = em;
    const make = (delegate) => FaceLandmarker.createFromOptions(fileset, { baseOptions: { modelAssetPath: './vendor/mediapipe/face_landmarker.task', delegate }, runningMode: 'VIDEO', numFaces: 2 });
    try { landmarker = await make('GPU'); } catch { landmarker = await make('CPU'); }
    // the same size picture that recognition uses later, so the numbers captured here match the ones it compares
    // a camera that never answers (another app holding it, or a permission prompt nobody sees) must not leave this window on "Getting ready" forever
    const asked = navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480, frameRate: { ideal: 30 } }, audio: false });
    stream = await Promise.race([asked, new Promise((_, no) => setTimeout(() => no(new Error('CameraTimeout')), 15000))]);
    video.srcObject = stream; await video.play();
    phase = 'running'; draw(Date.now());
    timer = setInterval(look, 60);
  } catch (e) {
    const m = String(e?.message || e);
    if (/denied|NotAllowed|Permission/i.test(m)) say('Camera access is off', 'Turn it on for Relay in System Settings > Privacy & Security > Camera, then open this window again.', true);
    else if (/NotFound|Requested device/i.test(m)) say('No camera found', 'Connect a camera and open this window again.', true);
    else if (/CameraTimeout/.test(m)) say('The camera did not start', 'Close any other app that is using the camera, check Relay has Camera access in System Settings > Privacy & Security, then open this window again.', true);
    else say('Could not start', m.slice(0, 140), true);
    phase = 'failed';
  }
})();
