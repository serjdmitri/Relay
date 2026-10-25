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

function frame(now) {
  // when pointing, the buddy waits to the lower left of the target so it never covers the label on the right
  const goal = flyTo && flyTo.until > now ? { x: flyTo.x - (jarvis ? 40 : 30), y: flyTo.y + (jarvis ? 40 : 30) } : cursor && (jarvis ? { x: cursor.x + 30, y: cursor.y + 33 } : { x: cursor.x + 15, y: cursor.y + 17 });
  if (goal) {
    if (!pos) pos = { ...goal };
    pos.x += (goal.x - pos.x) * 0.35; // a soft lag, so it trails the pointer instead of sticking to it
    pos.y += (goal.y - pos.y) * 0.35;
    buddy.style.transform = `translate(${pos.x.toFixed(1)}px, ${pos.y.toFixed(1)}px)`;
  }
  raf = state ? requestAnimationFrame(frame) : 0;
}

function setState(s) {
  state = s;
  buddy.classList.remove('listening', 'thinking', 'done');
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
const TRAIL_MS = 1600;
let trail = []; // { x, y, t }
let marking = false;
let trailRaf = 0;

function drawTrail(now) {
  // While the key is held the trail only ages as the pointer moves, so a circle stays up if the pointer then rests.
  const ref = marking && trail.length ? trail[trail.length - 1].t : now;
  const alive = trail.filter((q) => ref - q.t < TRAIL_MS);
  trail = alive;
  markLayer.replaceChildren();
  if (alive.length > 1) {
    const pts = alive.map((q) => `${q.x},${q.y}`).join(' ');
    const under = el('polyline', { class: 'u', points: pts });
    const over = el('polyline', { class: 'o', points: pts });
    markLayer.append(under, over);
  }
  if (marking || alive.length) trailRaf = requestAnimationFrame((t) => drawTrail(performance.now()));
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

window.relay.onOverlay((m) => {
  switch (m.type) {
    case 'cursor':
      cursor = { x: m.x, y: m.y };
      if (state) buddy.classList.add('on');
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
