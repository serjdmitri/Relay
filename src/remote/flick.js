// Flick photos from your phone to your Mac: choose photos, then flick the phone forward (or swipe the stack up, or press Send now) and they arrive on the Mac as holograms.
// FlickDetector is plain and testable (flick.test.js loads this file in Node); the page part only runs in a browser.

// Reads the phone's acceleration (gravity taken out, in m/s2) and says when a quick flick happened: a strong push that is over again within a moment. Walking about or a jostle is gentler than that.
class FlickDetector {
  constructor({ threshold = 14, calm = 6, maxMs = 400, gapMs = 1500 } = {}) {
    Object.assign(this, { threshold, calm, maxMs, gapMs });
    this.spikeAt = null; this.firedAt = -Infinity;
  }

  // ax, ay, az: the acceleration; t: time in ms. True once per flick.
  push(ax, ay, az, t) {
    const m = Math.hypot(Number(ax) || 0, Number(ay) || 0, Number(az) || 0);
    if (t - this.firedAt < this.gapMs) return false;
    if (this.spikeAt === null) { if (m >= this.threshold) this.spikeAt = t; return false; }
    if (t - this.spikeAt > this.maxMs) { this.spikeAt = null; return false; } // a long push or a shake that goes on is not a flick
    if (m <= this.calm) { this.spikeAt = null; this.firedAt = t; return true; }
    return false;
  }
}

function startPage() {
  const $ = (id) => document.getElementById(id);
  const token = localStorage.getItem('relay-remote-token') || '';
  if (!token) { location.href = '/'; return; }
  $('page').hidden = false;
  const MAX_BYTES = 30 * 1024 * 1024;
  let files = [], sending = false, urls = [];
  const say = (text, bad = false) => { $('msg').textContent = text; $('msg').className = bad ? 'err' : ''; };

  const render = () => {
    urls.forEach((u) => URL.revokeObjectURL(u)); urls = [];
    const pile = $('pile');
    pile.replaceChildren();
    if (!files.length) { pile.append($('empty')); $('go').hidden = true; return; }
    files.slice(0, 4).forEach((f, i) => {
      const u = URL.createObjectURL(f); urls.push(u);
      const d = document.createElement('div'); d.className = 'paper'; d.style.backgroundImage = `url("${u}")`;
      d.style.transform = `rotate(${(i - 1.5) * 4}deg) translateY(${i * -6}px)`; d.style.zIndex = String(i);
      pile.append(d);
    });
    $('go').hidden = false;
    say(files.length === 1 ? '1 photo ready. Flick your phone, or swipe it up.' : `${files.length} photos ready. Flick your phone, or swipe them up.`);
  };

  const toBase64 = (file) => new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result).split(',')[1] || ''); r.onerror = () => reject(new Error('Could not read that photo.')); r.readAsDataURL(file); });

  async function send() {
    if (sending || !files.length) return;
    sending = true; say('Flicking…');
    document.querySelectorAll('#pile .paper').forEach((p, i) => setTimeout(() => p.classList.add('gone'), i * 80));
    const batch = files; files = [];
    let ok = 0, last = '';
    for (const f of batch) {
      if (f.size > MAX_BYTES) { last = 'One photo was too big (30 MB at most).'; continue; }
      try {
        const res = await fetch('/api/send', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'x-relay-remote': '1' }, body: JSON.stringify({ data: await toBase64(f), name: f.name || '', flick: true }) });
        if (res.status === 401) { location.href = '/'; return; }
        if (res.ok) ok++; else last = (await res.json().catch(() => ({}))).error || `Error ${res.status}`;
      } catch (e) { last = e.message || 'Could not reach your Mac.'; }
    }
    sending = false;
    setTimeout(render, 600);
    setTimeout(() => say(ok ? (ok === 1 ? 'Sent to your Mac.' : `${ok} photos sent to your Mac.`) + (last ? ' ' + last : '') : (last || 'Nothing was sent.'), !ok), 650);
  }

  $('pick').addEventListener('change', () => { files = [...$('pick').files].filter((f) => /^image\//.test(f.type) || /\.(heic|heif|jpe?g|png|gif|webp)$/i.test(f.name)); $('pick').value = ''; render(); });
  $('go').addEventListener('click', send);

  // swipe the stack up
  let down = null;
  $('pile').addEventListener('pointerdown', (e) => { down = { y: e.clientY, t: performance.now() }; });
  $('pile').addEventListener('pointerup', (e) => { if (down && down.y - e.clientY > 90 && performance.now() - down.t < 700) send(); down = null; });

  // flick the phone (the motion sensor; iPhone asks once, and only after a tap)
  const detector = new FlickDetector();
  let listening = false;
  const onMotion = (e) => {
    let a = e.acceleration;
    if (!a || a.x == null) { const g = e.accelerationIncludingGravity; if (!g || g.x == null) return; const m = Math.hypot(g.x, g.y, g.z) - 9.81; a = { x: m, y: 0, z: 0 }; }
    if (detector.push(a.x, a.y, a.z, performance.now()) && files.length) send();
  };
  const listen = () => { if (listening) return; listening = true; window.addEventListener('devicemotion', onMotion); $('motion').hidden = true; };
  if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
    $('motion').hidden = false;
    $('motion').addEventListener('click', async () => { try { (await DeviceMotionEvent.requestPermission()) === 'granted' ? listen() : say('Motion is off, so use Send now or swipe up. Allow it in Settings > Safari > Motion & Orientation.', true); } catch { say('Could not turn motion on.', true); } });
  } else if (typeof DeviceMotionEvent !== 'undefined') listen();
}

if (typeof document !== 'undefined') startPage();
if (typeof module !== 'undefined') module.exports = { FlickDetector };
