/* global relay */
// Counts the faces in the camera picture once a second (Google's MediaPipe face finder, on this Mac) and sends only that number. With Owner recognition on (opt-in),
// it also compares each face with your enrolled face (faceid.js) and sends a match score per face, or, while enrolling, 128 numbers describing your face. No picture leaves this page.
// Like Glance, recognition aligns each face on five landmarks (pupils, nose tip, mouth corners) before it is compared; the face landmarker supplies them several
// times a second, which also lets the liveness check see blinks.
import { FaceDetector, FaceLandmarker, FilesetResolver } from './vendor/mediapipe/vision_bundle.mjs';
import { LivenessTracker, lookingAway } from './liveness.js';

const video = document.getElementById('v');
const status = (state, extra = {}) => { try { relay.presenceStatus({ state, ...extra }); } catch { /* the page may be closing */ } };
let detector = null;
let stream = null;
let timer = 0;
let stopped = false;
let fileset = null, landmarker = null, lmFailed = false, lmLoading = false, lmBusy = false, recogOn = false, livenessOn = false, lmTimer = 0;
let lastLm = { t: 0, faces: [] }, watchdog = 0;
const tracker = new LivenessTracker();
const MIN_FACE = 0.14; // narrowest face (as a fraction of the picture width) that is judged
let busy = false, embed = null, embedFailed = false, templates = [], version = 0;
const cosine = (a, b) => { let d = 0, x = 0, y = 0; for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; x += a[i] * a[i]; y += b[i] * b[i]; } return d / (Math.sqrt(x) * Math.sqrt(y) || 1); };
const bestScore = (e, list) => list.reduce((best, t) => { const s = t.length === e.length ? cosine(e, t) : null; return s !== null && (best === null || s > best) ? s : best; }, null);

let embedLoading = false;
async function loadEmbedder() {
  embedLoading = true;
  try { embed = await (await import('./faceid.js')).createEmbedder(); } catch (e) { embedFailed = true; relay.presenceStatus({ state: 'faceid-error', message: 'Owner recognition could not load its face model: ' + String(e?.message || e).slice(0, 120) }); } finally { embedLoading = false; }
}

async function loadLandmarker() {
  lmLoading = true;
  try {
    const make = (delegate) => FaceLandmarker.createFromOptions(fileset, { baseOptions: { modelAssetPath: './vendor/mediapipe/face_landmarker.task', delegate }, runningMode: 'VIDEO', numFaces: 3, outputFaceBlendshapes: true, outputFacialTransformationMatrixes: true });
    try { landmarker = await make('GPU'); } catch { landmarker = await make('CPU'); }
    // blinks are quick, so this looks several times a second (only while owner recognition is on)
    lmTimer = setInterval(() => {
      if (stopped || !recogOn || lmBusy || video.readyState < 2) return;
      lmBusy = true;
      try {
        const r = landmarker.detectForVideo(video, performance.now());
        const faces = (r.faceLandmarks || []).map((lm, i) => {
          const cats = r.faceBlendshapes?.[i]?.categories || [], g = (n) => cats.find((c) => c.categoryName === n)?.score;
          const xs = lm.map((p) => p.x), width = Math.max(...xs) - Math.min(...xs);
          const away = lookingAway({ gazeDownL: g('eyeLookDownLeft'), gazeDownR: g('eyeLookDownRight'), matrix: r.facialTransformationMatrixes?.[i]?.data });
          return { lm, width, away, x: lm[1].x, y: lm[1].y, blinkL: g('eyeBlinkLeft'), blinkR: g('eyeBlinkRight') };
        });
        lastLm = { t: Date.now(), faces };
        if (livenessOn) tracker.update(faces, Date.now());
      } catch { /* a bad picture: skip it */ } finally { lmBusy = false; }
    }, 120);
  } catch (e) { lmFailed = true; relay.presenceStatus({ state: 'faceid-error', message: 'The face landmark finder could not start, so recognition is less accurate and a photo of you could pass: ' + String(e?.message || e).slice(0, 100) }); } finally { lmLoading = false; }
}


// A camera stream does not always survive the Mac sleeping (closing the lid) or another app taking the camera: it ends, or the picture freezes, and nothing says so. Then Relay is
// blind: it sees nobody, and the standby screen could stay up. So a stream that ends, or whose picture has not moved for 12 seconds, is started again by reloading this page.
// Reloads are counted, and after four in two minutes it gives up and says so, so a camera that is really gone cannot loop.
function watchStream() {
  const restart = () => {
    if (stopped) return; stopped = true; clearTimeout(timer); clearInterval(lmTimer);
    let log = []; try { log = JSON.parse(sessionStorage.getItem('camReloads') || '[]').filter((t) => Date.now() - t < 120000); } catch { /* no storage */ }
    if (log.length >= 4) { status('error', { message: 'The camera keeps stopping, so Presence and owner recognition cannot watch. Close any app using the camera, or turn Presence off and on.' }); return; }
    try { sessionStorage.setItem('camReloads', JSON.stringify([...log, Date.now()])); } catch { /* no storage */ }
    location.reload();
  };
  const track = stream?.getVideoTracks?.()[0];
  track?.addEventListener('ended', restart);
  let lastTime = video.currentTime, lastMove = Date.now();
  watchdog = setInterval(() => {
    if (video.currentTime !== lastTime) { lastTime = video.currentTime; lastMove = Date.now(); } else if (Date.now() - lastMove > 12000) restart();
  }, 4000);
}

async function start() {
  try {
    fileset = await FilesetResolver.forVisionTasks('./vendor/mediapipe/wasm');
    const make = (delegate) => FaceDetector.createFromOptions(fileset, { baseOptions: { modelAssetPath: './vendor/mediapipe/blaze_face_short_range.tflite', delegate }, runningMode: 'VIDEO', minDetectionConfidence: 0.5 });
    try { detector = await make('GPU'); } catch { detector = await make('CPU'); }
    // 640x480: a face seen from a normal sitting distance is small, and recognition needs the detail
    stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480, frameRate: { ideal: 8, max: 10 } }, audio: false });
    video.srcObject = stream;
    await video.play();
    status('running');
    watchStream();
    // Looks once a second, or faster while the main process is waiting to see you (it says so in the config: c.pace), so a return is recognised in under a second.
    let pace = 1000;
    const tick = async () => {
      const began = Date.now();
      if (stopped) return;
      if (busy || video.readyState < 2) { timer = setTimeout(tick, 200); return; }
      busy = true;
      try {
        const dets = detector.detectForVideo(video, performance.now()).detections;
        const frame = { faces: dets.length };
        // Owner recognition (opt-in): only when asked for. The main process says whether to match faces or to enroll yours.
        const c = await relay.presenceConfig(version);
        if (c?.templates) { templates = c.templates; version = c.version; }
        recogOn = !!c?.faceId; livenessOn = recogOn && !!c?.liveness && c.mode !== 'enroll';
        pace = Math.min(1000, Math.max(250, Number(c?.pace) || 1000));
        if (recogOn && !landmarker && !lmFailed && !lmLoading) loadLandmarker();
        // load the face model before the first face appears, not when it does, so the first recognition after starting is not delayed by it
        if (recogOn && !embed && !embedFailed && !embedLoading) loadEmbedder();
        if (recogOn && dets.length) {
          if (!embed && !embedFailed && !embedLoading) await loadEmbedder();
          if (embed) {
            // the accurate way: faces with their landmarks from the last few moments; the rough way (the face finder's four points) if the landmark finder is not running
            const fresh = landmarker && Date.now() - lastLm.t < 700 && lastLm.faces.length;
            const area = (d) => (d.boundingBox?.width || 0) * (d.boundingBox?.height || 0);
            const faces = fresh ? lastLm.faces.slice().sort((a, b) => b.width - a.width).slice(0, 3).map((f) => ({ lm: f.lm, x: f.x, y: f.y, width: f.width, away: !!f.away }))
              : dets.slice().sort((a, b) => area(b) - area(a)).slice(0, 3).map((d) => ({ keypoints: d.keypoints, x: d.keypoints?.[2]?.x, y: d.keypoints?.[2]?.y, width: (d.boundingBox?.width || 0) / (video.videoWidth || 1) }));
            if (c.mode === 'enroll') {
              if (faces.length === 1 && fresh) { const e = await embed(video, faces[0]); if (e) await relay.presenceEnroll({ embedding: e }); } // enrolling needs the accurate alignment
            } else {
              // like Glance, a face too small in the picture is a bystander or too far to judge: no score, rather than a low one
              frame.down = faces.some((f) => f.away); // looking down at the keyboard or turned aside: not the same as leaving, and not judged
              frame.scores = await Promise.all(faces.map(async (f) => { if (!(f.width >= MIN_FACE) || f.away) return null; const e = await embed(video, f); return e ? bestScore(e, templates) : null; }));
              // Liveness: a face that matches you but has not blinked lately is reported as not alive (a picture). Until the blink finder is ready, or if it cannot load, faces count as alive.
              frame.live = faces.map((f) => (livenessOn && fresh && Number.isFinite(f.x) ? tracker.isLive(f.x, f.y, Date.now()) !== false : true));
            }
          }
        }
        relay.presenceFrame(frame);
      } catch { /* a bad picture: skip it */ } finally { busy = false; if (!stopped) timer = setTimeout(tick, Math.max(50, pace - (Date.now() - began))); }
    };
    timer = setTimeout(tick, 1000);
  } catch (e) {
    status('error', { message: /denied|NotAllowed|Permission/i.test(String(e)) ? 'Camera access is off. Turn it on for Relay in System Settings > Privacy & Security > Camera.' : /NotFound|Requested device/i.test(String(e)) ? 'No camera was found.' : `Presence could not start: ${String(e.message || e).slice(0, 120)}` });
  }
}

addEventListener('beforeunload', () => { stopped = true; clearTimeout(timer); clearInterval(lmTimer); clearInterval(watchdog); landmarker?.close?.(); stream?.getTracks().forEach((t) => t.stop()); detector?.close?.(); });
start();
