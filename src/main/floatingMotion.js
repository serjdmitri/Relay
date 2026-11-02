const momentum = require('./hands/momentum');

function trashGeometry(point, bounds) {
  const distance = Math.hypot(bounds.x + bounds.width - point.x, bounds.y + bounds.height - point.y);
  const max = Math.min(210, bounds.width / 3, bounds.height / 3);
  const radius = 76 + (max - 76) * Math.max(0, Math.min(1, (350 - distance) / (350 - max)));
  return { bounds, radius, inside: distance <= radius };
}

// Shared by native mouse drags, hologram drags and hand grabs. Only registered Relay UI can be dismissed.
class FloatingMotion {
  constructor({ area, cursor, onZone = () => {}, onThrow = () => {}, now = Date.now, setTimer = setInterval, clearTimer = clearInterval }) {
    Object.assign(this, { area, cursor, onZone, onThrow, now, setTimer, clearTimer });
    this.drags = new Map(); this.glides = new Map(); this.mouseDown = false;
  }
  publish() {
    const states = new Map();
    for (const d of [...this.glides.values(), ...this.drags.values()]) {
      const state = trashGeometry(d.point, d.bounds);
      states.set(`${d.bounds.x},${d.bounds.y}`, state);
    }
    this.onZone([...states.values()]);
  }
  begin(target, point, source = 'hand') {
    this.cancel(target.key);
    const origin = target.position();
    this.drags.set(target.key, { target, point, bounds: this.area(point), source, ax: point.x - origin.x, ay: point.y - origin.y, trail: [{ ...point, t: this.now() }] });
    this.publish();
  }
  update(key, point) {
    const d = this.drags.get(key); if (!d) return;
    d.point = point; d.bounds = this.area(point);
    d.trail.push({ ...point, t: this.now() }); d.trail = d.trail.filter(p => this.now() - p.t <= 200);
    this.publish();
  }
  inTrash(key) { const d=this.drags.get(key); return !!d && trashGeometry(d.point,d.bounds).inside; }
  dismiss(target) {
    if (target.undo) this.onThrow(target.undo);
    target.close();
  }
  release(key, cancelled = false) {
    const d = this.drags.get(key); if (!d) return;
    this.drags.delete(key);
    if (cancelled) { d.target.finish?.(); this.publish(); return; }
    if (trashGeometry(d.point, d.bounds).inside) { this.dismiss(d.target); this.publish(); return; }
    const v = momentum.velocity(d.trail, this.now());
    if (!v) { d.target.finish?.(); this.publish(); return; }
    const g = { ...d, v, frames: 0 };
    g.timer = this.setTimer(() => {
      if (g.target.alive?.() === false || ++g.frames > 140) return this.cancel(key);
      const next = momentum.step(g.point, g.v, g.bounds);
      g.point = next.point; g.v = next.velocity;
      try {
        g.target.move(g.point.x - g.ax, g.point.y - g.ay);
        if (next.close || trashGeometry(g.point, g.bounds).inside) {
          this.clearTimer(g.timer); this.glides.delete(key); this.dismiss(g.target); this.publish(); return;
        }
        if (Math.hypot(g.v.vx, g.v.vy) < .04) return this.cancel(key);
        this.publish();
      } catch { this.cancel(key); }
    }, 16);
    g.timer?.unref?.(); this.glides.set(key, g); this.publish();
  }
  cancel(key) {
    const g = this.glides.get(key); if (g) { this.clearTimer(g.timer); this.glides.delete(key); g.target.finish?.(); }
    this.drags.delete(key); this.publish();
  }
  watchWindow(win, target) {
    const t = { ...target, alive: () => !win.isDestroyed(), position: () => win.getBounds(), move: (x,y) => { if (!win.isDestroyed()) win.setPosition(Math.round(x), Math.round(y)); } };
    win.on('will-move', () => { if (this.mouseDown && !this.drags.has(t.key)) this.begin(t, this.cursor(), 'native'); });
    win.on('move', () => { if (this.drags.has(t.key)) this.update(t.key, this.cursor()); });
    win.on('will-resize', () => this.cancel(t.key));
    win.on('closed', () => this.cancel(t.key));
  }
  mouseButton(down) {
    this.mouseDown = !!down;
    if (!down) for (const [key,d] of this.drags) if (d.source === 'native') { this.update(key, this.cursor()); this.release(key); }
  }
  stop() { for (const key of new Set([...this.drags.keys(), ...this.glides.keys()])) this.cancel(key); }
}
module.exports = { FloatingMotion, trashGeometry };
