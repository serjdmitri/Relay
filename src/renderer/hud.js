// The Jarvis reactor: a big, animated arc reactor in the middle of the screen while Relay listens, which moves to the top
// left while it works, and shows what it hears and answers beside it. It follows the design of the reference HUD:
// a halo, pulse rings, three spinning arc rings, two scanners, tick marks, a crosshair and a core with the name in it.
// Drawn on a canvas, only while it is on screen. All text from the model goes in with textContent.
(function () {
  const hud = document.getElementById('hud');
  const canvas = document.getElementById('hudc');
  const wave = document.getElementById('hudwave');
  const statusEl = document.getElementById('hudstatus');
  const lineEl = document.getElementById('hudline');
  const subEl = document.getElementById('hudsub');
  const tasksEl = document.getElementById('hudtasks');
  const inEl = document.getElementById('hudin');
  const btns = document.getElementById('hudbtns');
  const sendBtn = document.getElementById('hudyes');
  const noBtn = document.getElementById('hudno');
  const ctx = canvas.getContext('2d');
  const wctx = wave.getContext('2d');

  const SIZE = 540; // the reactor's own size in points; the canvas is 1.5 times that so the pulse rings have room
  const CANVAS = SIZE * 1.5;
  const PRI = '0,212,255';
  const ACC = '255,107,0';
  const COLORS = { 'TYPE A REQUEST': '#00d4ff', CONFIRM: '#ffcc00', LISTENING: '#00ff88', PROCESSING: '#ffcc00', THINKING: '#ffcc00', SPEAKING: '#ff6b00', COMPLETE: '#00d4ff', ATTENTION: '#ff3355', DICTATING: '#00ff88' };

  let dpr = Math.max(1, window.devicePixelRatio || 1);
  canvas.width = CANVAS * dpr;
  canvas.height = CANVAS * dpr;
  wave.width = 288 * dpr;
  wave.height = 30 * dpr;

  let on = false;
  let raf = 0;
  let name = 'J.A.R.V.I.S';
  let status = 'LISTENING';
  let base = 'LISTENING'; // the status without the speaking overlay
  let speaking = false;
  let level = 0; // 0..1 microphone level
  let amp = 0; // smoothed
  let scale = 1;
  let halo = 165;
  let tick = 0;
  let rings = [0, 120, 240];
  let scan = 0;
  let scan2 = 180;
  let pulses = [0, 50, 100];
  let particles = [];
  let started = 0;
  let last = 0;
  let mode = 'center';
  let cursorPos = null;
  let busySince = 0;
  let shownState = '';

  const rad = (d) => (d * Math.PI) / 180;

  function arc(cx, cy, r, from, len, color, width) {
    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.arc(cx, cy, r, -rad(from), -rad(from + len), true);
    ctx.stroke();
  }

  function draw(now) {
    const cx = CANVAS / 2;
    const cy = CANVAS / 2;
    const fw = SIZE;
    const small = mode === 'corner';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, CANVAS, CANVAS);
    ctx.lineCap = 'butt';

    // the reactor reacts to loudness: the mic while listening, a gentle made-up swell while it speaks
    const target = speaking ? 0.4 + 0.35 * Math.abs(Math.sin(tick * 0.11)) + 0.2 * Math.random() * Math.abs(Math.sin(tick * 0.31)) : level;
    amp += (target - amp) * 0.3;
    const baseHalo = 165; // brighter than the reference at rest, so it reads on a busy screen
    const tgtScale = 1 + amp * (speaking ? 0.13 : 0.06);
    const tgtHalo = baseHalo + amp * (speaking ? 95 : 75);
    scale += (tgtScale - scale) * (speaking ? 0.38 : 0.2);
    halo += (tgtHalo - halo) * (speaking ? 0.38 : 0.2);

    const busy = status === 'PROCESSING' || status === 'THINKING';
    const boost = 1 + amp * 1.6 + (busy ? 0.6 : 0);
    const speeds = speaking ? [1.3, -0.9, 2.0] : [0.55, -0.35, 0.9];
    for (let i = 0; i < 3; i++) rings[i] = (rings[i] + speeds[i] * boost) % 360;
    scan = (scan + (speaking ? 3 : 1.3) * boost) % 360;
    scan2 = (scan2 + (speaking ? -2 : -0.75) * boost) % 360;

    const lim = fw * 0.74;
    const spd = speaking ? 4.2 : 2;
    pulses = pulses.map((r) => r + spd).filter((r) => r < lim);
    if (pulses.length < 3 && Math.random() < (speaking ? 0.07 : 0.025)) pulses.push(0);

    if (speaking && Math.random() < 0.28) {
      const ang = Math.random() * Math.PI * 2;
      const rs = fw * 0.28;
      particles.push([cx + Math.cos(ang) * rs, cy + Math.sin(ang) * rs, Math.cos(ang) * (0.9 + Math.random() * 1.5), Math.sin(ang) * (0.9 + Math.random() * 1.5) - 0.4, 1]);
    }
    particles = particles.map((p) => [p[0] + p[2], p[1] + p[3], p[2] * 0.97, p[3] * 0.97, p[4] - 0.028]).filter((p) => p[4] > 0);

    const rFace = fw * 0.31;

    // halo glow
    for (let i = 0; i < 10; i++) {
      const r = rFace * (1.8 - i * 0.08);
      const a = Math.max(0, Math.min(1, (halo * 0.085 * (1 - i / 10)) / 255));
      ctx.beginPath();
      ctx.strokeStyle = `rgba(${PRI},${Math.min(1, a * 1.5)})`;
      ctx.lineWidth = 1.8;
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
    }

    // pulse rings
    for (const pr of pulses) {
      const a = Math.max(0, 0.9 * (1 - pr / lim));
      ctx.beginPath();
      ctx.strokeStyle = `rgba(${PRI},${a})`;
      ctx.lineWidth = 1.5;
      ctx.arc(cx, cy, pr, 0, Math.PI * 2);
      ctx.stroke();
    }

    // three spinning rings of dashes
    [[0.48, 3, 115, 78], [0.40, 2, 78, 55], [0.32, 1, 56, 40]].forEach(([rf, w, len, gap], idx) => {
      const r = fw * rf;
      const a = Math.max(0, Math.min(1, (halo * (1 - idx * 0.12)) / 255 * 1.25));
      for (let ang = rings[idx]; ang < rings[idx] + 360; ang += len + gap) arc(cx, cy, r, ang, len, `rgba(${PRI},${a})`, w + 0.8);
    });

    // two scanners
    const sa = Math.min(1, (halo * 1.5) / 255);
    const ex = speaking ? 75 : 44;
    arc(cx, cy, fw * 0.5, scan, ex, `rgba(${PRI},${sa})`, 3.2);
    arc(cx, cy, fw * 0.5, scan2, ex, `rgba(${ACC},${Math.min(1, sa * 0.75)})`, 2);

    // tick marks and crosshair
    const tOut = fw * 0.497;
    const tIn = fw * 0.474;
    ctx.strokeStyle = `rgba(${PRI},0.85)`;
    ctx.lineWidth = 1.4;
    for (let deg = 0; deg < 360; deg += 10) {
      const inn = deg % 30 === 0 ? tIn : tIn + 6;
      const r = rad(deg);
      ctx.beginPath();
      ctx.moveTo(cx + tOut * Math.cos(r), cy - tOut * Math.sin(r));
      ctx.lineTo(cx + inn * Math.cos(r), cy - inn * Math.sin(r));
      ctx.stroke();
    }
    const chR = fw * 0.51;
    const gap = fw * 0.16;
    ctx.strokeStyle = `rgba(${PRI},${Math.min(1, (halo * 0.8) / 255)})`;
    ctx.beginPath();
    ctx.moveTo(cx - chR, cy); ctx.lineTo(cx - gap, cy);
    ctx.moveTo(cx + gap, cy); ctx.lineTo(cx + chR, cy);
    ctx.moveTo(cx, cy - chR); ctx.lineTo(cx, cy - gap);
    ctx.moveTo(cx, cy + gap); ctx.lineTo(cx, cy + chR);
    ctx.stroke();

    // the core: a dark blue orb with the name in it
    const orb = fw * 0.27 * scale;
    for (let i = 8; i > 0; i--) {
      const r2 = (orb * i) / 8;
      const f = i / 8;
      const a = Math.max(0, Math.min(1, (halo * 1.1 * f) / 255));
      ctx.beginPath();
      ctx.fillStyle = `rgba(${Math.round(0 * f)},${Math.round(60 * f)},${Math.round(110 * f)},${a})`;
      ctx.arc(cx, cy, r2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.beginPath();
    ctx.strokeStyle = `rgba(${PRI},1)`;
    ctx.lineWidth = 2;
    ctx.arc(cx, cy, orb, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = `rgba(200,248,255,1)`;
    ctx.font = `700 ${Math.round(fw * 0.03)}px ui-monospace, SFMono-Regular, Menlo, monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(name, cx, cy);

    // particles while it speaks
    for (const p of particles) {
      ctx.beginPath();
      ctx.fillStyle = `rgba(${PRI},${Math.max(0, p[4])})`;
      ctx.arc(p[0], p[1], 2.5, 0, Math.PI * 2);
      ctx.fill();
    }

    drawWave(now);
  }

  // 36 bars under the reactor that follow the level
  function drawWave() {
    const W = 288;
    wctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    wctx.clearRect(0, 0, W, 30);
    const N = 36;
    const bw = 8;
    const mid = (N - 1) / 2;
    for (let i = 0; i < N; i++) {
      const env = Math.pow(1 - Math.abs(i - mid) / mid, 0.7);
      const shimmer = 0.55 + 0.45 * Math.sin(tick * 0.18 + i * 0.7);
      const idle = 3 + 2 * Math.sin(tick * 0.09 + i * 0.6);
      const h = Math.round(Math.max(2, Math.min(24, idle + amp * 22 * env * shimmer)));
      wctx.fillStyle = amp > 0.05 ? (h > 12 ? '#00d4ff' : '#007a99') : '#1a5c7a';
      wctx.fillRect(i * bw, 27 - h, bw - 1, h);
    }
  }

  function frame(now) {
    raf = 0;
    if (!on) return;
    const every = mode === 'corner' ? 33 : 16; // half the frames when it is small and off to the side
    if (now - last >= every - 1) {
      last = now;
      tick++;
      draw(now);
      if (busySince && (status === 'PROCESSING' || status === 'THINKING')) {
        const s = Math.floor((Date.now() - busySince) / 1000);
        statusEl.textContent = `${status}${s >= 2 ? `  ${s}s` : ''}`;
      }
    }
    raf = requestAnimationFrame(frame);
  }

  // Kept by id and only changed where it differs: a list rebuilt on every update (the level and the words arrive many times a second) made
  // every finished task pop in again each time, which looked like flickering.
  function renderTasks(tasks) {
    const have = new Map([...tasksEl.children].map((li) => [li.dataset.id, li]));
    const keep = new Set();
    tasks.forEach((t, i) => {
      const key = String(t.id ?? `${i}:${t.text}`);
      keep.add(key);
      let li = have.get(key);
      if (!li) { li = document.createElement('li'); li.dataset.id = key; }
      if (li.className !== t.status) li.className = t.status;
      if (li.textContent !== t.text) li.textContent = t.text;
      if (tasksEl.children[i] !== li) tasksEl.insertBefore(li, tasksEl.children[i] || null);
    });
    for (const [key, li] of have) if (!keep.has(key)) li.remove();
  }

  function setMode(m) {
    mode = m;
    hud.classList.toggle('center', m === 'center');
    hud.classList.toggle('corner', m === 'corner');
  }

  // msg: the pill's fields ({ state, mode, partial, level, label, text, reply, status, askLabel, dictateLabel, preparing })
  function apply(msg) {
    if (!msg || msg.hide) {
      on = false;
      hud.classList.remove('on');
      tasksEl.replaceChildren();
      busySince = 0;
      speaking = false;
      level = 0;
      return;
    }
    if (typeof msg.name === 'string' && msg.name) name = msg.name;
    if (!on) hud.classList.add('snap'); // appearing from nothing: take its place at once, with no sliding
    const s = msg.state;
    let label = '';
    let line = '';
    let sub = '';
    let lineClass = '';
    if (s === 'listening') {
      const dictating = msg.mode === 'dictate';
      status = dictating ? 'DICTATING' : 'LISTENING';
      level = Math.min(1, (msg.level || 0) * 9);
      if (msg.preparing !== undefined && !msg.partial) { line = `Getting speech ready ${Math.round(msg.preparing * 100)}%`; lineClass = 'dim'; }
      else if (msg.partial) line = msg.partial;
      else { line = dictating ? 'Say what to type…' : 'Say what you want…'; lineClass = 'dim'; }
      sub = `${dictating ? msg.dictateLabel : msg.askLabel} to ${dictating ? 'finish' : 'send'}`;
      setMode('center');
      busySince = 0;
    } else if (s === 'finishing') {
      status = 'PROCESSING';
      level = 0;
      line = 'Finishing…';
      lineClass = 'dim';
      setMode('center');
      if (!busySince) busySince = Date.now();
    } else if (s === 'working') {
      status = 'PROCESSING';
      level = 0;
      line = msg.stream ? (msg.stream.length > 230 ? `…${msg.stream.slice(-228)}` : msg.stream) : `${msg.label || 'Working'}…`; // the answer as it is written, when it comes in pieces
      sub = msg.text || '';
      setMode('center'); // it stays big in the middle while it works, and goes when it is done
      if (!busySince) busySince = Date.now();
    } else if (s === 'done') {
      status = msg.status && msg.status !== 'done' ? 'ATTENTION' : 'COMPLETE';
      level = 0;
      line = msg.reply || '';
      sub = msg.usage || ''; // small and dim, never spoken
      setMode('center');
      busySince = 0;
    } else if (s === 'input') {
      status = 'TYPE A REQUEST';
      level = 0;
      line = msg.notice || msg.hint || '';
      lineClass = msg.notice ? 'warn' : line ? 'dim' : '';
      sub = 'Return to send · Esc to close';
      setMode('center');
      busySince = 0;
    } else if (s === 'confirm') {
      status = 'CONFIRM';
      level = 0;
      line = msg.question || '';
      setMode('center');
      busySince = 0;
    } else {
      on = false;
      hud.classList.remove('on');
      return;
    }
    wave.style.display = s === 'listening' ? 'block' : 'none';
    hud.classList.toggle('usage', s === 'done');
    // The list of what was asked, in bullets at the middle left: the running one bright, the waiting ones dim, the finished ones ticked.
    if (Array.isArray(msg.tasks)) renderTasks(msg.tasks);
    const typing = s === 'input';
    const asking = s === 'confirm';
    inEl.style.display = typing ? 'block' : 'none';
    btns.style.display = asking ? 'flex' : 'none';
    if (typing && (msg.reset || shownState !== 'input')) { inEl.value = ''; setTimeout(() => inEl.focus(), 90); }
    if (typing && msg.requestSubmit) window.relay.ask.submit(inEl.value);
    shownState = s;
    base = status;
    if (speaking) status = 'SPEAKING';
    if (!(busySince && status === 'PROCESSING')) statusEl.textContent = status;
    statusEl.style.color = COLORS[status] || '#00d4ff';
    lineEl.textContent = line;
    lineEl.className = lineClass;
    subEl.textContent = sub;
    subEl.style.display = sub ? 'block' : 'none';
    void hud.offsetWidth; // the new place is applied now, before sliding is allowed again
    hud.classList.remove('snap');
    if (!on) {
      on = true;
      started = performance.now();
      amp = 0;
      pulses = [0, 50, 100];
      hud.classList.add('on');
    }
    if (!raf) raf = requestAnimationFrame(frame);
  }

  function setSpeaking(v) {
    speaking = !!v;
    if (!on) return;
    status = speaking ? 'SPEAKING' : base;
    statusEl.textContent = status;
    statusEl.style.color = COLORS[status] || '#00d4ff';
  }

  inEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); window.relay.ask.submit(inEl.value); }
    else if (e.key === 'Escape') { e.preventDefault(); window.relay.ask.cancel(); }
  });
  sendBtn.addEventListener('click', () => window.relay.ask.confirm(true));
  noBtn.addEventListener('click', () => window.relay.ask.confirm(false));
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && shownState === 'confirm') window.relay.ask.confirm(false); });
  function focusInput() { if (shownState === 'input') inEl.focus(); }

  window.Hud = { apply, focusInput, setSpeaking, get on() { return on; } };
})();
