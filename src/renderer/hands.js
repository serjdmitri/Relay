/* global relay */
// Finds your hands in the camera picture, on this Mac, and sends only where they are and what they are doing (never a picture).
import { GestureRecognizer, FilesetResolver } from './vendor/mediapipe/vision_bundle.mjs';
import { poseOf, pinchOf } from './hand-pose.js';

const video = document.getElementById('v');
const status = (s, extra = {}) => { try { relay.handStatus({ state: s, ...extra }); } catch { /* the page may be closing */ } };
let recognizer = null;
let timer = 0;
let stream = null;
let stopped = false;
let fps = 0;

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

// One recognised frame as plain numbers: for each hand its middle knuckle (0..1 across the picture), the gesture the model named, and how
// close thumb tip and index tip are compared with the size of the hand (about 0.1 pinched, 0.8 open).
export function frameFrom(result, t) {
  const hands = [];
  (result.landmarks || []).forEach((l, i) => {
    const size = dist(l[0], l[9]) || 1e-6;
    const g = result.gestures?.[i]?.[0];
    const own = poseOf(l);
    hands.push({ x: l[9].x, y: l[9].y, size: +size.toFixed(4), pinch: +pinchOf(l).toFixed(3), gesture: own !== 'None' ? own : (g?.categoryName || 'None'), model: g?.categoryName || 'None', score: +(g?.score ?? 1).toFixed(2), handed: result.handedness?.[i]?.[0]?.categoryName || '' });
  });
  return { t, hands };
}

async function load() {
  const fileset = await FilesetResolver.forVisionTasks('./vendor/mediapipe/wasm');
  const make = (delegate) => GestureRecognizer.createFromOptions(fileset, { baseOptions: { modelAssetPath: './vendor/mediapipe/gesture_recognizer.task', delegate }, runningMode: 'VIDEO', numHands: 2, minHandDetectionConfidence: 0.5, minHandPresenceConfidence: 0.5, minTrackingConfidence: 0.5 });
  try { return await make('GPU'); } catch { return make('CPU'); }
}

async function start() {
  try {
    recognizer = await load();
    status('model');
    stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480, frameRate: 30 }, audio: false });
    video.srcObject = stream;
    await video.play();
    status('running');
    let last = -1, n = 0, t0 = performance.now();
    timer = setInterval(() => {
      if (stopped || video.readyState < 2 || video.currentTime === last) return;
      last = video.currentTime;
      const now = performance.now();
      const r = recognizer.recognizeForVideo(video, now);
      relay.handFrame(frameFrom(r, Date.now()));
      if (++n % 60 === 0) { fps = Math.round(60000 / (now - t0)); t0 = now; }
    }, 16);
  } catch (e) {
    status('error', { message: /denied|NotAllowed|Permission/i.test(String(e)) ? 'Camera access is off. Turn it on for Relay in System Settings > Privacy & Security > Camera.' : /NotFound|Requested device/i.test(String(e)) ? 'No camera was found.' : `Hand control could not start: ${String(e.message || e).slice(0, 120)}` });
  }
}

addEventListener('beforeunload', () => { stopped = true; clearInterval(timer); stream?.getTracks().forEach((t) => t.stop()); recognizer?.close?.(); });

// For the tests: find the hands in a still picture, with no camera.
window.__hands = {
  ready: () => !!recognizer,
  fps: () => fps,
  async still(img) {
    if (!recognizer) recognizer = await load();
    await recognizer.setOptions({ runningMode: 'IMAGE' });
    const r = recognizer.recognize(img);
    await recognizer.setOptions({ runningMode: 'VIDEO' });
    return frameFrom(r, 0);
  }
};
if (!location.search.includes('still')) start();
