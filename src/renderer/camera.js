// The camera window's page: shows the camera with faded edges and draws a named box, filled at low opacity, round each thing the object finder sees. Keeps nothing.
// window.__cameraShot() hands the app one picture (and the names in it) when Jarvis is asked what it sees. window.__camera({ fade, boxes, filter }) is how voice commands change the view.
import { ObjectDetector, FilesetResolver } from './vendor/mediapipe/vision_bundle.mjs';

const video = document.getElementById('v'), canvas = document.getElementById('boxes'), msg = document.getElementById('msg');
const ctx = canvas.getContext('2d');
let stream = null, detector = null, seen = [];
// The boxes are OFF until you ask ("show the boxes"); the finder still runs, so "what do you see" still knows the names.
const view = { boxes: false, filter: [], fade: 58 }; // fade: where the solid centre ends, in percent of the way out (lower = softer edges)

document.getElementById('x').onclick = () => window.close();
addEventListener('keydown', (e) => { if (e.key === 'Escape') window.close(); });
addEventListener('pagehide', () => { try { stream?.getTracks().forEach((t) => t.stop()); } catch { /* gone */ } });

const $ = (id) => document.getElementById(id);
function updateBar() {
  $('b-boxes').setAttribute('aria-pressed', String(view.boxes));
  $('b-people').setAttribute('aria-pressed', String(view.filter.length === 1 && view.filter[0] === 'person'));
}
// The window ignores the mouse when it is full screen (so it never blocks the screen); while the pointer is over the bar it listens, and goes back to ignoring as soon as the pointer leaves.
const hover = (on) => { try { window.relay?.cameraHover?.(on); } catch { /* no bridge */ } };
let over = false, lastPing = 0;
addEventListener('mousemove', (e) => { // forwarded to this page even while the window ignores the mouse
  const on = !!e.target?.closest?.('#bar'), now = Date.now();
  if (on && (!over || now - lastPing > 1000)) { lastPing = now; hover(true); }
  if (!on && over) hover(false);
  over = on;
}, true);
document.documentElement.addEventListener('mouseleave', () => { if (over) { over = false; hover(false); } });
$('b-boxes').onclick = () => window.__camera({ boxes: !view.boxes });
$('b-people').onclick = () => { const on = view.filter.length === 1 && view.filter[0] === 'person'; window.__camera({ filter: on ? [] : ['person'], boxes: on ? view.boxes : true }); };
$('b-close').onclick = () => { hover(false); window.close(); };
$('b-cam').onclick = () => nextCamera();

window.__camera = (o = {}) => {
  if (Number.isFinite(o.fadeBy)) view.fade = Math.max(8, Math.min(90, view.fade - o.fadeBy * 12)); // "more" fade means a smaller solid centre
  if (typeof o.full === 'boolean') document.documentElement.classList.toggle('full', o.full); // full screen: no faded edges, the picture fills the screen
  if (typeof o.boxes === 'boolean') view.boxes = o.boxes;
  if (Array.isArray(o.filter)) view.filter = o.filter.map((s) => String(s).toLowerCase());
  document.documentElement.style.setProperty('--inner', view.fade + '%');
  if (!view.boxes) ctx.clearRect(0, 0, canvas.width, canvas.height);
  updateBar();
  return { fade: view.fade, boxes: view.boxes, filter: view.filter };
};

window.__cameraShot = () => {
  try {
    const w = video.videoWidth || 0, h = video.videoHeight || 0;
    if (!w || !h || video.readyState < 2) return null;
    const c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d').drawImage(video, 0, 0, w, h);
    return { jpeg: c.toDataURL('image/jpeg', 0.8), names: seen.map((s) => s.name), at: Date.now() };
  } catch { return null; }
};

const hue = (name) => { let h = 0; for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 360; return h; };
const matches = (name) => !view.filter.length || view.filter.some((f) => name.includes(f) || f.includes(name));

function draw(dets) {
  const cw = canvas.clientWidth, ch = canvas.clientHeight, vw = video.videoWidth, vh = video.videoHeight, dpr = devicePixelRatio || 1;
  if (canvas.width !== Math.round(cw * dpr) || canvas.height !== Math.round(ch * dpr)) { canvas.width = Math.round(cw * dpr); canvas.height = Math.round(ch * dpr); }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, cw, ch);
  if (!view.boxes || !vw || !vh) return;
  const s = Math.max(cw / vw, ch / vh), ox = (cw - vw * s) / 2, oy = (ch - vh * s) / 2; // the picture fills the window (object-fit: cover)
  ctx.font = '600 12px -apple-system, system-ui, sans-serif'; ctx.textBaseline = 'middle';
  for (const d of dets) {
    const b = d.boundingBox, name = d.categories?.[0]?.categoryName || 'object', score = d.categories?.[0]?.score || 0;
    if (!matches(name)) continue;
    const w = b.width * s, h = b.height * s, x = cw - (ox + b.originX * s + w), y = oy + b.originY * s; // mirrored like the picture
    const hu = hue(name);
    ctx.fillStyle = `hsla(${hu}, 90%, 60%, .16)`; ctx.strokeStyle = `hsla(${hu}, 90%, 68%, .95)`; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.roundRect(x, y, w, h, 8); ctx.fill(); ctx.stroke();
    const label = `${name} ${Math.round(score * 100)}%`, tw = ctx.measureText(label).width + 14, ly = y >= 22 ? y - 22 : y + 2;
    ctx.fillStyle = `hsla(${hu}, 70%, 22%, .82)`; ctx.beginPath(); ctx.roundRect(x, ly, tw, 20, 6); ctx.fill();
    ctx.fillStyle = '#eaf9ff'; ctx.fillText(label, x + 7, ly + 10.5);
  }
}

async function look() {
  if (!detector || video.readyState < 2) return;
  try {
    const dets = detector.detectForVideo(video, performance.now()).detections || [];
    seen = dets.map((d) => ({ name: d.categories?.[0]?.categoryName || 'object' })).filter((d) => matches(d.name));
    draw(dets);
  } catch { /* a bad picture: skip it */ }
}

// Which camera: the one that faces whoever is at the computer (the built-in one), not an iPhone or a Desk View camera that happens to be the system default. "Camera" on the bar cycles through the others.
const FACING = /facetime|built-in|macbook|isight|studio display/i, NOT_FACING = /desk view|iphone|ipad|continuity|virtual|obs/i;
const constraints = (deviceId) => ({ video: { ...(deviceId ? { deviceId: { exact: deviceId } } : {}), width: 1280, height: 720, frameRate: { ideal: 30 } }, audio: false });
async function cameras() { try { return (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput'); } catch { return []; } }
async function useCamera(deviceId) {
  const next = await navigator.mediaDevices.getUserMedia(constraints(deviceId));
  try { stream?.getTracks().forEach((t) => t.stop()); } catch { /* gone */ }
  stream = next; video.srcObject = stream; await video.play();
  try { localStorage.setItem('cameraId', stream.getVideoTracks()[0]?.getSettings?.().deviceId || ''); } catch { /* no storage */ }
}
async function nextCamera() {
  const all = await cameras(); if (all.length < 2) { msg.textContent = 'Only one camera found.'; setTimeout(() => { msg.textContent = ''; }, 2500); return; }
  const cur = stream?.getVideoTracks()[0]?.getSettings?.().deviceId, i = all.findIndex((d) => d.deviceId === cur), pick = all[(i + 1) % all.length];
  try { await useCamera(pick.deviceId); msg.textContent = pick.label || 'Next camera'; setTimeout(() => { msg.textContent = ''; }, 2500); } catch { msg.textContent = 'That camera would not start.'; }
}
async function preferFacing() {
  try {
    const all = await cameras(), cur = stream?.getVideoTracks()[0]?.getSettings?.().deviceId;
    let want = ''; try { want = localStorage.getItem('cameraId') || ''; } catch { /* no storage */ }
    const pick = all.find((d) => d.deviceId === want) || all.find((d) => FACING.test(d.label) && !NOT_FACING.test(d.label));
    if (pick && pick.deviceId !== cur) await useCamera(pick.deviceId);
  } catch { /* keep the default camera */ }
}

(async () => {
  try {
    const asked = navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720, frameRate: { ideal: 30 } }, audio: false });
    stream = await Promise.race([asked, new Promise((_, no) => setTimeout(() => no(new Error('CameraTimeout')), 15000))]);
    video.srcObject = stream; await video.play(); await preferFacing(); msg.textContent = 'Finding what I can see…';
  } catch (e) {
    const m = String(e?.message || e);
    msg.textContent = /CameraTimeout/.test(m) ? 'The camera did not answer. Another app may be using it.' : /Permission|NotAllowed/i.test(m) ? 'Relay may not use the camera. Allow it in System Settings > Privacy & Security > Camera.' : 'The camera could not start.';
    return;
  }
  try {
    const fileset = await FilesetResolver.forVisionTasks('./vendor/mediapipe/wasm');
    const make = (delegate) => ObjectDetector.createFromOptions(fileset, { baseOptions: { modelAssetPath: './vendor/mediapipe/efficientdet_lite0.tflite', delegate }, runningMode: 'VIDEO', scoreThreshold: 0.35, maxResults: 12 });
    try { detector = await make('GPU'); } catch { detector = await make('CPU'); }
    msg.textContent = '';
    setInterval(look, 120);
  } catch { msg.textContent = 'The camera is on, but the object finder could not start.'; }
})();
