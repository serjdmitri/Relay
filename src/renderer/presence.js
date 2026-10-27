/* global relay */
// Counts the faces in the camera picture once a second (Google's MediaPipe face finder, on this Mac) and sends only that number.
import { FaceDetector, FilesetResolver } from './vendor/mediapipe/vision_bundle.mjs';

const video = document.getElementById('v');
const status = (state, extra = {}) => { try { relay.presenceStatus({ state, ...extra }); } catch { /* the page may be closing */ } };
let detector = null;
let stream = null;
let timer = 0;
let stopped = false;

async function start() {
  try {
    const fileset = await FilesetResolver.forVisionTasks('./vendor/mediapipe/wasm');
    const make = (delegate) => FaceDetector.createFromOptions(fileset, { baseOptions: { modelAssetPath: './vendor/mediapipe/blaze_face_short_range.tflite', delegate }, runningMode: 'VIDEO', minDetectionConfidence: 0.5 });
    try { detector = await make('GPU'); } catch { detector = await make('CPU'); }
    stream = await navigator.mediaDevices.getUserMedia({ video: { width: 320, height: 240, frameRate: { ideal: 5, max: 10 } }, audio: false });
    video.srcObject = stream;
    await video.play();
    status('running');
    timer = setInterval(() => {
      if (stopped || video.readyState < 2) return;
      try { relay.presenceFrame({ faces: detector.detectForVideo(video, performance.now()).detections.length }); } catch { /* a bad picture: skip it */ }
    }, 1000);
  } catch (e) {
    status('error', { message: /denied|NotAllowed|Permission/i.test(String(e)) ? 'Camera access is off. Turn it on for Relay in System Settings > Privacy & Security > Camera.' : /NotFound|Requested device/i.test(String(e)) ? 'No camera was found.' : `Presence could not start: ${String(e.message || e).slice(0, 120)}` });
  }
}

addEventListener('beforeunload', () => { stopped = true; clearInterval(timer); stream?.getTracks().forEach((t) => t.stop()); detector?.close?.(); });
start();
