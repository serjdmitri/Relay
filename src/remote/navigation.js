// Jarvis Navigation, the page: search a place (typed or said), preview the route, then navigate: the map follows you, the next turn is shown at the top, and Jarvis speaks the turns as you
// approach them. The deciding (where you are on the route, when to speak, when you have left it) is in navmath.js; what you can say is in navvoice.js; this file is the screen, the
// microphone, the speaker and the GPS. Search and routing go through the Mac's Relay (it asks Photon and Valhalla); nothing here goes to an AI model.
import * as maplibregl from '/maplibre/maplibre-gl.mjs';
import { buildRoute, snap, bearing, NavSession, showDistance, speakDistance } from '/navmath.js';
import { parseCommand, REPLIES } from '/navvoice.js';

maplibregl.setWorkerUrl('/maplibre/maplibre-gl-worker.mjs');
const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.hash.slice(1));
let token = ''; try { token = localStorage.getItem('relay-remote-token') || ''; } catch { /* no storage */ }
const units = (() => { try { return new Intl.Locale(navigator.language).region === 'US' ? 'imperial' : 'metric'; } catch { return 'metric'; } })();

const S = { queue: [], view: 'plan', mode: params.get('mode') === 'walking' ? 'walking' : 'driving', from: null, to: null, route: null, obj: null, steps: [], session: null, watch: null, follow: true, muted: false, wake: null, voice: null, lastReroute: 0, rerouting: false, ready: false, request: null, revision: 0, markers: [], puck: null, hiddenDuringNav: false, listening: null };
let map;

const status = (t) => { $('status').textContent = t || ''; };
const caption = (t) => { $('caption').textContent = t ? `“${t}”` : ''; };

// ---- the server (the Mac's Relay) ----
async function api(action, body, signal) {
  const r = await fetch('/api/navigation/' + action, { method: body ? 'POST' : 'GET', headers: { authorization: 'Bearer ' + token, ...(body ? { 'content-type': 'application/json', 'x-relay-remote': '1' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), signal });
  const data = await r.json();
  if (!r.ok) throw Error(r.status === 401 ? 'Open Relay Home and pair this phone first.' : data.error || 'Navigation could not finish.');
  return data;
}
function cancelRequests() { S.revision++; S.request?.abort(); S.request = null; }

// ---- screens ----
function show(view) {
  S.view = view;
  document.getElementById('app').classList.toggle('nav', view === 'nav'); // while driving the controls drop to the bottom and the map takes the rest
  if (typeof map !== 'undefined' && map) { map.resize(); setTimeout(() => map.resize(), 350); }
  for (const v of ['plan', 'preview', 'nav', 'done']) $('v-' + v).hidden = v !== view;
  $('banner').hidden = view !== 'nav' && view !== 'done'; $('recenter').hidden = view !== 'nav' || S.follow;
  $('apple').href = 'https://maps.apple.com/?' + new URLSearchParams({ daddr: S.to?.label || $('destination').value, dirflg: S.mode === 'walking' ? 'w' : 'd' });
}
const syncModes = () => { for (const b of document.querySelectorAll('#modes .seg')) b.classList.toggle('on', b.dataset.mode === S.mode); };
const ARROWS = { left: '↰', right: '↱', straight: '↑', uturn: '↶', round: '⟳', flag: '⚑', slr: '↗', sll: '↖' };
function arrowFor(type) { // Valhalla turn types
  if ([4, 5, 6].includes(type)) return ARROWS.flag; if ([12, 13].includes(type)) return ARROWS.uturn; if ([26, 27].includes(type)) return ARROWS.round;
  if ([9, 23, 20].includes(type)) return ARROWS.slr; if ([16, 24, 21].includes(type)) return ARROWS.sll;
  if ([10, 11, 2, 18].includes(type)) return ARROWS.right; if ([15, 14, 3, 19].includes(type)) return ARROWS.left; return ARROWS.straight;
}
const clock = (ms) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const mins = (sec) => `${Math.max(1, Math.round(sec / 60))} min`;

// ---- the map, in Jarvis colours ----
// The dark map style is black and grey; this recolours it to deep navy with cyan roads, so it matches the rest of Jarvis. Each layer is tinted by what it is called; a layer that does
// not take the property is skipped.
function tint() {
  const set = (id, prop, value) => { try { map.setPaintProperty(id, prop, value); } catch { /* this kind of layer has no such property */ } };
  for (const l of map.getStyle().layers) {
    const id = l.id;
    if (l.type === 'background') set(id, 'background-color', '#030a10');
    else if (l.type === 'fill') set(id, 'fill-color', /water/.test(id) ? '#08283c' : /park|wood|grass/.test(id) ? '#062029' : /building/.test(id) ? '#0a2433' : /residential/.test(id) ? '#061620' : '#051119');
    else if (l.type === 'line') {
      if (/casing/.test(id)) set(id, 'line-color', '#04202e');
      else if (/waterway/.test(id)) set(id, 'line-color', '#0b3a55');
      else if (/motorway|major/.test(id)) set(id, 'line-color', '#3ab8dd');
      else if (/minor|service|path|track|street/.test(id)) set(id, 'line-color', '#1f7d9c');
      else if (/rail|transit|boundary/.test(id)) set(id, 'line-color', '#1b5a73');
      else set(id, 'line-color', '#2a8fb0');
    } else if (l.type === 'symbol') { set(id, 'text-color', '#8fe3f7'); set(id, 'text-halo-color', '#030a10'); set(id, 'text-halo-width', 1.4); }
  }
}
function drawRoute(coords) {
  const feature = { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } };
  if (map.getSource('route')) { map.getSource('route').setData(feature); return; }
  map.addSource('route', { type: 'geojson', data: feature });
  map.addLayer({ id: 'route-glow', type: 'line', source: 'route', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#55ddff', 'line-width': 13, 'line-opacity': 0.28, 'line-blur': 6 } });
  map.addLayer({ id: 'route', type: 'line', source: 'route', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#7aeaff', 'line-width': 5 } });
}
function clearRoute() {
  S.route = null; S.obj = null; S.steps = []; $('steps').replaceChildren();
  if (map?.getSource('route')) map.getSource('route').setData({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [] } });
  $('fit').disabled = true;
}
function pins() {
  S.markers.forEach((m) => m.remove()); S.markers = [];
  for (const [place, kind] of [[S.from && S.from.label !== 'Current location' ? S.from : null, 'start'], [S.to, 'destination']]) if (place) { const el = document.createElement('div'); el.className = 'pin ' + kind; el.title = place.label; S.markers.push(new maplibregl.Marker({ element: el }).setLngLat(place.coordinates).addTo(map)); }
}
function fitRoute() {
  if (!S.route) return;
  S.follow = false; $('recenter').hidden = S.view !== 'nav';
  map.fitBounds(S.route.coordinates.reduce((b, p) => b.extend(p), new maplibregl.LngLatBounds(S.route.coordinates[0], S.route.coordinates[0])), { padding: { top: 70, bottom: 50, left: 36, right: 36 }, maxZoom: 16, pitch: 0, bearing: 0 });
}

// ---- Jarvis's voice: this phone's own British male voice (Daniel on an iPhone) ----
function pickVoice() {
  const all = ('speechSynthesis' in window) ? speechSynthesis.getVoices() : [];
  const gb = all.filter((v) => /^en[-_]GB/i.test(v.lang));
  S.voice = gb.find((v) => /daniel/i.test(v.name)) || gb.find((v) => /oliver|arthur|gordon|rishi/i.test(v.name)) || gb[0] || all.find((v) => /^en/i.test(v.lang) && /aaron|alex|fred|tom/i.test(v.name)) || all.find((v) => /^en/i.test(v.lang)) || null;
}
if ('speechSynthesis' in window) { pickVoice(); speechSynthesis.addEventListener?.('voiceschanged', pickVoice); }
let unlocked = false;
function unlockSpeech() { // iOS speaks only after a tap: say nothing, once, from the first one
  if (unlocked || !('speechSynthesis' in window)) return; unlocked = true;
  try { const u = new SpeechSynthesisUtterance(' '); u.volume = 0; speechSynthesis.speak(u); } catch { /* no speech */ }
}
addEventListener('pointerdown', unlockSpeech, { once: true, passive: true });
function speak(text, urgent = false) {
  if (!text) return;
  caption(text);
  if (S.muted || !('speechSynthesis' in window)) return;
  try {
    if (urgent) speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    if (S.voice) { u.voice = S.voice; u.lang = S.voice.lang; } else u.lang = 'en-GB';
    u.rate = 1.02; u.pitch = 0.9; u.volume = 1;
    speechSynthesis.speak(u);
  } catch { /* speech is optional */ }
}
const reply = (text) => { status(text); speak(text, true); };

// ---- keeping the screen on ----
async function requestWake() { try { if (navigator.wakeLock && !S.wake) { S.wake = await navigator.wakeLock.request('screen'); S.wake.addEventListener?.('release', () => { S.wake = null; }); } } catch { S.wake = null; } }
function releaseWake() { if (hey?.enabled) return; try { S.wake?.release(); } catch { /* gone */ } S.wake = null; }
document.addEventListener('visibilitychange', () => {
  if (S.view !== 'nav') return;
  if (document.visibilityState === 'hidden') S.hiddenDuringNav = true;
  else { requestWake(); if (S.hiddenDuringNav) { S.hiddenDuringNav = false; status('Guidance pauses while this page is in the background. Keep it open with the screen on, or use Apple Maps.'); } }
});

// ---- places and routes ----
function position(opts = {}) {
  return new Promise((resolve, reject) => {
    if (!window.isSecureContext || !navigator.geolocation) return reject(Error('Location needs a secure HTTPS connection.'));
    navigator.geolocation.getCurrentPosition(resolve, (e) => reject(Error(e && e.code === 1 ? 'Location is blocked. Allow it for this site in Safari settings.' : 'Location unavailable.')), { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000, ...opts });
  });
}
async function useMyLocation() {
  status('Waiting for location…');
  const p = await position(); const c = p.coords;
  if (!Number.isFinite(c.longitude) || !Number.isFinite(c.latitude) || c.accuracy > 5000) throw Error('Location is too imprecise. Search for a starting place instead.');
  S.from = { label: 'Current location', coordinates: [c.longitude, c.latitude] }; $('startsum').textContent = 'Starting from: current location'; $('origin').value = 'Current location';
  return S.from;
}
async function search(kind, query = $(kind).value.trim()) {
  cancelRequests(); const id = S.revision;
  if (!query) { status('Enter a place to search.'); return []; }
  S.request = new AbortController(); status('Searching places…'); $('places').replaceChildren();
  try {
    const r = await api('search', { query, ...(S.from ? { near: S.from.coordinates } : {}) }, S.request.signal);
    if (id !== S.revision) return [];
    status(r.places.length ? `Choose the correct ${kind === 'origin' ? 'starting point' : 'destination'}.` : 'No matching places. Try adding a city or street.');
    for (const place of r.places) { const b = document.createElement('button'); b.type = 'button'; b.textContent = place.label; b.onclick = () => choose(kind, place); $('places').append(b); }
    return r.places;
  } catch (e) { if (id === S.revision && e.name !== 'AbortError') status(e.message); return []; }
}
async function choose(kind, place) {
  cancelRequests(); $('places').replaceChildren();
  if (kind === 'origin') { S.from = place; $('startsum').textContent = 'Starting from: ' + place.label.split(',')[0]; $('origin').value = place.label; } else { S.to = place; $('destination').value = place.label; }
  clearRoute(); pins();
  if (S.to) { if (!S.from) { try { await useMyLocation(); } catch (e) { status(e.message + ' Open "Starting from" and search a place.'); $('startbox').open = true; return; } } await previewRoute(); }
}
// A normal route step has the point of the route where it begins; if the provider gave none, it is worked out from the lengths.
function fixSteps(steps, obj) {
  let run = 0;
  return steps.map((s) => {
    let index = s.index;
    if (!(index >= 0)) { index = obj.cum.findIndex((c) => c >= run); if (index < 0) index = obj.coords.length - 1; }
    run += (Number(s.km) || 0) * 1000; return { ...s, index };
  });
}
function applyRoute(r) {
  S.route = r; S.obj = buildRoute(r.coordinates); S.steps = fixSteps(r.steps || [], S.obj); drawRoute(r.coordinates);
  $('steps').replaceChildren(...S.steps.map((s) => { const li = document.createElement('li'); li.textContent = s.text; return li; }));
  $('fit').disabled = false;
}
async function previewRoute() {
  if (!S.from || !S.to) return;
  cancelRequests(); const id = S.revision; S.request = new AbortController(); status('Finding a route…');
  try {
    const r = await api('route', { from: S.from.coordinates, to: S.to.coordinates, mode: S.mode }, S.request.signal);
    if (id !== S.revision) return;
    applyRoute(r); pins();
    $('summary').textContent = `${mins(r.seconds)} · ${showDistance(r.km * 1000, units)}`;
    $('eta-line').textContent = `To ${S.to.label.split(',')[0]}${S.queue.length ? ` · then ${S.queue.map(short).join(', then ')}` : ''} · arrive about ${clock(Date.now() + r.seconds * 1000)} · ${S.mode === 'walking' ? 'walking' : 'driving'}`;
    show('preview'); fitRoute(); status('Route ready. Tap Start, or say “start”.');
    return r;
  } catch (e) { if (id === S.revision && e.name !== 'AbortError') status(e.message); }
}
// Saved places ("this is home"): kept on this phone only.
const PLACES_KEY = 'relay-nav-places';
const savedPlaces = () => { try { return JSON.parse(localStorage.getItem(PLACES_KEY) || '{}') || {}; } catch { return {}; } };
function savePlace(name, place) { try { const all = savedPlaces(); all[name] = place; localStorage.setItem(PLACES_KEY, JSON.stringify(all)); return true; } catch { return false; } }
const short = (p) => (p ? String(p.label || '').split(',')[0] || 'the next stop' : '');
const isSavedName = (t) => /^(?:home|work)$/i.test(String(t || ''));
// A place by its words, without showing the list: a saved place first, otherwise the best match near you.
async function lookup(text) {
  const saved = savedPlaces()[String(text).toLowerCase()];
  if (saved) return saved;
  if (isSavedName(text)) return null;
  try { const r = await api('search', { query: text, ...(S.from ? { near: S.from.coordinates } : {}) }); return (r.places || [])[0] || null; } catch { return null; }
}
// "Take me to X" (or "X and then Y"): find it, pick the best match, route from where you are, and wait for "start".
async function go(place, mode = S.mode, then = []) {
  S.mode = mode; syncModes(); $('destination').value = place; S.queue = [];
  try { if (!S.from) await useMyLocation(); } catch (e) { status(e.message + ' Open "Starting from" and search a place.'); $('startbox').open = true; show('plan'); return; }
  let first = null;
  if (isSavedName(place) || savedPlaces()[String(place).toLowerCase()]) { first = await lookup(place); if (!first) { reply(REPLIES.nohome(String(place).toLowerCase())); return; } }
  else { const places = await search('destination', place); if (!places.length) { speak(`I could not find ${place}, Sir.`, true); return; } first = places[0]; }
  for (const t of then) { const p = await lookup(t); if (!p) { reply(isSavedName(t) ? REPLIES.nohome(String(t).toLowerCase()) : `I could not find ${t}, Sir.`); return; } S.queue.push(p); }
  S.to = first; $('destination').value = first.label; $('places').replaceChildren(); pins();
  const r = await previewRoute();
  if (r) speak(`Route to ${short(first)}${S.queue.length ? `, then ${S.queue.map(short).join(', then ')}` : ''}. ${mins(r.seconds)}, ${speakDistance(r.km * 1000, units)}. Say start when you are ready, Sir.`, true);
}
// A stop on the way: it becomes the next destination and the old one waits behind it.
async function addStop(text) {
  const p = await lookup(text);
  if (!p) return reply(isSavedName(text) ? REPLIES.nohome(String(text).toLowerCase()) : `I could not find ${text}, Sir.`);
  if (!S.to) return reply('Tell me where to first, Sir.');
  const before = { to: S.to, queue: S.queue.slice() };
  S.queue.unshift(S.to); S.to = p;
  const told = () => reply(`Added ${short(p)} as a stop, Sir. Then ${short(S.queue[0])}.`);
  try {
    if (S.view === 'nav') {
      const pos = await position({ maximumAge: 0 });
      const r = await api('route', { from: [pos.coords.longitude, pos.coords.latitude], to: p.coordinates, mode: S.mode });
      applyRoute(r); S.session.setRoute(S.obj, S.steps, r.seconds); S.session.destination = p.label; S.lastReroute = Date.now(); pins(); told();
    } else { pins(); await previewRoute(); told(); }
  } catch (e) { S.to = before.to; S.queue = before.queue; status(e.message); }
}
// After arriving at a stop: route from here to the next one and go.
async function continueTrip() {
  const next = S.queue.shift();
  if (!next) return reply(REPLIES.nostop);
  S.to = next; $('banner').classList.remove('arrive'); status('Finding the way…');
  try {
    const p = await position({ maximumAge: 0 });
    applyRoute(await api('route', { from: [p.coords.longitude, p.coords.latitude], to: next.coordinates, mode: S.mode })); pins();
  } catch (e) { S.queue.unshift(next); status(e.message); return; }
  await startNav();
}

// ---- navigating ----
function updateNav(info) {
  const next = info.next;
  $('b-icon').textContent = info.arrived ? ARROWS.flag : arrowFor(next ? next.type : 4);
  $('b-dist').textContent = showDistance(info.distToNext, units);
  $('b-street').textContent = info.arrived ? 'You have arrived' : next ? next.text : 'Continue to your destination';
  $('banner').classList.toggle('arrive', !!info.arrived || !next);
  $('s-arrive').textContent = clock(Date.now() + info.seconds * 1000); $('s-time').textContent = mins(info.seconds); $('s-dist').textContent = showDistance(info.remaining, units);
}
function puckAt(point, heading) {
  if (!S.puck) { const el = document.createElement('div'); el.className = 'puck'; S.puck = new maplibregl.Marker({ element: el, rotationAlignment: 'map', pitchAlignment: 'map' }).setLngLat(point).addTo(map); }
  S.puck.setLngLat(point); if (Number.isFinite(heading)) S.puck.setRotation(heading);
}
function follow(info, fix) {
  puckAt(info.point, info.heading);
  if (!S.follow) return;
  const v = Number.isFinite(fix.speed) ? fix.speed : 0;
  map.easeTo({ center: info.point, bearing: Number.isFinite(info.heading) ? info.heading : map.getBearing(), pitch: S.mode === 'driving' ? 55 : 45, zoom: S.mode === 'walking' ? 17.5 : v > 20 ? 15.4 : v > 10 ? 16.2 : 17, duration: 900, essential: true });
}
function onFix(p) {
  if (S.view !== 'nav' || !S.session) return;
  const c = p.coords, fix = { lon: c.longitude, lat: c.latitude, accuracy: c.accuracy, heading: c.heading, speed: c.speed, t: p.timestamp };
  if (!(c.accuracy <= 150)) { status('Weak GPS signal…'); return; }
  const info = S.session.onFix(fix);
  updateNav(info); follow(info, fix);
  if (info.arrived) return arrived();
  if (info.offRoute) reroute(fix); else if (!S.rerouting) status('');
}
async function reroute(fix) {
  if (S.rerouting || Date.now() - S.lastReroute < 12000) return;
  S.rerouting = true; S.lastReroute = Date.now(); speak('Recalculating, Sir.', true); status('Recalculating…');
  try {
    const r = await api('route', { from: [fix.lon, fix.lat], to: S.to.coordinates, mode: S.mode });
    applyRoute(r); S.session.setRoute(S.obj, S.steps, r.seconds); status(''); speak('Route updated.');
  } catch (e) { status(e.message); speak('I could not recalculate, Sir. Apple Maps can take over if you need it.', true); }
  finally { S.rerouting = false; }
}
async function startNav() {
  if (!S.route || !S.to) { status('Choose a destination first.'); return; }
  unlockSpeech();
  if (!window.isSecureContext || !navigator.geolocation) { status('Live guidance needs your location, which Safari only gives over a secure (https) connection. The preview still works, and Apple Maps can guide you.'); return; }
  status('Finding your position…'); await requestWake();
  let first; try { first = await position({ maximumAge: 0 }); } catch (e) { status(e.message); return; }
  const here = [first.coords.longitude, first.coords.latitude];
  if (snap(S.obj, here).dist > 150) { try { applyRoute(await api('route', { from: here, to: S.to.coordinates, mode: S.mode })); } catch (e) { status(e.message); return; } } // you are not where the route starts: route from here
  S.follow = true; S.lastReroute = Date.now();
  { const sn = snap(S.obj, here); const ahead = S.obj.coords[Math.min(S.obj.coords.length - 1, (sn.seg || 0) + 1)]; map.stop(); map.jumpTo({ center: here, zoom: S.mode === 'walking' ? 17.5 : 16.5, pitch: S.mode === 'driving' ? 55 : 45, bearing: ahead ? bearing(here, ahead) : 0 }); } // start already looking at you, not at the whole route
  S.session = new NavSession({ route: S.obj, steps: S.steps, mode: S.mode, units, destination: S.to.label, seconds: S.route.seconds, speak });
  show('nav'); status(''); caption('');
  S.session.start(); onFix(first);
  S.watch = navigator.geolocation.watchPosition(onFix, () => status('Location lost. Check that this page may use your location.'), { enableHighAccuracy: true, maximumAge: 1000, timeout: 20000 });
}
function endWatch() { if (S.watch !== null) { try { navigator.geolocation.clearWatch(S.watch); } catch { /* gone */ } S.watch = null; } releaseWake(); S.session = null; S.puck?.remove(); S.puck = null; }
function stopNav(message) {
  S.queue = []; endWatch(); try { speechSynthesis.cancel(); } catch { /* none */ }
  S.follow = false; show('preview'); map.easeTo({ pitch: 0, bearing: 0, duration: 600 }); setTimeout(fitRoute, 650);
  if (message) reply(message);
}
function arrived() {
  endWatch(); show('done'); $('banner').classList.add('arrive'); $('b-icon').textContent = ARROWS.flag; $('b-dist').textContent = 'Arrived'; $('b-street').textContent = S.to ? S.to.label.split(',')[0] : '';
  const next = S.queue[0];
  $('next').hidden = !next; $('next-line').textContent = next ? `Next stop: ${short(next)}` : '';
  if (next) { $('next').textContent = `Continue to ${short(next)}`; speak(`Say continue when you are ready for ${short(next)}, Sir.`); }
}
function reset() { S.queue = []; cancelRequests(); endWatch(); clearRoute(); S.to = null; S.markers.forEach((m) => m.remove()); S.markers = []; $('destination').value = ''; $('places').replaceChildren(); $('banner').classList.remove('arrive'); show('plan'); status('Where to?'); map.easeTo({ pitch: 0, bearing: 0, duration: 500 }); }

// ---- talking to Jarvis ----
const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
function listen(button) {
  unlockSpeech();
  if (!Recognition) { status('This browser cannot listen. Type a destination, or use the microphone on the keyboard.'); return; }
  if (S.listening) { try { S.listening.stop(); } catch { /* done */ } return; }
  try { speechSynthesis.cancel(); } catch { /* none */ }
  const r = new Recognition(); r.lang = 'en-US'; r.interimResults = false; r.maxAlternatives = 1; S.listening = r; button.classList.add('live'); status('Listening…');
  r.onresult = (e) => { const text = e.results[0] && e.results[0][0] ? e.results[0][0].transcript : ''; status(`“${text}”`); handle(text); };
  r.onerror = (e) => status(e && e.error === 'not-allowed' ? 'Allow the microphone for this site in Safari settings.' : 'I did not catch that, Sir.');
  r.onend = () => { S.listening = null; button.classList.remove('live'); };
  try { r.start(); } catch { S.listening = null; button.classList.remove('live'); }
}
function voiceShow() { $('voice').firstElementChild.textContent = S.muted ? '🔇' : '🔊'; $('voice').lastElementChild.textContent = S.muted ? 'Muted' : 'Voice'; $('voice').setAttribute('aria-pressed', String(!S.muted)); }
async function setPlaceHere(name) {
  try { const p = await position({ maximumAge: 0 }); const c = p.coords; if (!(c.accuracy <= 500)) return reply('I cannot tell where you are well enough yet, Sir. Try again in a moment.'); savePlace(name, { label: name[0].toUpperCase() + name.slice(1), coordinates: [c.longitude, c.latitude] }); reply(REPLIES.sethome(name)); } catch (e) { status(e.message); }
}
function handle(text) {
  const cmd = parseCommand(text);
  if (!cmd) { if (S.view === 'plan' && String(text).trim().length > 1) return go(String(text).trim(), S.mode); return reply(REPLIES.none); }
  switch (cmd.type) {
    case 'go': return go(cmd.place, cmd.mode, cmd.then || []);
    case 'addstop': return addStop(cmd.place);
    case 'continue': return S.view === 'done' && S.queue.length ? continueTrip() : reply(REPLIES.nostop);
    case 'sethome': return setPlaceHere(cmd.name);
    case 'mode': S.mode = cmd.mode; syncModes(); reply(REPLIES.mode(cmd.mode)); if (S.to && S.view !== 'nav') previewRoute(); return;
    case 'start': return S.view === 'done' && S.queue.length ? continueTrip() : S.view === 'preview' ? startNav() : reply(S.view === 'nav' ? 'Already navigating, Sir.' : 'Tell me where to first, Sir.');
    case 'stop': return S.view === 'nav' ? stopNav(REPLIES.stop) : S.view === 'preview' ? reset() : undefined;
    case 'mute': S.muted = true; voiceShow(); try { speechSynthesis.cancel(); } catch { /* none */ } return status(REPLIES.mute);
    case 'unmute': S.muted = false; voiceShow(); return reply(REPLIES.unmute);
    case 'repeat': return S.session ? S.session.repeat() : reply('There is nothing to repeat, Sir.');
    case 'next': return S.session ? speak(S.session.describeNext(), true) : reply('We are not navigating, Sir.');
    case 'eta': { const i = S.session && S.session.latest; return i ? speak(`${mins(i.seconds)} to go, ${speakDistance(i.remaining, units)}. You will arrive about ${clock(Date.now() + i.seconds * 1000)}, Sir.`, true) : reply('We are not navigating, Sir.'); }
    case 'zoom-in': return void map.zoomTo(map.getZoom() + 1, { duration: 300 });
    case 'zoom-out': return void map.zoomTo(map.getZoom() - 1, { duration: 300 });
    case 'overview': return fitRoute();
    case 'recenter': S.follow = true; $('recenter').hidden = true; return;
    case 'apple': reply(REPLIES.apple); return void (location.href = $('apple').href);
    default: return reply(REPLIES.none);
  }
}

// ---- "Hey Jarvis": hands-free while the page is open and the screen is on ----
const HEY = 'relay-remote-hey';
let hey = null;
const heySaved = () => { try { return localStorage.getItem(HEY) === '1'; } catch { return false; } };
const heySave = (on) => { try { localStorage.setItem(HEY, on ? '1' : '0'); } catch { /* not saved */ } };
function heyShow(on) { $('hey').setAttribute('aria-pressed', String(!!on)); $('hey').title = on ? 'Hey Jarvis is listening' : 'Hey Jarvis is off'; }
async function heyStart() {
  if (!Recognition) { status('This browser cannot listen. Open Relay in Safari.'); return; }
  try {
    if (!hey) {
      const { WakeLoop } = await import('/wakeword.js');
      hey = new WakeLoop({
        makeRecognizer: () => { const r = new Recognition(); r.lang = navigator.language || 'en-US'; r.continuous = true; r.interimResults = true; return r; },
        onWake: () => { try { speechSynthesis.cancel(); } catch { /* none */ } status('Listening…'); },
        onCommand: (t) => { status(`“${t}”`); handle(t); },
        onGiveUp: () => status(''),
        onState: (st) => {
          if (st === 'listening') heyShow(true);
          else if (st === 'off') heyShow(false);
          else if (st === 'blocked' || st === 'error') { heyShow(false); heySave(false); status(st === 'blocked' ? 'Allow the microphone for this site in Safari settings to use “Hey Jarvis”.' : '“Hey Jarvis” stopped: the speech service keeps failing.'); }
        }
      });
      setInterval(() => hey.setPaused(!!S.listening || (!S.muted && !!speechSynthesis?.speaking) || document.visibilityState !== 'visible'), 400);
    }
    hey.start(); requestWake();
  } catch { heyShow(false); status('Could not start “Hey Jarvis”.'); }
}
$('hey').onclick = () => { unlockSpeech(); if (hey?.enabled) { hey.stop(); heySave(false); } else { heySave(true); heyStart(); } };
if (heySaved()) { const first = () => { removeEventListener('pointerdown', first, true); if (heySaved() && !hey?.enabled) heyStart(); }; addEventListener('pointerdown', first, true); }

// ---- wiring ----
$('destination-form').onsubmit = (e) => { e.preventDefault(); unlockSpeech(); S.to = null; clearRoute(); search('destination'); };
$('origin-form').onsubmit = (e) => { e.preventDefault(); search('origin'); };
$('destination').oninput = () => { cancelRequests(); S.to = null; clearRoute(); $('places').replaceChildren(); };
$('origin').oninput = () => { cancelRequests(); S.from = null; $('startsum').textContent = 'Starting from: choose'; clearRoute(); };
for (const b of document.querySelectorAll('#modes .seg')) b.onclick = () => { S.mode = b.dataset.mode; syncModes(); if (S.to && S.from && S.view === 'preview') previewRoute(); };
$('locate').onclick = async () => { try { await useMyLocation(); status('Starting from your location.'); if (S.to) previewRoute(); } catch (e) { status(e.message); } };
$('start').onclick = startNav; $('fit').onclick = fitRoute; $('route').onclick = previewRoute;
$('next').onclick = continueTrip; $('cancel').onclick = reset; $('done').onclick = reset; $('end').onclick = () => stopNav('Navigation ended, Sir.'); $('overview').onclick = fitRoute;
$('mic').onclick = () => listen($('mic')); $('nmic').onclick = () => listen($('nmic'));
$('voice').onclick = () => handle(S.muted ? 'unmute' : 'mute');
$('recenter').onclick = () => { S.follow = true; $('recenter').hidden = true; };
$('zin').onclick = () => map.zoomTo(map.getZoom() + 1, { duration: 250 }); $('zout').onclick = () => map.zoomTo(map.getZoom() - 1, { duration: 250 });

async function boot() {
  for (const el of document.querySelectorAll('button,input')) el.disabled = true;
  syncModes();
  try {
    const cfg = await api('config');
    $('providers').textContent = 'Online providers: ' + [cfg.style, cfg.search, cfg.route].map((u) => new URL(u).host).join(' · ');
    map = new maplibregl.Map({ container: 'map', style: cfg.style, center: [0, 20], zoom: 1, attributionControl: false, dragRotate: false, pitchWithRotate: false, touchPitch: false });
    let loaded = false;
    map.on('error', () => { if (!loaded) status('Map tiles could not load. Check your connection, or use Apple Maps below.'); });
    map.on('dragstart', () => { if (S.view === 'nav') { S.follow = false; $('recenter').hidden = false; } });
    map.on('load', () => {
      loaded = S.ready = true; tint();
      for (const el of document.querySelectorAll('button,input')) el.disabled = false;
      $('fit').disabled = true; show('plan'); status('Where to?');
      const dest = (params.get('destination') || '').slice(0, 200);
      if (dest) { const c = parseCommand('take me to ' + dest); if (c && c.type === 'go') go(c.place, S.mode, c.then || []); else go(dest, S.mode); }
    });
  } catch (e) { status(e.message); }
}
addEventListener('pagehide', () => { cancelRequests(); endWatch(); map?.remove(); });
window.__nav = { S, handle, onFix }; // a hook for tests: the page's state and the command handler
boot();
