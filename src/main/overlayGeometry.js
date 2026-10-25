// Pure helpers for what Relay shows on screen (the buddy, drawings and step-by-step guides): turning what a model
// gives us (screenshot pixels, accessibility frames) into global screen points, and checking what it asks us to draw.
// Global points are the space macOS and Electron share: points, origin at the top left of the main display.

const KINDS = ['box', 'circle', 'arrow', 'text'];
const MAX_SHAPES = 12;
const MAX_LABEL = 60;
const MAX_STEPS = 8;
const MAX_STEP_TEXT = 120;

const num = (v, name) => {
  const n = Number(v);
  if (v === null || v === undefined || v === '' || !Number.isFinite(n)) throw new Error(`${name} must be a number.`);
  return n;
};
const clip = (s, max) => (s == null ? '' : String(s).slice(0, max));

// ctx.scale: screen points per screenshot pixel. ctx.origin: where the captured display starts in global points.
function toGlobal(x, y, { scale = 1, origin = { x: 0, y: 0 } } = {}) {
  return { x: origin.x + num(x, 'x') * scale, y: origin.y + num(y, 'y') * scale };
}

// Shapes arrive in screenshot pixels; they leave in global points.
function normalizeShapes(shapes, ctx = {}) {
  if (!Array.isArray(shapes) || !shapes.length) throw new Error('shapes must be a non-empty list.');
  if (shapes.length > MAX_SHAPES) throw new Error(`Draw at most ${MAX_SHAPES} shapes at a time.`);
  const k = ctx.scale ?? 1;
  return shapes.map((s, i) => {
    const type = s && s.type;
    if (!KINDS.includes(type)) throw new Error(`Shape ${i + 1}: type must be one of ${KINDS.join(', ')}.`);
    const at = (x, y) => {
      try { return toGlobal(x, y, ctx); } catch (e) { throw new Error(`Shape ${i + 1}: ${e.message}`); }
    };
    const dim = (v, name) => {
      try { return Math.abs(num(v, name)) * k; } catch (e) { throw new Error(`Shape ${i + 1}: ${e.message}`); }
    };
    const p = at(s.x, s.y);
    const label = clip(s.label, MAX_LABEL);
    if (type === 'box') return { type, x: p.x, y: p.y, w: dim(s.w, 'w'), h: dim(s.h, 'h'), label };
    if (type === 'circle') return { type, x: p.x, y: p.y, r: dim(s.r ?? 40, 'r'), label };
    if (type === 'arrow') { const q = at(s.x2, s.y2); return { type, x: p.x, y: p.y, x2: q.x, y2: q.y, label }; }
    const text = clip(s.text ?? s.label, MAX_LABEL);
    if (!text) throw new Error(`Shape ${i + 1}: a text shape needs text.`);
    return { type, x: p.x, y: p.y, text };
  });
}

// What System Events gives for an element: "x|y|w|h" in global points. The separator is a bar because in some
// locales AppleScript writes numbers with a decimal comma ("412,5"). A plain "x,y,w,h" is still accepted.
function parseFrame(out) {
  const raw = String(out || '').trim();
  const parts = (raw.includes('|') ? raw.split('|') : raw.split(',')).map((v) => Number(v.trim().replace(',', '.')));
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) throw new Error("Could not read that element's position.");
  const [x, y, w, h] = parts;
  if (w <= 0 || h <= 0) throw new Error('That element has no size on screen (it may be hidden).');
  return { x, y, w, h, cx: x + w / 2, cy: y + h / 2 };
}

// The checklist card for a guide: 1 to 8 short steps and which one the user is on (1-based in, 0-based out).
function guideCard(steps, current = 1) {
  if (!Array.isArray(steps) || !steps.length) throw new Error('steps must be a non-empty list of short strings.');
  if (steps.length > MAX_STEPS) throw new Error(`A guide has at most ${MAX_STEPS} steps.`);
  const list = steps.map((s) => clip(s, MAX_STEP_TEXT).trim()).filter(Boolean);
  if (!list.length) throw new Error('steps must contain text.');
  const n = Math.round(Number(current));
  const idx = Number.isFinite(n) ? Math.min(list.length, Math.max(1, n)) - 1 : 0;
  return { steps: list, current: idx, total: list.length };
}

// Steps for a guide: each is a string, or { text, app, name } (an element to point at, found in the accessibility tree
// when the step comes up) or { text, x, y } (a spot in a screenshot, turned into a screen point by toPt).
// A target given outside the list (app, name, x, y) belongs to the current step if that step has none.
function guideSteps(raw, current = 1, { toPt = (x, y) => ({ x, y }), fallback = {} } = {}) {
  if (!Array.isArray(raw) || !raw.length) throw new Error('steps must be a non-empty list of short strings.');
  if (raw.length > MAX_STEPS) throw new Error(`A guide has at most ${MAX_STEPS} steps.`);
  const steps = [];
  for (const r of raw) {
    const o = typeof r === 'string' ? { text: r } : r && typeof r === 'object' ? r : {};
    const text = clip(o.text, MAX_STEP_TEXT).trim();
    if (!text) continue;
    const s = { text };
    if (o.app && o.name) { s.app = String(o.app); s.name = String(o.name); }
    else if (o.x != null && o.y != null && o.x !== '' && o.y !== '') s.pt = toPt(o.x, o.y);
    steps.push(s);
  }
  if (!steps.length) throw new Error('steps must contain text.');
  const n = Math.round(Number(current));
  const index = Number.isFinite(n) ? Math.min(steps.length, Math.max(1, n)) - 1 : 0;
  const here = steps[index];
  if (!here.app && !here.pt) {
    if (fallback.app && fallback.name) { here.app = String(fallback.app); here.name = String(fallback.name); }
    else if (fallback.x != null && fallback.y != null) here.pt = toPt(fallback.x, fallback.y);
  }
  return { steps, current: index };
}

// What a spoken or typed request means while a guide is on screen: "next", "back" or "stop", else null.
// Only whole phrases count, so "next song" still reaches the music commands.
function guideCommand(text) {
  const t = String(text || '').toLowerCase().replace(/[.!?,]/g, ' ').replace(/\s+/g, ' ').trim();
  if (/^(ok(ay)? |alright |and )?(next( step| one)?|done|i'?m done|i did (it|that)|did it|finished|continue|go on|go ahead|keep going|got it)$/.test(t)) return 'next';
  if (/^(go )?(back|previous( step)?|last step|one back)$/.test(t)) return 'back';
  if (/^(stop|exit|end|close|cancel|dismiss)( the)?( guide| steps)?$/.test(t)) return 'stop';
  return null;
}

// Is a point inside a rectangle grown by a margin?
function inRect(p, r, margin = 0) {
  return p.x >= r.x - margin && p.x <= r.x + r.w + margin && p.y >= r.y - margin && p.y <= r.y + r.h + margin;
}

// What the user drew with the mark key: strokes of [x, y] points. Anything else is dropped, and the size is capped.
const MAX_STROKES = 40;
const MAX_POINTS = 600;
function normalizeStrokes(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const s of raw.slice(0, MAX_STROKES)) {
    if (!Array.isArray(s)) continue;
    const pts = [];
    for (const p of s.slice(0, MAX_POINTS)) {
      if (Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1])) pts.push([p[0], p[1]]);
    }
    if (pts.length >= 2) out.push(pts);
  }
  return out;
}

// The rectangle all strokes fit in, or null.
function strokesBox(strokes) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const s of strokes) for (const [x, y] of s) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  return x1 < x0 ? null : { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

// What to look at for a marked box: grown by a margin, at least a minimum size (a tiny circle needs its surroundings),
// and kept inside the display.
function markRegion(box, bounds, { pad = 28, minW = 260, minH = 200 } = {}) {
  let w = Math.max(box.w + pad * 2, minW);
  let h = Math.max(box.h + pad * 2, minH);
  w = Math.min(w, bounds.width);
  h = Math.min(h, bounds.height);
  let x = box.x + box.w / 2 - w / 2;
  let y = box.y + box.h / 2 - h / 2;
  x = Math.max(bounds.x, Math.min(bounds.x + bounds.width - w, x));
  y = Math.max(bounds.y, Math.min(bounds.y + bounds.height - h, y));
  return { x, y, w, h };
}

// Which display holds a point; the nearest one when it is outside all of them (an off-screen element).
function displayAt(displays, p) {
  const inside = displays.find((d) => p.x >= d.bounds.x && p.x < d.bounds.x + d.bounds.width && p.y >= d.bounds.y && p.y < d.bounds.y + d.bounds.height);
  if (inside) return inside;
  const dist = (d) => {
    const dx = Math.max(d.bounds.x - p.x, 0, p.x - (d.bounds.x + d.bounds.width));
    const dy = Math.max(d.bounds.y - p.y, 0, p.y - (d.bounds.y + d.bounds.height));
    return dx * dx + dy * dy;
  };
  return displays.reduce((best, d) => (dist(d) < dist(best) ? d : best), displays[0]);
}

module.exports = { toGlobal, normalizeShapes, parseFrame, guideCard, guideSteps, guideCommand, inRect, normalizeStrokes, strokesBox, markRegion, displayAt, KINDS, MAX_SHAPES, MAX_STEPS };
