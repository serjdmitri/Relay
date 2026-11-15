// Flick photos from your phone to your Mac: choose photos, then flick the phone left or right (or swipe the photos) and they land on that side of your Mac screen.
// FlickDetector and FlickAimer are plain and testable (flick.test.js loads this file in Node); the page part only runs in a browser.

// Reads the phone's acceleration (gravity taken out, in m/s2) and says when a quick flick happened: a strong push that is over again within a moment. Walking about or a jostle is gentler than that.
// After a flick, .window says when it happened (from just before the push until it was over again), so the way the phone moved in that time can be looked at.
class FlickDetector {
  constructor({ threshold = 14, calm = 6, maxMs = 400, gapMs = 1500 } = {}) {
    Object.assign(this, { threshold, calm, maxMs, gapMs });
    this.spikeAt = null; this.firedAt = -Infinity; this.window = null;
  }

  // ax, ay, az: the acceleration; t: time in ms. True once per flick.
  push(ax, ay, az, t) {
    const m = Math.hypot(Number(ax) || 0, Number(ay) || 0, Number(az) || 0);
    if (t - this.firedAt < this.gapMs) return false;
    if (this.spikeAt === null) { if (m >= this.threshold) this.spikeAt = t; return false; }
    if (t - this.spikeAt > this.maxMs) { this.spikeAt = null; return false; } // a long push or a shake that goes on is not a flick
    if (m <= this.calm) { this.window = { from: this.spikeAt - 120, to: t }; this.spikeAt = null; this.firedAt = t; return true; }
    return false;
  }
}

// Tells a flick to the left from a flick to the right, learned from your own flicks. Phones, grips and wrists differ (and iPhones report motion with the opposite signs to Android),
// so nothing is assumed: the flick is boiled down to six numbers (how much the phone sped up along each axis and how far it turned about each axis while it was flicked),
// and three flicks each way teach which numbers separate left from right for this phone and this hand.
class FlickAimer {
  constructor(samples = []) {
    this.buf = []; // the last moments of motion: { t, v: [ax, ay, az, rotAlpha, rotBeta, rotGamma] }
    this.samples = Array.isArray(samples) ? samples.filter((s) => s && (s.dir === 'left' || s.dir === 'right') && Array.isArray(s.f) && s.f.length === 6 && s.f.every(Number.isFinite)) : [];
  }

  // t in ms; acc in m/s2; rot in degrees per second
  add(t, acc, rot) {
    this.buf.push({ t, v: [...acc, ...rot].map((x) => Number(x) || 0) });
    while (this.buf.length && t - this.buf[0].t > 1200) this.buf.shift();
  }

  // The six numbers for the time between from and to: each value added up over time.
  features(from, to) {
    const f = [0, 0, 0, 0, 0, 0]; let prev = null;
    for (const s of this.buf) {
      if (prev && s.t >= from && s.t <= to) { const dt = Math.min(0.1, (s.t - prev.t) / 1000); for (let i = 0; i < 6; i++) f[i] += s.v[i] * dt; }
      prev = s;
    }
    return f;
  }

  reset() { this.samples = []; }
  learn(dir, f) { if ((dir === 'left' || dir === 'right') && f.length === 6 && f.every(Number.isFinite)) this.samples.push({ dir, f: f.slice() }); }

  // A separating line learned from the flicks so far (each number weighted by how well it tells left from right and how steady it is), or null with fewer than two of each.
  model() {
    const L = this.samples.filter((s) => s.dir === 'left'), R = this.samples.filter((s) => s.dir === 'right');
    if (L.length < 2 || R.length < 2) return null;
    const mean = (list, i) => list.reduce((a, s) => a + s.f[i], 0) / list.length;
    const w = [], mid = []; let denom = 0;
    for (let i = 0; i < 6; i++) {
      const mL = mean(L, i), mR = mean(R, i);
      const within = ([...L.map((s) => (s.f[i] - mL) ** 2), ...R.map((s) => (s.f[i] - mR) ** 2)].reduce((a, b) => a + b, 0)) / (L.length + R.length);
      const all = [...L, ...R], overall = all.reduce((a, s) => a + s.f[i] ** 2, 0) / all.length;
      const variance = within + 0.1 * overall + 1e-9; // a little extra so a number that happened to be steady in a few flicks does not rule
      w.push((mR - mL) / variance); mid.push((mR + mL) / 2); denom += w[i] * (mR - mL);
    }
    return denom > 1e-12 ? { w, mid, denom } : null;
  }

  ready() { return !!this.model(); }

  // left or right, or center when it could be either (about halfway between the two). score: -0.5 is a typical left, +0.5 a typical right.
  classify(f) {
    const m = this.model();
    if (!m) return { side: 'center', score: 0 };
    let t = 0; for (let i = 0; i < 6; i++) t += m.w[i] * (f[i] - m.mid[i]);
    t /= m.denom;
    return { side: t > 0.15 ? 'right' : t < -0.15 ? 'left' : 'center', score: t };
  }
}

// Which way a finger swipe on the photos went. Only left and right aim; up or down is just "send" (the middle). (Screen coordinates: y grows downwards.)
function swipeDirection(dx, dy) {
  if (Math.abs(dx) < Math.abs(dy) || Math.abs(dx) < 1) return 'center';
  return dx > 0 ? 'right' : 'left';
}

function startPage() {
  const $ = (id) => document.getElementById(id);
  const token = localStorage.getItem('relay-remote-token') || '';
  if (!token) { location.href = '/'; return; }
  $('page').hidden = false;
  const MAX_BYTES = 30 * 1024 * 1024, MOTION_KEY = 'relay-flick-motion', AIM_KEY = 'relay-flick-aim';
  const TEACH = ['left', 'right', 'left', 'right', 'left', 'right'];
  let files = [], sending = false, urls = [], teach = null;
  let saved = []; try { saved = JSON.parse(localStorage.getItem(AIM_KEY) || '[]'); } catch { /* not taught yet */ }
  const aimer = new FlickAimer(saved);
  const say = (text, bad = false) => { $('msg').textContent = text; $('msg').className = bad ? 'err' : ''; };
  const remember = () => { try { localStorage.setItem(MOTION_KEY, '1'); } catch { /* it just asks again next time */ } };
  const teachLabel = () => { $('teach').textContent = teach ? 'Stop teaching' : aimer.ready() ? 'Teach left and right again' : 'Teach left and right (one time)'; };

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
    const n = files.length === 1 ? '1 photo ready.' : `${files.length} photos ready.`;
    say(aimer.ready() ? `${n} Flick your phone left or right, or swipe the photos.` : `${n} Teach left and right once (the button below) so a flick can aim. Or swipe the photos left or right.`);
  };

  const toBase64 = (file) => new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result).split(',')[1] || ''); r.onerror = () => reject(new Error('Could not read that photo.')); r.readAsDataURL(file); });

  // dir: the side of the Mac screen the photo lands on (left or right; anything else is the middle). how: flick, swipe or button (so a wrong side can be traced).
  async function send(dir = 'center', how = 'button') {
    if (sending || !files.length) return;
    sending = true; say('Flicking…');
    const away = { left: 'translateX(-120vw) scale(.7) rotate(-8deg)', right: 'translateX(120vw) scale(.7) rotate(8deg)' }[dir] || 'translateY(-120vh) scale(.7) rotate(-6deg)';
    document.querySelectorAll('#pile .paper').forEach((p, i) => setTimeout(() => { p.style.transform = away; p.classList.add('gone'); }, i * 80));
    const batch = files; files = [];
    let ok = 0, last = '';
    for (const f of batch) {
      if (f.size > MAX_BYTES) { last = 'One photo was too big (30 MB at most).'; continue; }
      try {
        const res = await fetch('/api/send', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'x-relay-remote': '1' }, body: JSON.stringify({ data: await toBase64(f), name: f.name || '', flick: true, dir, how }) });
        if (res.status === 401) { location.href = '/'; return; }
        if (res.ok) ok++; else last = (await res.json().catch(() => ({}))).error || `Error ${res.status}`;
      } catch (e) { last = e.message || 'Could not reach your Mac.'; }
    }
    sending = false;
    setTimeout(render, 600);
    const side = { left: 'the left', right: 'the right' }[dir];
    const where = side ? ` It lands on ${side} of your Mac screen.` : '';
    setTimeout(() => say(ok ? (ok === 1 ? 'Sent to your Mac.' : `${ok} photos sent to your Mac.`) + where + (last ? ' ' + last : '') : (last || 'Nothing was sent.'), !ok), 650);
  }

  $('pick').addEventListener('change', () => { files = [...$('pick').files].filter((f) => /^image\//.test(f.type) || /\.(heic|heif|jpe?g|png|gif|webp)$/i.test(f.name)); $('pick').value = ''; render(); });
  $('go').addEventListener('click', () => send('center', 'button'));

  // swipe the photos left or right: they land on that side of the Mac
  let down = null;
  $('pile').addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; });
  $('pile').addEventListener('pointerup', (e) => {
    if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 90 && performance.now() - down.t < 700) send(swipeDirection(e.clientX - down.x, e.clientY - down.y), 'swipe');
    down = null;
  });

  // flick the phone (the motion sensors; iPhone asks once, and only after a tap)
  const detector = new FlickDetector();
  let listening = false, motionSeen = false;

  // one flick of the teaching: left, right, left, right, left, right
  const teachPrompt = () => say(`Hold your phone the way you do, then flick it ${TEACH[teach.i].toUpperCase()} (${teach.i + 1} of ${TEACH.length}).`);
  const learnFlick = (f) => {
    aimer.learn(TEACH[teach.i], f); teach.i++;
    if (teach.i < TEACH.length) { teachPrompt(); return; }
    teach = null;
    if (aimer.ready()) { try { localStorage.setItem(AIM_KEY, JSON.stringify(aimer.samples)); } catch { /* it is learned for this visit */ } say('Learned. Now flick left or right when photos are ready.'); }
    else { aimer.reset(); say('Those flicks looked too alike. Try again with a clear left and a clear right.', true); }
    teachLabel();
  };

  const onMotion = (e) => {
    motionSeen = true;
    const now = performance.now(), a = e.acceleration, r = e.rotationRate;
    let ax = 0, ay = 0, az = 0;
    if (a && a.x != null) { ax = a.x; ay = a.y; az = a.z; }
    else { const g = e.accelerationIncludingGravity; if (!g || g.x == null) return; az = Math.hypot(g.x, g.y, g.z) - 9.81; } // only the strength is known
    aimer.add(now, [ax, ay, az], [r && r.alpha, r && r.beta, r && r.gamma]);
    if (!detector.push(ax, ay, az, now)) return;
    const f = aimer.features(detector.window.from, detector.window.to);
    if (teach) { learnFlick(f); return; }
    if (files.length) send(aimer.ready() ? aimer.classify(f).side : 'center', 'flick');
  };
  const listen = () => { if (listening) return; listening = true; window.addEventListener('devicemotion', onMotion); $('motion').hidden = true; };
  const stopListening = () => { listening = false; window.removeEventListener('devicemotion', onMotion); };
  const askButton = () => { $('motion').hidden = false; };
  const needsPermission = typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function';
  // turns the motion sensors on (on an iPhone this must come from a tap); true when they are on
  async function motionOn() {
    if (listening) return true;
    if (!needsPermission) { if (typeof DeviceMotionEvent === 'undefined') return false; listen(); remember(); return true; }
    try { if ((await DeviceMotionEvent.requestPermission()) === 'granted') { listen(); remember(); return true; } } catch { /* below */ }
    say('Motion is off, so use Send now or swipe. Allow it in Settings > Safari > Motion & Orientation.', true);
    return false;
  }
  if (needsPermission) {
    $('motion').addEventListener('click', () => { motionOn(); });
    let before = false; try { before = localStorage.getItem(MOTION_KEY) === '1'; } catch { /* asks again */ }
    if (before) { // turned on before: try without asking again, and ask only if the phone sends nothing
      listen();
      setTimeout(() => { if (!motionSeen) { stopListening(); askButton(); } }, 1500);
    } else askButton();
  } else if (typeof DeviceMotionEvent !== 'undefined') { listen(); remember(); }

  $('teach').addEventListener('click', async () => {
    if (teach) { teach = null; say('Stopped.'); teachLabel(); return; }
    if (!(await motionOn())) return;
    aimer.reset(); teach = { i: 0 }; teachLabel(); teachPrompt();
  });
  teachLabel();

  // photos picked on the home page's Flick button are waiting
  if (typeof FlickStore !== 'undefined') FlickStore.take().then((list) => { if (list.length) { files = list; render(); } }).catch(() => {});
}

if (typeof document !== 'undefined') startPage();
if (typeof module !== 'undefined') module.exports = { FlickDetector, FlickAimer, swipeDirection };
