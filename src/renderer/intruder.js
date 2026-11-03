/* global relay */
// The two screens over the blurred desktop: ALARM (a face that is not yours; red reactor, siren, spoken warning, countdown to the lock) and AWAY (you stepped
// away; calm blue reactor and a spoken "the owner will be back soon" until you return). The main process owns the state; this page only draws and sounds it,
// and stops everything the moment the state says it is over. The reactor is drawn like the regular Jarvis one (halo, pulse rings, three spinning dash rings,
// two scanners, ticks, crosshair, core) and breathes in and out while it turns.
const $ = (id) => document.getElementById(id);
const rad = (d) => (d * Math.PI) / 180;

const PALETTE = {
  alarm: { pri: '255,59,48', acc: '255,176,150', core: [110, 8, 4], label: 'DENIED' },
  away: { pri: '0,212,255', acc: '170,240,255', core: [0, 60, 110], label: 'STANDBY' }
};

function createReactor(canvas) {
  const ctx = canvas.getContext('2d');
  const rings = [0, 120, 240];
  let scan = 0, scan2 = 180, pulses = [], particles = [], kick = 0, size = 0, dpr = 1, last = performance.now(), phase = 0;

  function fit() {
    const fw = Math.round(Math.min(innerWidth, innerHeight) * 0.40), css = Math.round(fw * 1.5);
    dpr = window.devicePixelRatio || 1;
    if (size !== css) { size = css; canvas.style.width = css + 'px'; canvas.style.height = css + 'px'; canvas.width = Math.round(css * dpr); canvas.height = Math.round(css * dpr); }
    return fw;
  }
  const arc = (cx, cy, r, start, len, color, w) => { ctx.beginPath(); ctx.strokeStyle = color; ctx.lineWidth = w; ctx.arc(cx, cy, r, -rad(start + len), -rad(start)); ctx.stroke(); };

  return {
    // a beat (the siren changing tone): the whole reactor throbs
    kick(v = 1) { kick = Math.max(kick, v); },
    // mode: 'alarm' | 'away'; urgency 0..1 (alarm: how close the lock is)
    draw(mode, urgency, text) {
      const P = PALETTE[mode] || PALETTE.alarm, now = performance.now(), dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const fw = fit(), C = size / 2, cx = C, cy = C;
      const calm = mode === 'away';
      // breathing: in and out, quicker as the lock gets closer; the beat adds a throb
      phase += dt * Math.PI * 2 * (calm ? 0.32 : 0.8 + urgency * 1.8);
      kick *= Math.pow(0.02, dt);
      const breath = 1 + (calm ? 0.045 : 0.075 + urgency * 0.04) * Math.sin(phase) + 0.07 * kick;
      const glow = (calm ? 0.78 : 0.85) + 0.22 * Math.sin(phase) + 0.25 * kick;
      const boost = (calm ? 0.6 : 1.3 + urgency * 1.6) + kick * 1.2;
      const frame = dt * 60;
      for (const [i, s] of [0.55, -0.35, 0.9].entries()) rings[i] = (rings[i] + s * boost * frame) % 360;
      scan = (scan + 1.5 * boost * frame) % 360; scan2 = (scan2 - 0.9 * boost * frame + 360) % 360;
      const lim = fw * 0.74;
      pulses = pulses.map((r) => r + (calm ? 1.1 : 2.4 + urgency * 2) * frame).filter((r) => r < lim);
      if (pulses.length < 3 && Math.random() < (calm ? 0.012 : 0.04) * frame) pulses.push(0);
      if (!calm && Math.random() < (0.10 + urgency * 0.25) * frame) { const a = Math.random() * Math.PI * 2; particles.push([cx + Math.cos(a) * fw * 0.28, cy + Math.sin(a) * fw * 0.28, Math.cos(a) * (0.9 + Math.random() * 1.6), Math.sin(a) * (0.9 + Math.random() * 1.6) - 0.3, 1]); }
      particles = particles.map((p) => [p[0] + p[2] * frame, p[1] + p[3] * frame, p[2] * 0.97, p[3] * 0.97, p[4] - 0.028 * frame]).filter((p) => p[4] > 0);

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, size, size);
      ctx.lineCap = 'butt';
      ctx.translate(cx, cy); ctx.scale(breath, breath); ctx.translate(-cx, -cy); // the pulse in and out
      const halo = 200 * glow;

      for (let i = 0; i < 10; i++) { // halo
        ctx.beginPath(); ctx.strokeStyle = `rgba(${P.pri},${Math.min(1, ((halo * 0.085 * (1 - i / 10)) / 255) * 1.5)})`; ctx.lineWidth = 1.8; ctx.arc(cx, cy, fw * 0.31 * (1.8 - i * 0.08), 0, Math.PI * 2); ctx.stroke();
      }
      for (const pr of pulses) { ctx.beginPath(); ctx.strokeStyle = `rgba(${P.pri},${Math.max(0, 0.9 * (1 - pr / lim))})`; ctx.lineWidth = 1.5; ctx.arc(cx, cy, pr, 0, Math.PI * 2); ctx.stroke(); }
      [[0.48, 3, 115, 78], [0.40, 2, 78, 55], [0.32, 1, 56, 40]].forEach(([rf, w, len, gap], idx) => {
        const a = Math.max(0, Math.min(1, (halo * (1 - idx * 0.12)) / 255 * 1.25));
        for (let ang = rings[idx]; ang < rings[idx] + 360; ang += len + gap) arc(cx, cy, fw * rf, ang, len, `rgba(${P.pri},${a})`, w + 0.8);
      });
      const sa = Math.min(1, (halo * 1.5) / 255), ex = calm ? 40 : 60;
      arc(cx, cy, fw * 0.5, scan, ex, `rgba(${P.pri},${sa})`, 3.2);
      arc(cx, cy, fw * 0.5, scan2, ex, `rgba(${P.acc},${Math.min(1, sa * 0.75)})`, 2);
      ctx.strokeStyle = `rgba(${P.pri},0.85)`; ctx.lineWidth = 1.4; // tick marks
      for (let deg = 0; deg < 360; deg += 10) {
        const inn = deg % 30 === 0 ? fw * 0.474 : fw * 0.474 + 6, r = rad(deg);
        ctx.beginPath(); ctx.moveTo(cx + fw * 0.497 * Math.cos(r), cy - fw * 0.497 * Math.sin(r)); ctx.lineTo(cx + inn * Math.cos(r), cy - inn * Math.sin(r)); ctx.stroke();
      }
      const chR = fw * 0.51, gap = fw * 0.16; // crosshair
      ctx.strokeStyle = `rgba(${P.pri},${Math.min(1, (halo * 0.8) / 255)})`; ctx.beginPath();
      ctx.moveTo(cx - chR, cy); ctx.lineTo(cx - gap, cy); ctx.moveTo(cx + gap, cy); ctx.lineTo(cx + chR, cy);
      ctx.moveTo(cx, cy - chR); ctx.lineTo(cx, cy - gap); ctx.moveTo(cx, cy + gap); ctx.lineTo(cx, cy + chR); ctx.stroke();
      const orb = fw * 0.27 * (1 + 0.03 * Math.sin(phase * 2)); // core
      for (let i = 8; i > 0; i--) {
        const f = i / 8; ctx.beginPath(); ctx.fillStyle = `rgba(${Math.round(P.core[0] * f)},${Math.round(P.core[1] * f)},${Math.round(P.core[2] * f)},${Math.max(0, Math.min(1, (halo * 1.1 * f) / 255))})`; ctx.arc(cx, cy, (orb * i) / 8, 0, Math.PI * 2); ctx.fill();
      }
      ctx.beginPath(); ctx.strokeStyle = `rgba(${P.pri},1)`; ctx.lineWidth = 2; ctx.arc(cx, cy, orb, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = 'rgba(255,240,236,1)'; ctx.font = `700 ${Math.round(fw * 0.04)}px ui-monospace, SFMono-Regular, Menlo, monospace`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(text || P.label, cx, cy);
      for (const p of particles) { ctx.beginPath(); ctx.fillStyle = `rgba(${P.pri},${Math.max(0, p[4])})`; ctx.arc(p[0], p[1], 2.5, 0, Math.PI * 2); ctx.fill(); }
    }
  };
}

const reactor = createReactor($('reactor'));

// ---- sound ----
let ctxA = null, osc = null, sirenTimer = 0, speakTimer = 0, soundMode = null;
const LINES = {
  alarm: ['Access denied. This is not your computer.'],
  away: ['The owner will be back soon.', 'This computer is on standby.', 'Please do not touch anything. The owner will return shortly.', 'The owner is away from the desk.']
};
function say(text, quiet) { try { const u = new SpeechSynthesisUtterance(text); u.rate = 0.92; u.pitch = 0.8; u.volume = quiet ? 0.7 : 1; speechSynthesis.cancel(); speechSynthesis.speak(u); } catch { /* no voice */ } }
function startSound(mode) {
  soundMode = mode;
  if (mode === 'alarm') {
    try {
      ctxA = new (window.AudioContext || window.webkitAudioContext)();
      osc = ctxA.createOscillator(); const gain = ctxA.createGain();
      osc.type = 'sawtooth'; gain.gain.value = 0.16; osc.connect(gain).connect(ctxA.destination); osc.start();
      let hi = false;
      const swap = () => { hi = !hi; osc.frequency.setValueAtTime(hi ? 940 : 620, ctxA.currentTime); reactor.kick(1); }; // the reactor throbs with the siren
      swap(); sirenTimer = setInterval(swap, 450);
    } catch { /* no audio: the picture still shows */ }
  }
  let n = 0;
  const speak = () => { const l = LINES[mode]; say(l[n++ % l.length], mode === 'away'); };
  speak(); speakTimer = setInterval(speak, mode === 'alarm' ? 7000 : 12000);
}
function stopSound() {
  clearInterval(sirenTimer); clearInterval(speakTimer);
  try { speechSynthesis.cancel(); } catch { /* none */ }
  try { osc?.stop(); ctxA?.close(); } catch { /* already stopped */ }
  osc = ctxA = null; soundMode = null;
}

// ---- state ----
let state = { active: false };
async function poll() { try { state = (await relay.intruderState()) || { active: false }; } catch { /* the window is closing */ } }
setInterval(poll, 250); poll();

const mmss = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
function frame() {
  requestAnimationFrame(frame);
  if (!state.active || state.paused) { if (soundMode) stopSound(); return; } // paused: the Touch ID sheet is up
  const mode = state.mode === 'away' ? 'away' : 'alarm';
  if (document.body.className !== mode) { document.body.className = mode; if (soundMode) stopSound(); }
  if (soundMode !== mode) startSound(mode);
  let urgency = 0;
  if (mode === 'alarm') {
    const left = Math.max(0, Math.ceil((state.endsAt - Date.now()) / 1000));
    urgency = Math.max(0, Math.min(1, 1 - left / Math.max(1, state.total || 20)));
    $('line1').textContent = 'THIS IS NOT YOUR COMPUTER'; $('line2').textContent = 'ACCESS DENIED';
    $('count').textContent = left > 0 ? `Locking in ${left} second${left === 1 ? '' : 's'}` : 'Locking now';
    $('note').textContent = state.demo ? 'This is only a test. Nothing will lock.' : 'If this is you, look at the camera and the alarm will stop.';
  } else {
    const away = Math.max(0, Math.floor((Date.now() - (state.since || Date.now())) / 1000));
    $('line1').textContent = 'THE OWNER WILL BE BACK SOON'; $('line2').textContent = 'COMPUTER ON STANDBY';
    $('count').textContent = `Away for ${mmss(away)}`;
    $('note').textContent = 'It wakes up when the owner is back in front of the camera.';
  }
  $('touch').hidden = !state.touchId;
  reactor.draw(mode, urgency);
}

// Touch ID: the owner stops the screen with a fingerprint. The system asks; if it is not accepted the screen comes back with a short note.
let noteUntil = 0;
$('touch').addEventListener('click', async () => {
  let r = null;
  try { r = await relay.intruderFingerprint(); } catch { /* the window is closing */ }
  if (r && !r.ok) { $('touchlabel').textContent = r.error || 'Not recognised'; setTimeout(() => { $('touchlabel').textContent = 'Touch ID to stop'; }, 3500); }
});
requestAnimationFrame(frame);
addEventListener('beforeunload', stopSound);
