// How one model joins another when you drop a hologram on a hologram (or say "add a heart to it"). The model decides, from the names
// and sizes, where the new one goes (on top, beside, inside...), how big, and which way up; this checks its answer and has a simple
// rule for when no model answers. The hologram animates the new one into place.

const ANCHORS = ['top', 'bottom', 'left', 'right', 'front', 'back', 'center', 'inside'];

const round = (x) => +Number(x).toFixed(2);

// base/item: { title, size: { w, h, d } } in stage units (about 2 for the biggest side). hint: what the user said, if anything.
function fitPrompt(base, item, hint = '') {
  const sz = (s) => `${round(s.w)} wide, ${round(s.h)} tall, ${round(s.d)} deep`;
  return [
    'Two 3D models are being combined into one hologram. Decide how the second one joins the first so it looks natural and physically sensible.',
    `First model (stays in the middle): "${base.title}", ${sz(base.size)}.`,
    `Second model (joins it): "${item.title}", ${sz(item.size)}.`,
    hint ? `The user said: "${hint}".` : '',
    'Answer with ONLY a JSON object: {"anchor": one of top|bottom|left|right|front|back|center|inside, "scale": a number from 0.2 to 2 (1 keeps its size; make it a believable size next to the first), "rotate": [x, y, z] in degrees, multiples of 90 (use [0,0,0] unless it should lie down or stand up), "note": a few words}.',
    'Examples: a head on a body: top. A wheel on a car: left or right, scaled down. A small part for a bigger machine: top or front, scaled down. Two similar things: right. Something that belongs inside the other: inside, scaled below 0.8.'
  ].filter(Boolean).join('\n');
}

// The model's answer as a safe placement, or null when it is not usable.
function parsePlacement(text) {
  const m = String(text || '').match(/\{[\s\S]*\}/);
  if (!m) return null;
  let j;
  try { j = JSON.parse(m[0]); } catch { return null; }
  const anchor = String(j.anchor || '').toLowerCase();
  if (!ANCHORS.includes(anchor)) return null;
  const rotate = Array.isArray(j.rotate) && j.rotate.length >= 3 ? j.rotate.slice(0, 3).map((x) => (Math.round((Number(x) || 0) / 90) * 90) % 360) : [0, 0, 0];
  return { anchor, scale: round(Math.min(2, Math.max(0.2, Number(j.scale) || 1))), rotate, note: String(j.note || '').slice(0, 60) };
}

// With no model to ask: a much smaller thing sits on top, something about as big sits beside, scaled so they look alike in size.
function heuristicPlacement(base, item) {
  const big = (s) => Math.max(s.w, s.h, s.d);
  const ratio = big(item.size) / Math.max(1e-6, big(base.size));
  if (ratio < 0.45) return { anchor: 'top', scale: 1, rotate: [0, 0, 0], note: 'on top' };
  return { anchor: 'right', scale: round(Math.min(1.5, Math.max(0.5, 1 / ratio))), rotate: [0, 0, 0], note: 'beside it' };
}

module.exports = { fitPrompt, parsePlacement, heuristicPlacement, ANCHORS };
