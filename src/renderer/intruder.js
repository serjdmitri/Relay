/* global relay */
// The "access denied" screen: a red Jarvis reactor over a blurred desktop, a siren and a spoken warning, and a countdown to the lock. The main process owns the state
// (when the countdown ends, whether it is only a test); this page only shows and sounds it, and stops everything the moment the state says it is over.
const $ = (id) => document.getElementById(id);

// the coil: ten short arcs around the core
const coil = $('coil');
for (let i = 0; i < 10; i++) {
  const a0 = (i / 10) * Math.PI * 2 + 0.12, a1 = ((i + 1) / 10) * Math.PI * 2 - 0.12, r = 52;
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', `M ${(Math.cos(a0) * r).toFixed(2)} ${(Math.sin(a0) * r).toFixed(2)} A ${r} ${r} 0 0 1 ${(Math.cos(a1) * r).toFixed(2)} ${(Math.sin(a1) * r).toFixed(2)}`);
  coil.appendChild(p);
}

// siren: two tones, alternating; quiet enough not to be painful, loud enough to be unmistakable
let ctx = null, osc = null, gain = null, sirenTimer = 0, speakTimer = 0;
function startSound() {
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    osc = ctx.createOscillator(); gain = ctx.createGain();
    osc.type = 'sawtooth'; gain.gain.value = 0.16;
    osc.connect(gain).connect(ctx.destination); osc.start();
    let hi = false;
    const swap = () => { hi = !hi; osc.frequency.setValueAtTime(hi ? 940 : 620, ctx.currentTime); };
    swap(); sirenTimer = setInterval(swap, 450);
  } catch { /* no audio: the picture still shows */ }
  const say = () => { try { const u = new SpeechSynthesisUtterance('Access denied. This is not your computer.'); u.rate = 0.92; u.pitch = 0.8; u.volume = 1; speechSynthesis.cancel(); speechSynthesis.speak(u); } catch { /* no voice */ } };
  say(); speakTimer = setInterval(say, 7000);
}
function stopSound() {
  clearInterval(sirenTimer); clearInterval(speakTimer);
  try { speechSynthesis.cancel(); } catch { /* none */ }
  try { osc?.stop(); ctx?.close(); } catch { /* already stopped */ }
  osc = ctx = null;
}

let sounding = false;
async function tick() {
  let s = null;
  try { s = await relay.intruderState(); } catch { /* the window is closing */ }
  if (!s || !s.active) { if (sounding) { stopSound(); sounding = false; } return; }
  if (!sounding) { startSound(); sounding = true; }
  const left = Math.max(0, Math.ceil((s.endsAt - Date.now()) / 1000));
  $('count').textContent = left > 0 ? `Locking in ${left} second${left === 1 ? '' : 's'}` : 'Locking now';
  $('note').textContent = s.demo ? 'This is only a test. Nothing will lock.' : 'If this is you, look at the camera and the alarm will stop.';
}
setInterval(tick, 250); tick();
addEventListener('beforeunload', stopSound);
