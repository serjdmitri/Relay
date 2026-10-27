// Which photo makes the best 3D model? One clear, whole object on a plain background, seen from the side or a corner, big enough to show
// detail. A busy scene, an object cut off by the edge, a close-up of a part or a diagram all come out badly, whatever the generator. This
// scores a photo from a few measurements of a small copy of it (and its title), so the best of several can be sent first. No Electron in
// here: the small copy is decoded by the caller, so it is tested on made-up pixels.

const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const median = (xs) => { const s = xs.slice().sort((p, q) => p - q); return s[s.length >> 1] ?? 0; };

// pixels: { data (4 bytes per pixel, any channel order), w, h }; size: [width, height] of the original photo.
function measurePixels({ data, w, h }, size = [w, h]) {
  const px = (x, y) => { const i = (y * w + x) * 4; return [data[i], data[i + 1], data[i + 2]]; };
  const ring = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (x < 2 || y < 2 || x >= w - 2 || y >= h - 2) ring.push([x, y, px(x, y)]);
  const bg = [0, 1, 2].map((c) => median(ring.map((r) => r[2][c])));
  const uniform = ring.filter((r) => dist(r[2], bg) < 40).length / ring.length;
  let fg = 0, minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (dist(px(x, y), bg) > 55) { fg++; if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
  }
  const fraction = fg / (w * h);
  const touch = ring.filter((r) => dist(r[2], bg) > 55).length / ring.length;
  const cx = maxX >= 0 ? (minX + maxX) / 2 / w : 0.5, cy = maxY >= 0 ? (minY + maxY) / 2 / h : 0.5;
  return { uniform, fraction, touch, offCenter: Math.hypot(cx - 0.5, cy - 0.5), minSide: Math.min(size[0], size[1]), aspect: size[0] / Math.max(1, size[1]) };
}

// 0..1 from the measurements.
function scoreMeasures(m) {
  const plain = clamp((m.uniform - 0.35) / 0.55);
  const size = 1 - clamp(Math.abs(m.fraction - 0.4) / 0.4);
  const whole = 1 - clamp(m.touch / 0.22);
  const centred = 1 - clamp(m.offCenter / 0.35);
  const res = clamp((m.minSide - 400) / 800);
  const shape = m.aspect >= 0.5 && m.aspect <= 2.2 ? 1 : 0.5;
  const fill = 0.4 + 0.6 * clamp(m.fraction / 0.12); // a speck in a big picture has too little detail to build from
  return (0.38 * plain + 0.14 * size + 0.24 * whole + 0.09 * centred + 0.1 * res + 0.05 * shape) * fill;
}

const BAD = /interior|dashboard|gauge|cockpit|engine|detail|close.?up|crop|logo|icon|badge|emblem|diagram|drawing|sketch|schematic|blueprint|\bmap\b|collage|comparison|cutaway|inside|steering|keyboard|screen|panel|seat|wheel only|\bkey\b|poster|painting|screenshot/i;
const CROWD = /crowd|people|visitors|audience|students|team photo|group/i;
const GOOD = /front|side view|side|three.?quarter|3\/4|full|whole|studio|isolated|profile/i;

// 0..1 from the title of a photo.
function titleScore(title) {
  const t = String(title || '');
  return clamp(0.5 + (GOOD.test(t) ? 0.15 : 0) - (BAD.test(t) ? 0.35 : 0) - (CROWD.test(t) ? 0.12 : 0));
}

// A title that says it is a part, an interior or a diagram is nearly always right: it counts against the photo hard, not just a little.
const veto = (title) => (BAD.test(String(title || '')) ? 0.5 : 1);

function scorePhoto(pixels, size, title) {
  const t = titleScore(title);
  if (!pixels) return { score: (0.7 * 0.5 + 0.3 * t) * veto(title), image: null, title: t };
  const m = measurePixels(pixels, size);
  const image = scoreMeasures(m);
  return { score: (0.7 * image + 0.3 * t) * veto(title), image, title: t, m };
}

// candidates: [{ url, title, ... }]. decode(candidate) -> { pixels, size } | null. Returns them best first, each with its score. The order they came in breaks ties.
async function rankPhotos(candidates, decode) {
  const scored = await Promise.all(candidates.map(async (c, i) => {
    let d = null;
    try { d = await decode(c); } catch { d = null; }
    const s = scorePhoto(d?.pixels || null, d?.size, c.title);
    return { ...c, score: +s.score.toFixed(3), i, parts: { image: s.image === null ? null : +s.image.toFixed(2), title: +s.title.toFixed(2) } };
  }));
  return scored.sort((a, b) => b.score - a.score || a.i - b.i);
}

// The small copy of a photo (64 wide) and its real size, from Electron's nativeImage; null when it cannot be read.
function decodeWith(nativeImage, bytes) {
  const img = nativeImage.createFromBuffer(Buffer.from(bytes));
  if (img.isEmpty()) return null;
  const size = img.getSize();
  const small = img.resize({ width: 64, quality: 'good' });
  const s = small.getSize();
  return { pixels: { data: small.toBitmap(), w: s.width, h: s.height }, size: [size.width, size.height] };
}

module.exports = { decodeWith, measurePixels, scoreMeasures, titleScore, scorePhoto, rankPhotos };
