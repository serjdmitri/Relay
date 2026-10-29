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
  const make = (delegate) => GestureRecognizer.createFromOptions(fileset, { baseOptions: { modelAssetPath: './vendor/mediapipe/gesture_recognizer.task', delegate }, runningMode: 'VIDEO', numHands: 4, minHandDetectionConfidence: 0.5, minHandPresenceConfidence: 0.5, minTrackingConfidence: 0.5 });
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
      if (previewOn) draw(r);
      if (++n % 60 === 0) { fps = Math.round(60000 / (now - t0)); t0 = now; }
    }, 16);
  } catch (e) {
    status('error', { message: /denied|NotAllowed|Permission/i.test(String(e)) ? 'Camera access is off. Turn it on for Relay in System Settings > Privacy & Security > Camera.' : /NotFound|Requested device/i.test(String(e)) ? 'No camera was found.' : `Hand control could not start: ${String(e.message || e).slice(0, 120)}` });
  }
}

// ---- the hand view: the camera picture (mirrored, like a mirror), the outline of each hand the finder sees, what each hand is doing, how many hands there are ----
const card = document.getElementById('card');
const cv = document.getElementById('cv');
const g = cv.getContext('2d');
const countEl = document.getElementById('count');
const stateEl = document.getElementById('state');
const actEl = document.getElementById('act');
const noneEl = document.getElementById('none');
const hitbox = document.getElementById('hitbox');
function showHitbox(margin) { const n = Math.max(0.04, Math.min(0.35, Number(margin) || 0.22)) * 100; hitbox.style.inset = `${n}%`; }
showHitbox(0.22);
let previewOn = false;
let actTimer = 0;

// The 21 points of a hand are joined like this: the wrist to each finger's base, then up each finger, and across the palm.
const BONES = [[0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12], [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [17, 18], [18, 19], [19, 20], [0, 17]];
const TIPS = [4, 8, 12, 16, 20];
const NAMES = { Closed_Fist: 'Fist', Open_Palm: 'Open hand', Victory: 'Peace sign', Pointing_Up: 'Pointing', Thumb_Up: 'Thumb up', Thumb_Down: 'Thumb down', ILoveYou: 'Open hand', None: 'Hand' };
const ACTIONS = { grab: 'Grab', release: 'Let go', pinchdown: 'Pinch', pinchup: 'Let go', click: 'Click', scale: 'Resize', twist: 'Roll', pull: 'Pull apart', mic: 'Listening', thumbup: 'Kept', thumbdown: 'Closed', point: 'Point', lost: 'Hand lost' };
export const nameOf = (h) => (h.pinch !== undefined && h.pinch < 0.3 ? 'Pinch' : NAMES[h.gesture] || 'Hand');

function draw(result, src = video) {
  const W = cv.width, H = cv.height;
  g.clearRect(0, 0, W, H);
  g.save(); g.translate(W, 0); g.scale(-1, 1); g.globalAlpha = 0.6; g.drawImage(src, 0, 0, W, H); g.restore(); g.globalAlpha = 1;
  const frame = frameFrom(result, 0);
  const lm = result.landmarks || [];
  lm.forEach((l, i) => {
    const pt = (k) => [(1 - l[k].x) * W, l[k].y * H]; // mirrored, to match the picture
    g.lineCap = 'round'; g.lineJoin = 'round';
    g.strokeStyle = 'rgba(76,194,255,.95)'; g.lineWidth = 4; g.shadowColor = 'rgba(76,194,255,.8)'; g.shadowBlur = 10;
    g.beginPath();
    for (const [a, b] of BONES) { const [x1, y1] = pt(a), [x2, y2] = pt(b); g.moveTo(x1, y1); g.lineTo(x2, y2); }
    g.stroke();
    g.shadowBlur = 0;
    for (let k = 0; k < 21; k++) { const [x, y] = pt(k); g.fillStyle = TIPS.includes(k) ? '#eef6fb' : '#9fdcff'; g.beginPath(); g.arc(x, y, TIPS.includes(k) ? 5 : 3.2, 0, 7); g.fill(); }
    const [wx, wy] = pt(0);
    const label = nameOf(frame.hands[i]);
    g.font = '600 22px -apple-system, Helvetica, Arial, sans-serif';
    const w = g.measureText(label).width + 22;
    const lx = Math.max(6, Math.min(W - w - 6, wx - w / 2)), ly = Math.max(6, Math.min(H - 40, wy + 14));
    g.fillStyle = 'rgba(4,18,28,.86)'; g.strokeStyle = 'rgba(76,194,255,.7)'; g.lineWidth = 2;
    g.beginPath(); g.roundRect(lx, ly, w, 34, 17); g.fill(); g.stroke();
    g.fillStyle = '#eef6fb'; g.fillText(label, lx + 11, ly + 24);
  });
  const n = lm.length;
  countEl.textContent = n === 0 ? 'No hand' : n === 1 ? '1 hand' : '2 hands';
  noneEl.hidden = n > 0;
  const names = frame.hands.map(nameOf);
  stateEl.textContent = n === 0 ? 'Hand view' : n === 2 && names[0] === names[1] ? `${names[0]} + ${names[1]}${names[0] === 'Pinch' ? ' · resize' : names[0] === 'Fist' ? ' · pull apart' : ''}` : names.join(' + ');
}

try {
  relay.onHandPreview((on) => { previewOn = !!on; card.hidden = !previewOn; });
  relay.onHandConfig?.((c) => showHitbox(c.margin));
  relay.onHandAction((a) => {
    const t = a.type === 'swipe' ? `Swipe ${a.dir === 'left' ? '←' : '→'}` : ACTIONS[a.type];
    if (!t) return;
    actEl.textContent = t; actEl.classList.add('on');
    clearTimeout(actTimer); actTimer = setTimeout(() => actEl.classList.remove('on'), 1300);
  });
} catch { /* a test page without the bridge */ }

addEventListener('beforeunload', () => { stopped = true; clearInterval(timer); stream?.getTracks().forEach((t) => t.stop()); recognizer?.close?.(); });

// For the tests: find the hands in a still picture, with no camera.
window.__hands = {
  preview: (on) => { previewOn = !!on; card.hidden = !previewOn; },
  draw,
  async stillDraw(img, plain = false) { const f = await this.still(img); previewOn = true; card.hidden = false; await recognizer.setOptions({ runningMode: 'IMAGE' }); let src = img; if (plain) { src = document.createElement('canvas'); src.width = 640; src.height = 480; const c = src.getContext('2d'); const gr = c.createRadialGradient(320, 260, 40, 320, 240, 420); gr.addColorStop(0, '#12354f'); gr.addColorStop(1, '#04080d'); c.fillStyle = gr; c.fillRect(0, 0, 640, 480); } draw(recognizer.recognize(img), src); await recognizer.setOptions({ runningMode: 'VIDEO' }); return f; },
  action: (a) => { const t = ACTIONS[a.type]; if (t) { actEl.textContent = t; actEl.classList.add('on'); } },
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
