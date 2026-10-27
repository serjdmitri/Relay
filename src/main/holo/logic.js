// The pure parts of the holograms: when one is dropped on another, how a combined hologram is laid out, and what is kept when one is
// pinned. No Electron in here, so it can be tested.

const area = (r) => Math.max(0, r.width) * Math.max(0, r.height);

// How much of the smaller rectangle is covered by the other (0 to 1).
function overlapRatio(a, b) {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  if (w <= 0 || h <= 0) return 0;
  return (w * h) / Math.max(1, Math.min(area(a), area(b)));
}

// The hologram a dragged one is held over (more than a third of the smaller one covered), the most covered if several. others: [{ id, bounds }].
function mergeTarget(dragged, others, threshold = 0.35) {
  let best = null;
  for (const o of others) {
    const r = overlapRatio(dragged, o.bounds);
    if (r >= threshold && (!best || r > best.r)) best = { id: o.id, r };
  }
  return best ? best.id : null;
}

// Where each model of a combined hologram sits along the x axis, centred on zero. widths: the width of each model once fitted.
function layoutX(widths, gap = 0.25) {
  const total = widths.reduce((s, w) => s + w, 0) + gap * Math.max(0, widths.length - 1);
  let x = -total / 2;
  return widths.map((w) => { const c = x + w / 2; x += w + gap; return +c.toFixed(4); });
}

const cycle = (i, n, dir) => (n <= 0 ? 0 : (i + dir + n) % n);

// What is kept for a pinned hologram: where its middle is, how big, and how to make it again (a link, not the model's bytes).
function toSaved(h) {
  return {
    id: h.id, title: h.title, pinned: true, center: true, x: Math.round(h.x), y: Math.round(h.y), scale: +(h.scale || 1).toFixed(3), solid: !!h.solid,
    items: h.items.map((i) => ({ ...(i.kind === 'stl' ? { kind: 'stl', title: i.title, url: i.url, credit: i.credit } : i.kind === 'glb' ? { kind: 'glb', title: i.title, file: i.file, credit: i.credit } : i.kind === 'cad' ? { kind: 'cad', title: i.title, cad: i.cad, credit: i.credit } : { kind: 'shapes', title: i.title, parts: i.parts, credit: i.credit }), ...(i.placement ? { placement: i.placement } : {}) }))
  };
}

// The saved list, cleaned: only pinned entries with something to show, at most 8.
function cleanSaved(list) {
  return (Array.isArray(list) ? list : []).filter((h) => h && h.pinned && Array.isArray(h.items) && h.items.length && h.items.every((i) => (i.kind === 'stl' && /^https:\/\/upload\.wikimedia\.org\//.test(i.url || '')) || (i.kind === 'glb' && typeof i.file === 'string' && i.file.endsWith('.glb')) || (i.kind === 'shapes' && Array.isArray(i.parts)) || (i.kind === 'cad' && Array.isArray(i.cad?.shapes) && i.cad.shapes.length))).slice(0, 8);
}

// A file name made from a hologram's title: letters, numbers, spaces and dashes only.
function safeName(name, fallback = 'hologram') {
  const t = String(name || '').normalize('NFKD').replace(/[^\p{L}\p{N} _-]+/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
  return t || fallback;
}

// A path in dir that does not exist yet ("Cube.stl", "Cube (2).stl", ...): saving never replaces a file.
function uniquePath(exists, dir, name, ext) {
  const base = safeName(name);
  for (let i = 1; i < 1000; i++) {
    const p = `${dir}/${base}${i === 1 ? '' : ` (${i})`}.${ext}`;
    if (!exists(p)) return p;
  }
  return `${dir}/${base} ${Date.now()}.${ext}`;
}

module.exports = { safeName, uniquePath, overlapRatio, mergeTarget, layoutX, cycle, toSaved, cleanSaved };
