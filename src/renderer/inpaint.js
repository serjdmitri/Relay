// Erase: fills the painted-over part of a picture from the pixels around it, in the order of a fast-marching ("Telea") fill: the pixels nearest the edge of the
// hole first, each one a weighted average of the nearby known pixels (closer ones and ones in line with the edge count more), so colours and soft shading carry
// inwards. No network, no model: plain arithmetic. Works well on small objects over smooth or lightly textured backgrounds (a wire, a bin, a spot, a person far
// away on grass or sky); on a large object over a detailed background it leaves a soft smear, because it cannot invent texture.
// Pure: no DOM, so the card page and the tests use the same code. Only the pixels under the mask change; everything else is returned byte for byte.
(function (root) {
  // Bounding box of the mask (1 = erase): { x, y, w, h } or null when nothing is painted.
  function maskBounds(mask, width, height) {
    let x0 = width, y0 = height, x1 = -1, y1 = -1;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (mask[y * width + x]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  }

  // Makes the painted area a little bigger so the soft edge of a brush stroke is inside it (grow: pixels).
  function grow(mask, width, height, r = 2) {
    const out = new Uint8Array(mask);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      if (!mask[y * width + x]) continue;
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < width && ny < height && dx * dx + dy * dy <= r * r) out[ny * width + nx] = 1;
      }
    }
    return out;
  }

  // data: RGBA bytes (width * height * 4), mask: 1 per pixel to erase. Returns { data, changed, box } (a new array). radius: how far each pixel looks for known pixels.
  function inpaint({ data, width, height, mask, radius = 5 }) {
    const out = new Uint8ClampedArray(data);
    const box = maskBounds(mask, width, height);
    if (!box) return { data: out, changed: 0, box: null };
    // work on the hole's box plus a margin, never the whole photo
    const m = radius * 3 + 2;
    const bx0 = Math.max(0, box.x - m), by0 = Math.max(0, box.y - m), bx1 = Math.min(width, box.x + box.w + m), by1 = Math.min(height, box.y + box.h + m);
    const w = bx1 - bx0, h = by1 - by0;
    const known = new Uint8Array(w * h); // 1: a real pixel, or one filled already
    const hole = [];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = (by0 + y) * width + bx0 + x; if (mask[i]) hole.push(y * w + x); else known[y * w + x] = 1; }
    // distance of each hole pixel from the nearest known pixel (two chamfer passes), then fill in that order
    const INF = 1e9, dist = new Float32Array(w * h).fill(INF);
    for (let i = 0; i < w * h; i++) if (known[i]) dist[i] = 0;
    const D1 = 1, D2 = Math.SQRT2;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = y * w + x; let d = dist[i]; if (x > 0) d = Math.min(d, dist[i - 1] + D1); if (y > 0) { d = Math.min(d, dist[i - w] + D1); if (x > 0) d = Math.min(d, dist[i - w - 1] + D2); if (x < w - 1) d = Math.min(d, dist[i - w + 1] + D2); } dist[i] = d; }
    for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--) { const i = y * w + x; let d = dist[i]; if (x < w - 1) d = Math.min(d, dist[i + 1] + D1); if (y < h - 1) { d = Math.min(d, dist[i + w] + D1); if (x < w - 1) d = Math.min(d, dist[i + w + 1] + D2); if (x > 0) d = Math.min(d, dist[i + w - 1] + D2); } dist[i] = d; }
    hole.sort((a, b) => dist[a] - dist[b]);
    const px = new Float32Array(w * h * 3); // the working colours
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const s = ((by0 + y) * width + bx0 + x) * 4, i = (y * w + x) * 3; px[i] = data[s]; px[i + 1] = data[s + 1]; px[i + 2] = data[s + 2]; }
    const R = Math.max(2, Math.round(radius)), R2 = R * R;
    let changed = 0;
    for (const idx of hole) {
      const x = idx % w, y = (idx / w) | 0;
      // the direction towards the known side: from the gradient of the distance field
      const gx = (dist[y * w + Math.min(w - 1, x + 1)] - dist[y * w + Math.max(0, x - 1)]) / 2, gy = (dist[Math.min(h - 1, y + 1) * w + x] - dist[Math.max(0, y - 1) * w + x]) / 2;
      let r = 0, g = 0, b = 0, wsum = 0, grow = R;
      for (let pass = 0; pass < 3 && wsum === 0; pass++, grow += R) {
        const G2 = grow * grow;
        for (let dy = -grow; dy <= grow; dy++) {
          const ny = y + dy; if (ny < 0 || ny >= h) continue;
          for (let dx = -grow; dx <= grow; dx++) {
            const d2 = dx * dx + dy * dy; if (d2 === 0 || d2 > G2) continue;
            const nx = x + dx; if (nx < 0 || nx >= w) continue;
            const j = ny * w + nx; if (!known[j]) continue;
            const d = Math.sqrt(d2);
            const dir = Math.abs((dx * -gx + dy * -gy) / (d * (Math.hypot(gx, gy) || 1))); // pixels on the line towards the known side count more
            const wt = (0.1 + dir) / d2 * (1 / (1 + Math.max(0, dist[j]) * 0)); // nearer counts more
            r += px[j * 3] * wt; g += px[j * 3 + 1] * wt; b += px[j * 3 + 2] * wt; wsum += wt;
          }
        }
      }
      if (wsum > 0) { px[idx * 3] = r / wsum; px[idx * 3 + 1] = g / wsum; px[idx * 3 + 2] = b / wsum; }
      known[idx] = 1; // later pixels may use this one
    }
    for (const idx of hole) {
      const x = idx % w, y = (idx / w) | 0, s = ((by0 + y) * width + bx0 + x) * 4;
      out[s] = px[idx * 3]; out[s + 1] = px[idx * 3 + 1]; out[s + 2] = px[idx * 3 + 2]; out[s + 3] = 255; changed++;
    }
    return { data: out, changed, box };
  }

  // Extend: a bigger canvas (pad pixels more on every side) whose new border is the picture mirrored outwards and then softened more and more the further it is from the
  // real picture. This is NOT new content: nothing is invented, so it suits skies, walls, water, grass and bokeh backgrounds, and shows a mirror on anything with detail.
  // The original pixels are copied unchanged. Returns { data, width, height }.
  function extend({ data, width, height, pad }) {
    const p = Math.max(1, Math.round(pad)), W = width + 2 * p, H = height + 2 * p;
    const refl = (v, n) => { const m = 2 * n; v = ((v % m) + m) % m; return v < n ? v : m - 1 - v; };
    const mir = new Float32Array(W * H * 3);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const s = (refl(y - p, height) * width + refl(x - p, width)) * 4, i = (y * W + x) * 3; mir[i] = data[s]; mir[i + 1] = data[s + 1]; mir[i + 2] = data[s + 2]; }
    // a box blur (running sums, horizontal then vertical) of the mirrored canvas
    const r = Math.max(2, Math.round(p / 5)), tmp = new Float32Array(W * H * 3), blur = new Float32Array(W * H * 3);
    for (let y = 0; y < H; y++) for (let c = 0; c < 3; c++) { let sum = 0; for (let x = -r; x <= r; x++) sum += mir[(y * W + Math.min(W - 1, Math.max(0, x))) * 3 + c]; for (let x = 0; x < W; x++) { tmp[(y * W + x) * 3 + c] = sum / (2 * r + 1); sum += mir[(y * W + Math.min(W - 1, x + r + 1)) * 3 + c] - mir[(y * W + Math.max(0, x - r)) * 3 + c]; } }
    for (let x = 0; x < W; x++) for (let c = 0; c < 3; c++) { let sum = 0; for (let y = -r; y <= r; y++) sum += tmp[(Math.min(H - 1, Math.max(0, y)) * W + x) * 3 + c]; for (let y = 0; y < H; y++) { blur[(y * W + x) * 3 + c] = sum / (2 * r + 1); sum += tmp[(Math.min(H - 1, y + r + 1) * W + x) * 3 + c] - tmp[(Math.max(0, y - r) * W + x) * 3 + c]; } }
    const out = new Uint8ClampedArray(W * H * 4);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 4, i = (y * W + x) * 3, inside = x >= p && x < p + width && y >= p && y < p + height;
      if (inside) { const s = ((y - p) * width + (x - p)) * 4; out[o] = data[s]; out[o + 1] = data[s + 1]; out[o + 2] = data[s + 2]; out[o + 3] = 255; continue; }
      const d = Math.max(p - x, x - (p + width - 1), p - y, y - (p + height - 1), 0), t = Math.min(1, d / (p * 0.6)), k = t * t * (3 - 2 * t); // sharp at the seam, soft further out
      out[o] = mir[i] + (blur[i] - mir[i]) * k; out[o + 1] = mir[i + 1] + (blur[i + 1] - mir[i + 1]) * k; out[o + 2] = mir[i + 2] + (blur[i + 2] - mir[i + 2]) * k; out[o + 3] = 255;
    }
    return { data: out, width: W, height: H };
  }

  const api = { inpaint, maskBounds, grow, extend };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Inpaint = api;
})(typeof window !== 'undefined' ? window : globalThis);
