// The navigation engine of the phone map page: where you are on the route, which turn is next and how far, when to speak, when you have left the route, and when you have arrived.
// No screen, no network, no clock of its own: positions go in, decisions come out, so all of it is tested without a phone. Coordinates are [longitude, latitude]; distances are metres.
// The page (navigation.js) feeds it GPS fixes and shows and speaks what it says.

const R = 6371000, rad = (d) => (d * Math.PI) / 180, deg = (r) => (r * 180) / Math.PI;

export function haversine(a, b) {
  const dLat = rad(b[1] - a[1]), dLon = rad(b[0] - a[0]);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

// Compass bearing from a to b, 0 = north, clockwise.
export function bearing(a, b) {
  const dLon = rad(b[0] - a[0]), y = Math.sin(dLon) * Math.cos(rad(b[1])), x = Math.cos(rad(a[1])) * Math.sin(rad(b[1])) - Math.sin(rad(a[1])) * Math.cos(rad(b[1])) * Math.cos(dLon);
  return (deg(Math.atan2(y, x)) + 360) % 360;
}

// The route as a line with the distance along it at every point.
export function buildRoute(coords) {
  const cum = [0];
  for (let i = 1; i < coords.length; i++) cum.push(cum[i - 1] + haversine(coords[i - 1], coords[i]));
  return { coords, cum, total: cum[cum.length - 1] || 0 };
}

// Where on the route is this position? Looks near where you last were first (so a road that passes close to itself is not mistaken), and everywhere if you seem lost.
// -> { seg, along (metres from the start), dist (metres from the route), point: [lon, lat] }
export function snap(route, pos, hint = 0) {
  const { coords, cum } = route, n = coords.length;
  if (n < 2) return { seg: 0, along: 0, dist: Infinity, point: coords[0] || pos };
  const kx = 111320 * Math.cos(rad(pos[1])), ky = 110540;
  const scan = (from, to) => {
    let best = null;
    for (let i = Math.max(0, from); i < Math.min(n - 1, to); i++) {
      const ax = (coords[i][0] - pos[0]) * kx, ay = (coords[i][1] - pos[1]) * ky, bx = (coords[i + 1][0] - pos[0]) * kx, by = (coords[i + 1][1] - pos[1]) * ky;
      const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
      const t = len2 ? Math.max(0, Math.min(1, (-ax * dx - ay * dy) / len2)) : 0;
      const d = Math.hypot(ax + t * dx, ay + t * dy);
      if (!best || d < best.dist) best = { seg: i, t, dist: d };
    }
    return best;
  };
  let best = scan(hint - 3, hint + 80);
  if (!best || best.dist > 60) { const all = scan(0, n - 1); if (all && (!best || all.dist < best.dist)) best = all; }
  const a = coords[best.seg], b = coords[best.seg + 1];
  return { seg: best.seg, along: cum[best.seg] + best.t * (cum[best.seg + 1] - cum[best.seg]), dist: best.dist, point: [a[0] + best.t * (b[0] - a[0]), a[1] + best.t * (b[1] - a[1])] };
}

// Which step of the directions are you on, and how far to the next turn? steps: [{ index }] where index is the point of the route where that step begins.
export function stepAt(steps, route, along) {
  let i = 0;
  for (let k = 0; k < steps.length; k++) if (route.cum[Math.min(steps[k].index, route.coords.length - 1)] <= along + 1) i = k;
  const nextStart = i + 1 < steps.length ? route.cum[Math.min(steps[i + 1].index, route.coords.length - 1)] : route.total;
  return { stepIndex: i, distToNext: Math.max(0, nextStart - along), last: i >= steps.length - 1 };
}

// ---- when to speak ----
// Like a car's navigation: the turn is announced early, again closer, and once more as you reach it. Walking is much shorter.
export const THRESHOLDS = {
  driving: [{ key: 'far', m: 900 }, { key: 'near', m: 250 }, { key: 'now', m: 45 }],
  walking: [{ key: 'far', m: 160 }, { key: 'near', m: 55 }, { key: 'now', m: 16 }]
};
export const OFF_ROUTE = { driving: 45, walking: 30 };
export const ARRIVE = { driving: 30, walking: 20 };

// In metres, in words people say: "400 meters", "1.2 kilometers", "500 feet", "a quarter mile". units: 'metric' or 'imperial'.
export function speakDistance(m, units = 'metric') {
  if (units === 'imperial') {
    const ft = m * 3.28084;
    if (ft < 1000) return `${Math.max(50, Math.round(ft / 50) * 50)} feet`;
    const mi = m / 1609.344;
    if (mi < 0.375) return 'a quarter mile'; if (mi < 0.625) return 'half a mile'; if (mi < 0.875) return 'three quarters of a mile';
    if (mi < 1.25) return 'one mile';
    return `${mi < 10 ? (Math.round(mi * 10) / 10).toString() : Math.round(mi)} miles`;
  }
  if (m < 950) return `${Math.max(50, Math.round(m / 50) * 50)} meters`;
  const km = Math.round((m / 1000) * 10) / 10;
  return km === 1 ? 'one kilometer' : `${Number.isInteger(km) ? km : km.toFixed(1)} kilometers`;
}

// Short, for the screen: "450 m", "1.2 km", "500 ft", "0.3 mi".
export function showDistance(m, units = 'metric') {
  if (units === 'imperial') { const ft = m * 3.28084; return ft < 1000 ? `${Math.max(10, Math.round(ft / 10) * 10)} ft` : `${(m / 1609.344).toFixed(m / 1609.344 < 10 ? 1 : 0)} mi`; }
  return m < 1000 ? `${Math.max(10, Math.round(m / 10) * 10)} m` : `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`;
}

const lower = (s) => String(s || '').replace(/^./, (c) => c.toLowerCase());
const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();

// What Jarvis says. kind: 'far' | 'near' | 'now' for the turn after this one (step), 'arrive' at the end.
export function phrase(kind, step, dist, { units = 'metric', destination = '' } = {}) {
  if (kind === 'arrive') return destination ? `You have arrived at ${clean(destination).split(',')[0]}, Sir.` : 'You have arrived, Sir.';
  const pre = clean(step && (step.pre || step.alert || step.text));
  if (!pre) return '';
  if (kind === 'now') return clean((step && (step.alert || step.pre)) || pre);
  return `In ${speakDistance(dist, units)}, ${lower(pre)}`;
}

// Decides which announcements are due. Each (turn, distance) is spoken once; if you are suddenly past several (a short block, a lost signal) only the closest is spoken.
export class Announcer {
  constructor(mode = 'driving') { this.mode = mode === 'walking' ? 'walking' : 'driving'; this.reset(); }
  reset() { this.said = new Set(); }
  // upcoming: index of the step whose start is the next turn; dist: metres to it. -> [{ kind, step, dist }]
  due(upcoming, dist, last = false) {
    const out = [];
    if (last) return out;
    let pick = null;
    for (const t of THRESHOLDS[this.mode]) {
      const key = `${upcoming}:${t.key}`;
      if (dist <= t.m && !this.said.has(key)) { this.said.add(key); pick = { kind: t.key, step: upcoming, dist }; }
    }
    if (pick) out.push(pick);
    return out;
  }
}

// Has the position been away from the route long enough, and far enough, to be a wrong turn? Not on one noisy fix.
export class OffRouteWatch {
  constructor(mode = 'driving') { this.mode = mode === 'walking' ? 'walking' : 'driving'; this.since = null; this.count = 0; }
  reset() { this.since = null; this.count = 0; }
  // dist: metres from the route; accuracy: GPS accuracy in metres; t: milliseconds
  check(dist, accuracy, t) {
    const limit = Math.max(OFF_ROUTE[this.mode], (Number(accuracy) || 0) * 1.2);
    if (!(dist > limit)) { this.reset(); return false; }
    if (this.since === null) this.since = t;
    this.count++;
    return this.count >= 3 && t - this.since >= 4000;
  }
}

// One navigation: feed it positions with onFix(), it says what to speak and show.
export class NavSession {
  // route: buildRoute(coords). steps: [{ index, text, pre, alert, type, seconds, km }]. speak(text, urgent): called for each spoken line.
  constructor({ route, steps, mode = 'driving', units = 'metric', destination = '', seconds = 0, speak = () => {} }) {
    Object.assign(this, { mode, units, destination, speak });
    this.setRoute(route, steps, seconds);
  }
  setRoute(route, steps, seconds = this.seconds) {
    this.route = route; this.steps = steps; this.seconds = seconds || 0;
    this.hint = 0; this.announcer = new Announcer(this.mode); this.watch = new OffRouteWatch(this.mode); this.lastLine = ''; this.arrivedSaid = false; this.lastFix = null; this.heading = null; this.latest = null;
  }
  say(text, urgent = false) { if (!text) return; this.lastLine = text; this.speak(text, urgent); }
  start() { const first = this.steps[0]; this.say(`Starting navigation${this.destination ? ` to ${clean(this.destination).split(',')[0]}` : ''}.${first && first.pre ? ` ${clean(first.pre)}` : ''}`, true); }
  repeat() { if (this.lastLine) this.speak(this.lastLine, true); }
  // the next turn in words, for "what's next?"
  describeNext() {
    const f = this.latest;
    if (!f) return 'I do not have your position yet, Sir.';
    return f.next ? phrase('far', f.next, f.distToNext, { units: this.units }) : `Your destination is ${speakDistance(f.remaining, this.units)} ahead, Sir.`;
  }
  // fix: { lon, lat, accuracy, heading, speed, t }. -> { along, off, stepIndex, distToNext, remaining, seconds, next, arrived, offRoute, heading, point }
  onFix(fix) {
    const s = snap(this.route, [fix.lon, fix.lat], this.hint);
    this.hint = s.seg;
    const st = stepAt(this.steps, this.route, s.along), remaining = Math.max(0, this.route.total - s.along);
    // which way you are heading: the compass if the phone gives a valid one while moving, else from the last two positions
    let heading = Number.isFinite(fix.heading) && fix.speed > 1 ? fix.heading : null;
    if (heading === null && this.lastFix && haversine([this.lastFix.lon, this.lastFix.lat], [fix.lon, fix.lat]) > 5) heading = bearing([this.lastFix.lon, this.lastFix.lat], [fix.lon, fix.lat]);
    if (heading !== null) this.heading = heading;
    this.lastFix = { lon: fix.lon, lat: fix.lat };
    const info = { along: s.along, off: s.dist, stepIndex: st.stepIndex, distToNext: st.distToNext, remaining, seconds: this.route.total ? this.seconds * (remaining / this.route.total) : 0, next: this.steps[st.stepIndex + 1] || null, arrived: false, offRoute: false, heading: this.heading, point: s.point };
    if ((st.last && remaining <= ARRIVE[this.mode]) || remaining <= ARRIVE[this.mode] / 2) {
      info.arrived = true;
      if (!this.arrivedSaid) { this.arrivedSaid = true; this.say(phrase('arrive', null, 0, { destination: this.destination }), true); }
      this.latest = info; return info;
    }
    if (this.watch.check(s.dist, fix.accuracy, fix.t || Date.now())) { info.offRoute = true; this.latest = info; return info; }
    // the next turn: only announced while you are actually on the route
    if (s.dist <= OFF_ROUTE[this.mode]) for (const d of this.announcer.due(st.stepIndex + 1, st.distToNext, st.last)) this.say(phrase(d.kind, this.steps[d.step], d.dist, { units: this.units }), d.kind === 'now');
    this.latest = info; return info;
  }
}
