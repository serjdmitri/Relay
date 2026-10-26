/* global relay */
// The overlay page: the buddy that follows the pointer, the halo, drawings and the guide card.
// Commands arrive from the main process (src/main/overlay.js) in this display's own coordinates.
// Text from a model only ever goes in with textContent.
const $ = (id) => document.getElementById(id);
const pen = $('pen');
const cur = $('cur'), lab = $('lab'), buddy = $('buddy'), svg = $('draw'), labels = $('labels'), card = $('card');
const NS = 'http://www.w3.org/2000/svg';

let cursor = null; // where the real pointer is
let pos = null; // where the buddy is drawn
let flyTo = null; // { x, y, until }: the buddy is pointing at something
let state = null;
let jarvis = false;
let raf = 0;
const note = $('note');
let noteTimer = 0;

function frame(now) {
  // when pointing, the buddy waits to the lower left of the target so it never covers the label on the right
  const goal = flyTo && flyTo.until > now ? (jarvis ? { x: flyTo.x + 2, y: flyTo.y + 2 } : { x: flyTo.x - 30, y: flyTo.y + 30 }) : cursor && (jarvis ? { x: cursor.x + 24, y: cursor.y + 26 } : { x: cursor.x + 15, y: cursor.y + 17 });
  if (goal) {
    if (!pos) pos = { ...goal };
    pos.x += (goal.x - pos.x) * 0.35; // a soft lag, so it trails the pointer instead of sticking to it
    pos.y += (goal.y - pos.y) * 0.35;
    buddy.style.transform = `translate(${pos.x.toFixed(1)}px, ${pos.y.toFixed(1)}px)`;
  }
  // Once the buddy has caught up with the pointer there is nothing to animate, so the loop rests until the pointer moves.
  const expired = flyTo && flyTo.until <= now;
  if (expired) flyTo = null;
  const still = !expired && !flyTo && goal && pos && Math.abs(goal.x - pos.x) < 0.4 && Math.abs(goal.y - pos.y) < 0.4;
  raf = state && !still ? requestAnimationFrame(frame) : 0;
}

function setState(s) {
  state = s;
  buddy.classList.remove('idle', 'listening', 'thinking', 'done', 'speaking');
  if (!s) {
    buddy.classList.remove('on');
    cancelAnimationFrame(raf);
    raf = 0;
    return;
  }
  buddy.classList.add(s);
  if (cursor) buddy.classList.add('on');
  if (!raf) raf = requestAnimationFrame(frame);
}

function point({ x, y, label }) {
  cur.style.transform = `translate(${x}px, ${y}px)`;
  cur.classList.add('on');
  lab.style.display = label ? 'block' : 'none';
  lab.textContent = label || '';
  flyTo = { x, y, until: performance.now() + 3200 };
  card.classList.toggle('left', x > innerWidth / 2); // keep the guide card on the side away from what it points at
  if (state && !raf) raf = requestAnimationFrame(frame);
}

const el = (name, attrs) => {
  const e = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
};

// Every stroke is drawn twice, a white one under a coloured one, so it reads on any background.
function stroke(make, t) {
  const g = el('g', {});
  for (const cls of ['under', 'over']) {
    const e = make();
    e.setAttribute('class', `shape ${cls}`);
    e.setAttribute('pathLength', '1');
    if (t) { e.style.animationDuration = t.dur + 's'; e.style.animationDelay = t.delay + 's'; }
    g.append(e);
  }
  return g;
}

function tag(text, x, y, big, delay = 0) {
  const t = document.createElement('div');
  if (delay) t.style.animationDelay = delay + 's';
  t.className = 'tag' + (big ? ' big' : '');
  t.textContent = text;
  labels.append(t);
  const w = t.offsetWidth, h = t.offsetHeight;
  t.style.left = Math.max(8, Math.min(innerWidth - w - 8, x)) + 'px';
  t.style.top = Math.max(8, Math.min(innerHeight - h - 8, y)) + 'px';
}

// The points a stroke passes through, so the pen can follow it as it is drawn.
function pathOf(s) {
  if (s.type === 'box') return [[s.x, s.y], [s.x + s.w, s.y], [s.x + s.w, s.y + s.h], [s.x, s.y + s.h], [s.x, s.y]];
  if (s.type === 'circle') return Array.from({ length: 41 }, (_, i) => [s.x + s.r * Math.cos((i / 40) * 2 * Math.PI), s.y + s.r * Math.sin((i / 40) * 2 * Math.PI)]);
  if (s.type === 'arrow') return [[s.x, s.y], [s.x2, s.y2]];
  return null;
}
const lengthOf = (pts) => pts.reduce((n, p, i) => (i ? n + Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) : 0), 0);
const at = (pts, f) => {
  const total = lengthOf(pts);
  let want = f * total;
  for (let i = 1; i < pts.length; i++) {
    const seg = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    if (want <= seg || i === pts.length - 1) {
      const k = seg ? Math.min(1, want / seg) : 1;
      return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * k, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * k];
    }
    want -= seg;
  }
  return pts[pts.length - 1];
};

let tracing = null;
function trace(plan) {
  cancelAnimationFrame(tracing && tracing.raf);
  if (!jarvis || !plan.length) { pen.classList.remove('on'); tracing = null; return; }
  const t0 = performance.now();
  const end = Math.max(...plan.map((p) => p.delay + p.dur)) * 1000;
  tracing = { raf: 0 };
  const step = (now) => {
    const ms = now - t0;
    const cur = plan.find((p) => ms >= p.delay * 1000 && ms <= (p.delay + p.dur) * 1000) || null;
    if (cur) {
      const f = (ms - cur.delay * 1000) / (cur.dur * 1000);
      const e = 1 - (1 - f) * (1 - f); // the stroke eases out like its animation does
      const [x, y] = at(cur.pts, e);
      pen.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
      pen.classList.add('on');
    }
    if (ms < end + 400) tracing.raf = requestAnimationFrame(step);
    else pen.classList.remove('on');
  };
  tracing.raf = requestAnimationFrame(step);
}

function draw(shapes, add) {
  if (!add) {
    svg.replaceChildren();
    labels.replaceChildren();
  }
  let clock = 0; // each stroke starts when the one before it ends
  const plan = [];
  for (const s of shapes) {
    const pts = pathOf(s);
    const len = pts ? lengthOf(pts) : 0;
    const t = pts ? { delay: clock, dur: Math.max(0.35, Math.min(1.1, len / 900)) } : null;
    if (t) { plan.push({ ...t, pts }); clock += t.dur + 0.08; }
    const after = t ? t.delay + t.dur : clock;
    if (s.type === 'box') {
      const fill = el('rect', { x: s.x, y: s.y, width: s.w, height: s.h, rx: 10 });
      fill.setAttribute('class', 'shape fill');
      fill.style.animationDelay = after + 's';
      svg.append(fill, stroke(() => el('rect', { x: s.x, y: s.y, width: s.w, height: s.h, rx: 10 }), t));
      if (s.label) tag(s.label, s.x, s.y - 40, false, after);
    } else if (s.type === 'circle') {
      const fill = el('circle', { cx: s.x, cy: s.y, r: s.r });
      fill.setAttribute('class', 'shape fill');
      fill.style.animationDelay = after + 's';
      svg.append(fill, stroke(() => el('circle', { cx: s.x, cy: s.y, r: s.r }), t));
      if (s.label) tag(s.label, s.x + s.r + 10, s.y - 16, false, after);
    } else if (s.type === 'arrow') {
      const a = Math.atan2(s.y2 - s.y, s.x2 - s.x), L = 22;
      const head = (d) => `M${s.x2} ${s.y2} L${s.x2 - L * Math.cos(a + d)} ${s.y2 - L * Math.sin(a + d)}`;
      svg.append(stroke(() => el('path', { d: `M${s.x} ${s.y} L${s.x2} ${s.y2} ${head(0.45)} ${head(-0.45)}` }), t));
      if (s.label) tag(s.label, s.x2 + 12, s.y2 + 8, false, after);
    } else if (s.type === 'text') {
      tag(s.text, s.x, s.y, true, clock);
    }
  }
  trace(plan);
}

function showCard(c) {
  card.replaceChildren();
  card.classList.toggle('on', !!c);
  if (!c) return;
  const head = document.createElement('div');
  head.className = 'head';
  const a = document.createElement('span');
  a.textContent = `Step ${c.current + 1} of ${c.total}`;
  const b = document.createElement('span');
  b.textContent = 'Relay';
  head.append(a, b);
  card.append(head);
  const prog = document.createElement('div');
  prog.className = 'prog';
  for (let i = 0; i < c.total; i++) {
    const seg = document.createElement('i');
    if (i < c.current) seg.className = 'on';
    else if (i === c.current) seg.className = 'now';
    prog.append(seg);
  }
  card.append(prog);
  c.steps.forEach((text, i) => {
    const row = document.createElement('div');
    row.className = 'step' + (i === c.current ? ' now' : i < c.current ? ' done' : '');
    const n = document.createElement('span');
    n.className = 'n';
    n.textContent = i < c.current ? '✓' : String(i + 1);
    const t = document.createElement('span');
    t.textContent = text;
    row.append(n, t);
    card.append(row);
  });
  const foot = document.createElement('div');
  foot.className = 'foot';
  foot.textContent = c.current + 1 < c.total ? 'Say “next” when you are done. Esc closes this.' : 'That is the last step. Esc closes this.';
  card.append(foot);
}

// ----- the mark key: a trail that follows the pointer while the key is held, and fades -----
const markLayer = $('markLayer');
const TRAIL_MS = 280; // how long a stroke lives: it is drawn at the pointer and fades away behind it
const TRAIL_PARTS = 9;
let trail = []; // { x, y, t }
let marking = false;
let trailRaf = 0;

// A comet: the newest part of the stroke is solid and thick, and the tail thins and fades until it is gone.
function drawTrail(now) {
  trail = trail.filter((q) => now - q.t < TRAIL_MS);
  markLayer.replaceChildren();
  if (trail.length > 1) {
    const n = trail.length;
    for (let i = 0; i < TRAIL_PARTS; i++) {
      const from = Math.floor((i * (n - 1)) / TRAIL_PARTS);
      const to = Math.min(n, Math.floor(((i + 1) * (n - 1)) / TRAIL_PARTS) + 2);
      if (to - from < 2) continue;
      const k = (i + 1) / TRAIL_PARTS; // 0 at the tail, 1 at the pointer
      const pts = trail.slice(from, to).map((q) => `${q.x.toFixed(1)},${q.y.toFixed(1)}`).join(' ');
      const under = el('polyline', { class: 'u', points: pts });
      const over = el('polyline', { class: 'o', points: pts });
      under.style.opacity = String(0.8 * k * k);
      under.style.strokeWidth = String(2 + 6 * k);
      over.style.opacity = String(Math.min(1, 0.15 + k * 1.1));
      over.style.strokeWidth = String(1 + 3.2 * k);
      markLayer.append(under, over);
    }
  }
  if (marking || trail.length) trailRaf = requestAnimationFrame(() => drawTrail(performance.now()));
  else trailRaf = 0;
}

function markStart() {
  marking = true;
  trail = [];
  markLayer.replaceChildren();
  if (!trailRaf) trailRaf = requestAnimationFrame(() => drawTrail(performance.now()));
}

function markPoint(x, y) {
  trail.push({ x, y, t: performance.now() });
  if (jarvis) { // the pen triangle rides at the head of the trail
    pen.style.transform = `translate(${x}px, ${y}px)`;
    pen.classList.add('on');
  }
}

function markEnd(cancel) {
  marking = false;
  pen.classList.remove('on');
  if (cancel) trail = [];
}

function clearAll() {
  pen.classList.remove('on');
  svg.replaceChildren();
  labels.replaceChildren();
  showCard(null);
  cur.classList.remove('on');
  flyTo = null;
}

// Where the reactor sits: the middle of the screen, or small in the top left corner while Relay works.
function layoutHud() {
  const k = Math.max(0.45, Math.min(1, (innerHeight - 340) / 540, innerWidth / 760));
  const root = document.documentElement.style;
  root.setProperty('--k', String(k));
  const cornerK = 0.27;
  const cx = 28 + (540 * cornerK) / 2 + 8;
  const cy = 64 + (540 * cornerK) / 2;
  root.setProperty('--tx', `${cx - innerWidth / 2}px`);
  root.setProperty('--ty', `${cy - (innerHeight / 2 - 40)}px`);
  root.setProperty('--ck', String(cornerK));
}
addEventListener('resize', layoutHud);

window.relay.onOverlay((m) => {
  switch (m.type) {
    case 'cursor':
      cursor = { x: m.x, y: m.y };
      if (state) buddy.classList.add('on');
      if (state && !raf) raf = requestAnimationFrame(frame);
      break;
    case 'buddy-state':
      setState(m.state);
      break;
    case 'buddy-away': // the pointer moved to another display
      buddy.classList.remove('on');
      cursor = null;
      pos = null;
      break;
    case 'point':
      point(m);
      break;
    case 'buddy-note':
      note.textContent = m.text;
      note.classList.add('on');
      clearTimeout(noteTimer);
      noteTimer = setTimeout(() => note.classList.remove('on'), m.ms || 1700);
      break;
    case 'click': {
      const r = document.createElement('div');
      r.className = 'ripple';
      r.style.left = `${m.x}px`;
      r.style.top = `${m.y}px`;
      document.body.append(r);
      setTimeout(() => r.remove(), 800);
      break;
    }
    case 'halo-off':
      cur.classList.remove('on');
      break;
    case 'draw':
      draw(m.shapes, m.add);
      break;
    case 'guide':
      showCard(m.card);
      break;
    case 'clear':
      clearAll();
      break;
    case 'armed':
      buddy.classList.toggle('armed', !!m.on);
      break;
    case 'hud':
      layoutHud();
      window.Hud.apply(m.hide ? { hide: true } : m.state);
      break;
    case 'hud-focus':
      window.Hud.focusInput();
      break;
    case 'hud-speaking':
      window.Hud.setSpeaking(m.on);
      break;
    case 'mark-start':
      markStart();
      break;
    case 'mark-point':
      markPoint(m.x, m.y);
      break;
    case 'mark-end':
      markEnd(m.cancel);
      break;
    case 'mark-clear':
      trail = [];
      markLayer.replaceChildren();
      break;
    case 'look':
      jarvis = m.look === 'jarvis';
      document.body.classList.toggle('jarvis', jarvis);
      break;
  }
});
