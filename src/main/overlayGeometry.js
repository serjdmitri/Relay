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

module.exports = { toGlobal, normalizeShapes, parseFrame, guideCard, displayAt, KINDS, MAX_SHAPES, MAX_STEPS };
