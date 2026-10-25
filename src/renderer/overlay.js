/* global relay */
// The overlay page: the buddy that follows the pointer, the halo, drawings and the guide card.
// Commands arrive from the main process (src/main/overlay.js) in this display's own coordinates.
// Text from a model only ever goes in with textContent.
const $ = (id) => document.getElementById(id);
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
  const goal = flyTo && flyTo.until > now ? { x: flyTo.x - (jarvis ? 38 : 30), y: flyTo.y + (jarvis ? 38 : 30) } : cursor && (jarvis ? { x: cursor.x + 24, y: cursor.y + 26 } : { x: cursor.x + 15, y: cursor.y + 17 });
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
function stroke(make) {
  const g = el('g', {});
  for (const cls of ['under', 'over']) {
    const e = make();
    e.setAttribute('class', `shape ${cls}`);
    e.setAttribute('pathLength', '1');
    g.append(e);
  }
  return g;
}

function tag(text, x, y, big) {
  const t = document.createElement('div');
  t.className = 'tag' + (big ? ' big' : '');
  t.textContent = text;
  labels.append(t);
  const w = t.offsetWidth, h = t.offsetHeight;
  t.style.left = Math.max(8, Math.min(innerWidth - w - 8, x)) + 'px';
  t.style.top = Math.max(8, Math.min(innerHeight - h - 8, y)) + 'px';
}

function draw(shapes, add) {
  if (!add) {
    svg.replaceChildren();
    labels.replaceChildren();
  }
  for (const s of shapes) {
    if (s.type === 'box') {
      const fill = el('rect', { x: s.x, y: s.y, width: s.w, height: s.h, rx: 10 });
      fill.setAttribute('class', 'shape fill');
      svg.append(fill, stroke(() => el('rect', { x: s.x, y: s.y, width: s.w, height: s.h, rx: 10 })));
      if (s.label) tag(s.label, s.x, s.y - 40);
    } else if (s.type === 'circle') {
      const fill = el('circle', { cx: s.x, cy: s.y, r: s.r });
      fill.setAttribute('class', 'shape fill');
      svg.append(fill, stroke(() => el('circle', { cx: s.x, cy: s.y, r: s.r })));
      if (s.label) tag(s.label, s.x + s.r + 10, s.y - 16);
    } else if (s.type === 'arrow') {
      const a = Math.atan2(s.y2 - s.y, s.x2 - s.x), L = 22;
      const head = (d) => `M${s.x2} ${s.y2} L${s.x2 - L * Math.cos(a + d)} ${s.y2 - L * Math.sin(a + d)}`;
      svg.append(stroke(() => el('path', { d: `M${s.x} ${s.y} L${s.x2} ${s.y2} ${head(0.45)} ${head(-0.45)}` })));
      if (s.label) tag(s.label, s.x2 + 12, s.y2 + 8);
    } else if (s.type === 'text') {
      tag(s.text, s.x, s.y, true);
    }
  }
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

function clearAll() {
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
    case 'look':
      jarvis = m.look === 'jarvis';
      document.body.classList.toggle('jarvis', jarvis);
      break;
  }
});
