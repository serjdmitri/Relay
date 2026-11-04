// The standalone Jarvis Navigation page has no Mac to ask, so the phone asks the free map services itself: Photon for place search, Valhalla for routes, OpenFreeMap for the map. This answers
// the same three calls the Mac's Relay does (config, search, route), with the same shapes and the same checks, so the page code does not care which one it is talking to. Keep it in step with
// src/main/remote/navigation.js (a test feeds both the same replies and compares).
//
// What it sends: the place text you typed and, for a route, the two points. Nothing about you is added, nothing goes to an AI model, and nothing is stored (the small cache lives in memory).
export const DEFAULTS = { search: 'https://photon.komoot.io/api/', route: 'https://valhalla1.openstreetmap.de/route', style: 'https://tiles.openfreemap.org/styles/dark' };

const point = (p) => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite) && Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 90;
const str = (v, n) => String(v || '').replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);

// Valhalla's route line: an encoded string with 6 decimal places, 5 bits per character, each point stored as a change from the one before.
export function decodeShape(shape) {
  if (shape?.type === 'LineString') return shape.coordinates;
  if (typeof shape !== 'string' || shape.length > 300000) throw Error('Map route geometry is invalid.');
  let i = 0, lat = 0, lon = 0; const points = [];
  const delta = () => {
    let value = 0, shift = 0, byte;
    do {
      if (i >= shape.length || shift > 30) throw Error('Map route geometry is invalid.');
      byte = shape.charCodeAt(i++) - 63;
      if (byte < 0 || byte > 63) throw Error('Map route geometry is invalid.');
      value += (byte & 31) * 2 ** shift; shift += 5;
    } while (byte >= 32);
    return value % 2 ? -(value + 1) / 2 : value / 2;
  };
  while (i < shape.length) { lat += delta(); lon += delta(); points.push([lon / 1e6, lat / 1e6]); if (points.length > 50000) throw Error('Map route geometry is too large.'); }
  return points;
}

const step = (count) => (s) => ({
  text: str(s.instruction, 500), km: Number.isFinite(s.length) && s.length >= 0 ? s.length : 0, seconds: Number.isFinite(s.time) && s.time >= 0 ? s.time : 0,
  index: Number.isInteger(s.begin_shape_index) && s.begin_shape_index >= 0 && s.begin_shape_index < count ? s.begin_shape_index : -1,
  type: Number.isInteger(s.type) ? s.type : 0, streets: (Array.isArray(s.street_names) ? s.street_names : []).slice(0, 3).map((v) => str(v, 80)).filter(Boolean),
  pre: str(s.verbal_pre_transition_instruction, 300), alert: str(s.verbal_transition_alert_instruction || s.verbal_succinct_transition_instruction, 200)
});

// Talks to the providers. fetchImpl and the waiting are passed in for tests.
export class DirectNavigation {
  constructor({ fetchImpl = (...a) => fetch(...a), now = Date.now, wait = (ms) => new Promise((r) => setTimeout(r, ms)), config = DEFAULTS, minGapMs = 1100 } = {}) {
    Object.assign(this, { fetchImpl, now, wait, cfg: { ...DEFAULTS, ...config }, minGapMs });
    this.cache = new Map(); this.last = -Infinity; this.chain = Promise.resolve();
  }
  config() { return { ...this.cfg }; }

  // One request at a time with a pause between them: the free services ask for light use, and a quick second request waits instead of failing.
  request(url, options = {}, signal) {
    const run = async () => {
      const gap = this.minGapMs - (this.now() - this.last);
      if (gap > 0) await this.wait(gap);
      if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
      this.last = this.now();
      const timeout = new AbortController(); const timer = setTimeout(() => timeout.abort(), 12000);
      const onAbort = () => timeout.abort(); signal?.addEventListener?.('abort', onAbort);
      try {
        const r = await this.fetchImpl(url, { ...options, redirect: 'error', referrerPolicy: 'no-referrer', signal: timeout.signal, headers: { accept: 'application/json', ...options.headers } });
        if (!r.ok) throw Error(`Map provider answered ${r.status}.`);
        return await r.json();
      } catch (e) {
        if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
        if (e.message?.startsWith('Map ')) throw e;
        throw Error('Map provider could not finish. Check the connection and retry.');
      } finally { clearTimeout(timer); signal?.removeEventListener?.('abort', onAbort); }
    };
    const result = this.chain.then(run, run); this.chain = result.catch(() => {}); return result;
  }

  async search(query, near, signal) {
    const q = String(query || '').trim();
    if (!q || q.length > 200) throw Error('Enter a place name, up to 200 characters.');
    if (near !== undefined && !point(near)) throw Error('Invalid starting coordinates.');
    const key = JSON.stringify([q.toLowerCase(), near ? near.map((v) => Math.round(v * 100) / 100) : null]);
    const hit = this.cache.get(key); if (hit && this.now() - hit.at < 300000) return hit.items;
    const u = new URL(this.cfg.search); u.searchParams.set('q', q); u.searchParams.set('limit', '6'); if (near) { u.searchParams.set('lon', near[0]); u.searchParams.set('lat', near[1]); }
    const data = await this.request(u.href, {}, signal);
    if (!Array.isArray(data.features)) throw Error('Map search returned an invalid result.');
    const items = data.features.slice(0, 6).filter((f) => point(f.geometry?.coordinates)).map((f) => {
      const p = f.properties || {};
      return { coordinates: f.geometry.coordinates, label: [p.name, [p.housenumber, p.street].filter(Boolean).join(' '), p.city || p.town, p.state, p.country].filter(Boolean).map((v) => String(v).slice(0, 160)).join(', ').slice(0, 400) };
    }).filter((p) => p.label);
    if (this.cache.size >= 32) this.cache.delete(this.cache.keys().next().value);
    this.cache.set(key, { at: this.now(), items }); return items;
  }

  async route(from, to, mode, signal) {
    if (!point(from) || !point(to) || !['driving', 'walking'].includes(mode)) throw Error('Choose a valid starting point, destination and travel mode.');
    const data = await this.request(this.cfg.route, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ locations: [from, to].map(([lon, lat]) => ({ lon, lat })), costing: mode === 'walking' ? 'pedestrian' : 'auto', units: 'kilometers', language: 'en-US', shape_format: 'polyline6' }) }, signal);
    const trip = data.trip, leg = trip?.legs?.[0], coordinates = decodeShape(leg?.shape), summary = trip?.summary;
    if (!summary || !Number.isFinite(summary.time) || summary.time < 0 || !Number.isFinite(summary.length) || summary.length < 0 || !Array.isArray(coordinates) || coordinates.length < 2 || coordinates.length > 50000 || !coordinates.every(point)) throw Error('No usable route was returned. Try another place or travel mode.');
    return { coordinates, seconds: summary.time, km: summary.length, steps: (Array.isArray(leg.maneuvers) ? leg.maneuvers : []).slice(0, 200).map(step(coordinates.length)) };
  }
}

// The page's api(action, body, signal) on top of it, answering exactly like the Mac's /api/navigation/*.
export function directApi(nav = new DirectNavigation()) {
  return async (action, body = {}, signal) => {
    if (action === 'config') return nav.config();
    if (action === 'search') return { places: await nav.search(body.query, body.near, signal) };
    if (action === 'route') return nav.route(body.from, body.to, body.mode, signal);
    throw Error('Unknown navigation request.');
  };
}
