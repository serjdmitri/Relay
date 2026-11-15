// Flick photos from your phone to your Mac: choose photos, then flick the phone (or swipe the stack) and they land on your Mac on the side you flicked towards.
// FlickDetector and the two direction helpers are plain and testable (flick.test.js loads this file in Node); the page part only runs in a browser.

// Which way a push went, as the side of the Mac screen it should land on. x is towards the phone's right edge, y towards its top edge, z out of its screen.
// A push mostly at the Mac or away from it (z) has no side: the photo lands in the middle.
function directionOf(x, y, z = 0) {
  const ax = Math.abs(Number(x) || 0), ay = Math.abs(Number(y) || 0), az = Math.abs(Number(z) || 0);
  if (Math.max(ax, ay, az) < 1) return 'center';
  if (az > ax && az > ay) return 'center';
  if (ax >= ay) return x > 0 ? 'right' : 'left';
  return y > 0 ? 'up' : 'down';
}

// Which way a finger swipe on the photos went (screen coordinates: y grows downwards).
function swipeDirection(dx, dy) {
  if (Math.hypot(dx, dy) < 1) return 'center';
  if (Math.abs(dx) >= Math.abs(dy)) return dx > 0 ? 'right' : 'left';
  return dy < 0 ? 'up' : 'down';
}

// Reads the phone's acceleration (gravity taken out, in m/s2) and says when a quick flick happened: a strong push that is over again within a moment. Walking about or a jostle is gentler than that.
// After a flick, .direction says which way it went.
class FlickDetector {
  constructor({ threshold = 14, calm = 6, maxMs = 400, gapMs = 1500 } = {}) {
    Object.assign(this, { threshold, calm, maxMs, gapMs });
    this.spikeAt = null; this.firedAt = -Infinity; this.first = null; this.sum = null; this.direction = 'center';
  }

  // ax, ay, az: the acceleration; t: time in ms. True once per flick.
  push(ax, ay, az, t) {
    const x = Number(ax) || 0, y = Number(ay) || 0, z = Number(az) || 0;
    const m = Math.hypot(x, y, z);
    if (t - this.firedAt < this.gapMs) return false;
    if (this.spikeAt === null) { if (m >= this.threshold) { this.spikeAt = t; this.first = { x, y, z }; this.sum = { x, y, z }; } return false; }
    if (t - this.spikeAt > this.maxMs) { this.spikeAt = null; return false; } // a long push or a shake that goes on is not a flick
    if (m <= this.calm) { this.spikeAt = null; this.firedAt = t; this.direction = directionOf(this.sum.x, this.sum.y, this.sum.z); return true; }
    // still in the push: only what keeps going the same way counts for the direction (the stop after a push goes the other way)
    if (x * this.first.x + y * this.first.y + z * this.first.z > 0) { this.sum.x += x; this.sum.y += y; this.sum.z += z; }
    return false;
  }
}

function startPage() {
  const $ = (id) => document.getElementById(id);
  const token = localStorage.getItem('relay-remote-token') || '';
  if (!token) { location.href = '/'; return; }
  $('page').hidden = false;
  const MAX_BYTES = 30 * 1024 * 1024, MOTION_KEY = 'relay-flick-motion';
  let files = [], sending = false, urls = [];
  const say = (text, bad = false) => { $('msg').textContent = text; $('msg').className = bad ? 'err' : ''; };
  const remember = () => { try { localStorage.setItem(MOTION_KEY, '1'); } catch { /* it just asks again next time */ } };

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
    say(files.length === 1 ? '1 photo ready. Flick your phone, or swipe it.' : `${files.length} photos ready. Flick your phone, or swipe them.`);
  };

  const toBase64 = (file) => new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result).split(',')[1] || ''); r.onerror = () => reject(new Error('Could not read that photo.')); r.readAsDataURL(file); });

  // dir: the side of the Mac screen the photo lands on (left, right, up, down; anything else is the middle)
  async function send(dir = 'center') {
    if (sending || !files.length) return;
    sending = true; say('Flicking…');
    const away = { left: 'translateX(-120vw) scale(.7) rotate(-8deg)', right: 'translateX(120vw) scale(.7) rotate(8deg)', down: 'translateY(120vh) scale(.7)', up: 'translateY(-120vh) scale(.7) rotate(-6deg)', center: 'translateY(-120vh) scale(.7) rotate(-6deg)' }[dir] || '';
    document.querySelectorAll('#pile .paper').forEach((p, i) => setTimeout(() => { p.style.transform = away; p.classList.add('gone'); }, i * 80));
    const batch = files; files = [];
    let ok = 0, last = '';
    for (const f of batch) {
      if (f.size > MAX_BYTES) { last = 'One photo was too big (30 MB at most).'; continue; }
      try {
        const res = await fetch('/api/send', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'x-relay-remote': '1' }, body: JSON.stringify({ data: await toBase64(f), name: f.name || '', flick: true, dir }) });
        if (res.status === 401) { location.href = '/'; return; }
        if (res.ok) ok++; else last = (await res.json().catch(() => ({}))).error || `Error ${res.status}`;
      } catch (e) { last = e.message || 'Could not reach your Mac.'; }
    }
    sending = false;
    setTimeout(render, 600);
    setTimeout(() => say(ok ? (ok === 1 ? 'Sent to your Mac.' : `${ok} photos sent to your Mac.`) + (last ? ' ' + last : '') : (last || 'Nothing was sent.'), !ok), 650);
  }

  $('pick').addEventListener('change', () => { files = [...$('pick').files].filter((f) => /^image\//.test(f.type) || /\.(heic|heif|jpe?g|png|gif|webp)$/i.test(f.name)); $('pick').value = ''; render(); });
  $('go').addEventListener('click', () => send('center'));

  // swipe the stack any way: it lands on that side of the Mac
  let down = null;
  $('pile').addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; });
  $('pile').addEventListener('pointerup', (e) => {
    if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 90 && performance.now() - down.t < 700) send(swipeDirection(e.clientX - down.x, e.clientY - down.y));
    down = null;
  });

  // flick the phone (the motion sensor; iPhone asks once, and only after a tap)
  const detector = new FlickDetector();
  let listening = false, motionSeen = false;
  const onMotion = (e) => {
    motionSeen = true;
    let a = e.acceleration;
    if (!a || a.x == null) { const g = e.accelerationIncludingGravity; if (!g || g.x == null) return; const m = Math.hypot(g.x, g.y, g.z) - 9.81; a = { x: 0, y: 0, z: m }; } // only the strength is known: it lands in the middle
    if (detector.push(a.x, a.y, a.z, performance.now()) && files.length) send(detector.direction);
  };
  const listen = () => { if (listening) return; listening = true; window.addEventListener('devicemotion', onMotion); $('motion').hidden = true; };
  const stopListening = () => { listening = false; window.removeEventListener('devicemotion', onMotion); };
  const askButton = () => { $('motion').hidden = false; };
  if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
    $('motion').addEventListener('click', async () => { try { if ((await DeviceMotionEvent.requestPermission()) === 'granted') { listen(); remember(); } else say('Motion is off, so use Send now or swipe. Allow it in Settings > Safari > Motion & Orientation.', true); } catch { say('Could not turn motion on.', true); } });
    let before = false; try { before = localStorage.getItem(MOTION_KEY) === '1'; } catch { /* asks again */ }
    if (before) { // turned on before: try without asking again, and ask only if the phone sends nothing
      listen();
      setTimeout(() => { if (!motionSeen) { stopListening(); askButton(); } }, 1500);
    } else askButton();
  } else if (typeof DeviceMotionEvent !== 'undefined') { listen(); remember(); }

  // photos picked on the home page's Flick button are waiting
  if (typeof FlickStore !== 'undefined') FlickStore.take().then((list) => { if (list.length) { files = list; render(); } }).catch(() => {});
}

if (typeof document !== 'undefined') startPage();
if (typeof module !== 'undefined') module.exports = { FlickDetector, directionOf, swipeDirection };
