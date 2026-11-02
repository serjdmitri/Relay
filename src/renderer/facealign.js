// Face alignment for the SFace model: turns the four landmarks MediaPipe's face finder reports (both eyes, nose tip, mouth centre) into the 112x112
// "straightened" crop the model expects, by finding the best rotation + scale + shift that puts them where a standard face has them. Pure maths.

// Where those four points sit in the 112x112 template used by ArcFace-style models (the mouth is the middle of the two mouth corners).
export const TEMPLATE = [[38.2946, 51.6963], [73.5318, 51.5014], [56.0252, 71.7366], [56.1396, 92.2848]];

// Least-squares similarity transform (no flip) taking `src` points to `dst` points: returns { a, b, tx, ty } so that x' = a*x - b*y + tx and y' = b*x + a*y + ty.
export function similarity(src, dst) {
  const n = src.length;
  let sx = 0, sy = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) { sx += src[i][0]; sy += src[i][1]; dx += dst[i][0]; dy += dst[i][1]; }
  sx /= n; sy /= n; dx /= n; dy /= n;
  let num1 = 0, num2 = 0, den = 0;
  for (let i = 0; i < n; i++) {
    const px = src[i][0] - sx, py = src[i][1] - sy, qx = dst[i][0] - dx, qy = dst[i][1] - dy;
    num1 += px * qx + py * qy; num2 += px * qy - py * qx; den += px * px + py * py;
  }
  if (!den) return null;
  const a = num1 / den, b = num2 / den;
  return { a, b, tx: dx - (a * sx - b * sy), ty: dy - (b * sx + a * sy) };
}

// The standard five-point ArcFace template (as Glance uses): left eye, right eye, nose tip, left mouth corner, right mouth corner, "left" and "right" as seen in the picture.
export const TEMPLATE5 = [[38.2946, 51.6963], [73.5318, 51.5014], [56.0252, 71.7366], [41.5493, 92.3655], [70.7299, 92.2041]];

// Five points from MediaPipe's 478 face landmarks (normalised 0..1): both pupils (468, 473), nose tip (1), mouth corners (61, 291). Eyes and mouth corners are put in
// picture order by x, not by their anatomical label (the same fix Glance makes for Apple's Vision labels). Returns the transform in pixels, or null.
export function alignFromLandmarks(lm, width, height) {
  if (!Array.isArray(lm) || lm.length < 478) return null;
  const p = (i) => [lm[i].x * width, lm[i].y * height];
  const eyes = [p(468), p(473)].sort((a, b) => a[0] - b[0]), mouth = [p(61), p(291)].sort((a, b) => a[0] - b[0]);
  const pts = [eyes[0], eyes[1], p(1), mouth[0], mouth[1]];
  if (pts.some((q) => !Number.isFinite(q[0]) || !Number.isFinite(q[1]))) return null;
  if (Math.hypot(eyes[1][0] - eyes[0][0], eyes[1][1] - eyes[0][1]) < 16) return null; // too small a face to tell anyone apart
  const t = similarity(pts, TEMPLATE5);
  if (!t) return null;
  const scale = Math.hypot(t.a, t.b);
  return scale > 4 || scale < 0.15 ? null : t;
}

// MediaPipe BlazeFace keypoints (normalised 0..1): [right eye, left eye, nose tip, mouth centre, right ear, left ear]. Returns the transform in pixels, or null.
export function alignFromKeypoints(keypoints, width, height) {
  if (!Array.isArray(keypoints) || keypoints.length < 4) return null;
  const pts = keypoints.slice(0, 4).map((k) => [k.x * width, k.y * height]);
  if (pts.some((p) => !Number.isFinite(p[0]) || !Number.isFinite(p[1]))) return null;
  const eyes = Math.hypot(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]);
  if (eyes < 12) return null; // too small a face to tell anyone apart
  const t = similarity(pts, TEMPLATE);
  if (!t) return null;
  const scale = Math.hypot(t.a, t.b);
  if (scale > 4 || scale < 0.2) return null;
  return t;
}

// RGBA pixels (112x112) to the planar float RGB, 0..255, that the model reads.
export function toPlanar(rgba, size = 112) {
  const out = new Float32Array(3 * size * size), plane = size * size;
  for (let i = 0; i < plane; i++) { out[i] = rgba[i * 4]; out[plane + i] = rgba[i * 4 + 1]; out[2 * plane + i] = rgba[i * 4 + 2]; }
  return out;
}

export function cosine(a, b) {
  if (!a || !b || a.length !== b.length || !a.length) return null;
  let d = 0, x = 0, y = 0;
  for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; x += a[i] * a[i]; y += b[i] * b[i]; }
  return d / (Math.sqrt(x) * Math.sqrt(y) || 1);
}
export function bestScore(embedding, templates) {
  let best = null;
  for (const t of templates || []) { const s = cosine(embedding, t); if (s !== null && (best === null || s > best)) best = s; }
  return best;
}
