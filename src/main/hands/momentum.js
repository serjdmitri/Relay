// Velocity is measured in screen points per millisecond over recent tracked frames.
function velocity(trail, now) {
  const recent = (trail || []).filter(p => Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.t) && now - p.t <= 200 && now >= p.t);
  if (recent.length < 2) return null;
  const a = recent[0], b = recent.at(-1), dt = b.t - a.t;
  if (dt < 30 || now - b.t > 100) return null;
  const vx = (b.x - a.x) / dt, vy = (b.y - a.y) / dt;
  if (Math.hypot(vx, vy) < 0.55) return null;
  return { vx: Math.max(-3, Math.min(3, vx)), vy: Math.max(-3, Math.min(3, vy)) };
}
// The projected cursor is constrained to the current display. A rightward glide that reaches its edge dismisses the held item.
function step(p, v, bounds, dt = 16) {
  const x = p.x + v.vx * dt, y = p.y + v.vy * dt;
  const close = v.vx > 0 && x >= bounds.x + bounds.width - 1;
  return { point: { x: Math.max(bounds.x, Math.min(bounds.x + bounds.width - 1, x)), y: Math.max(bounds.y, Math.min(bounds.y + bounds.height - 1, y)) }, velocity: { vx: v.vx * 0.88, vy: v.vy * 0.88 }, close };
}
module.exports = { velocity, step };
