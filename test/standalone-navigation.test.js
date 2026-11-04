const test = require('node:test'), assert = require('node:assert/strict');
const { NavigationService, decodeShape: macDecode } = require('../src/main/remote/navigation');
const load = () => import('../src/remote/navdirect.js');
const response = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
const POLY = 'mlwfaBduxFa@zD[tB]zBDnI}@?w@@mABi@@y@BoBh@iGlBcAXqCiEaEuF';
const photon = { features: [
  { geometry: { coordinates: [-80.17, 26.01] }, properties: { name: 'Starbucks', housenumber: '3255', street: 'Hollywood Boulevard', city: 'Hollywood', state: 'Florida', country: 'United States' } },
  { geometry: { coordinates: [999, 0] }, properties: { name: 'Off the map' } },
  { geometry: { coordinates: [-80.2, 26.0] }, properties: { name: 'Beach Cafe', town: 'Dania' } },
  { geometry: { coordinates: [-80.3, 26.1] }, properties: {} }
] };
const maneuvers = [
  { instruction: 'Drive east on Alpha Road.', length: 2, time: 150, begin_shape_index: 0, type: 2, street_names: ['Alpha Road', 'B', 'C', 'D'], verbal_pre_transition_instruction: 'Drive east on Alpha Road.' },
  { instruction: 'Turn left onto Beta Street.', length: 1.2, time: 90, begin_shape_index: 3, type: 15, verbal_pre_transition_instruction: 'Turn left onto Beta Street.', verbal_transition_alert_instruction: 'Turn left.' },
  { instruction: 'Odd step.', length: -1, time: 'x', begin_shape_index: 9999, type: 'x', street_names: 'nope' },
  { instruction: 'x'.repeat(900), verbal_pre_transition_instruction: '\u0007bell\n tab', verbal_succinct_transition_instruction: 'Short.' }
];
const trip = (shape) => ({ trip: { summary: { time: 300, length: 3.8 }, legs: [{ shape, maneuvers }] } });

async function both(handler) {
  const { DirectNavigation } = await load();
  let t = 0; const calls = { mac: [], direct: [] };
  const mac = new NavigationService({ fetchImpl: async (url, o) => { calls.mac.push({ url, o }); return handler(url, o); }, now: () => (t += 5000) });
  const direct = new DirectNavigation({ fetchImpl: async (url, o) => { calls.direct.push({ url, o }); return handler(url, o); }, now: () => (t += 5000), wait: async () => {} });
  return { mac, direct, calls };
}

test('the phone answers a place search exactly like the Mac does, and sends the same request', async () => {
  const { mac, direct, calls } = await both(async () => response(photon));
  const a = await mac.search('Starbucks', [-80.2, 26.0]), b = await direct.search('Starbucks', [-80.2, 26.0]);
  assert.deepEqual(b, a);
  assert.deepEqual(b.map((p) => p.label), ['Starbucks, 3255 Hollywood Boulevard, Hollywood, Florida, United States', 'Beach Cafe, Dania']);
  assert.equal(calls.direct[0].url, calls.mac[0].url, 'the same search address');
  assert.equal(calls.direct[0].o.headers.authorization, undefined, 'nothing about you is added');
  assert.equal(calls.direct[0].o.referrerPolicy, 'no-referrer');
  await assert.rejects(direct.search('', undefined), /Enter a place name/);
  await assert.rejects(direct.search('x', [999, 0]), /Invalid starting coordinates/);
});

test('the phone answers a route exactly like the Mac does: encoded line, steps cut to size, same request body', async () => {
  const { mac, direct, calls } = await both(async () => response(trip(POLY)));
  const from = [-0.1278, 51.5074], to = [-0.1281, 51.508];
  const a = await mac.route(from, to, 'driving'), b = await direct.route(from, to, 'driving');
  assert.deepEqual(b, a);
  assert.equal(b.coordinates.length, macDecode(POLY).length);
  assert.deepEqual(b.steps.map((s) => s.index), [0, 3, -1, -1]);
  assert.equal(b.steps[3].alert, 'Short.'); assert.equal(b.steps[3].text.length, 500); assert.equal(b.steps[3].pre, 'bell tab');
  assert.deepEqual(JSON.parse(calls.direct[0].o.body), JSON.parse(calls.mac[0].o.body));
  const w = await direct.route(from, to, 'walking'); assert.ok(w.coordinates.length > 1);
  assert.equal(JSON.parse(calls.direct.at(-1).o.body).costing, 'pedestrian');
});

test('bad input and bad replies are errors on the phone too, not invented results', async () => {
  const { directApi, DirectNavigation, decodeShape } = await load();
  assert.deepEqual(decodeShape(POLY), macDecode(POLY));
  for (const bad of ['!!!', 'x'.repeat(300001), 5]) assert.throws(() => decodeShape(bad), /geometry/);
  const mk = (h) => new DirectNavigation({ fetchImpl: async () => h(), now: () => 1e9, wait: async () => {} });
  await assert.rejects(mk(() => response({})).route([0, 0], [1, 1], 'driving'), /geometry is invalid/);
  await assert.rejects(mk(() => response({ trip: { summary: { time: 1, length: 1 }, legs: [{ shape: { type: 'LineString', coordinates: [[0, 0]] } }] } })).route([0, 0], [1, 1], 'driving'), /No usable route/);
  await assert.rejects(mk(() => response({ nope: 1 })).search('x'), /invalid result/);
  await assert.rejects(mk(() => response({}, 503)).search('x'), /answered 503/);
  await assert.rejects(mk(() => { throw TypeError('offline'); }).search('x'), /could not finish/);
  await assert.rejects(mk(() => response(trip(POLY))).route([0, 0], [1, 1], 'flying'), /valid starting point/);
  const api = directApi(mk(() => response(photon)));
  assert.equal((await api('config')).style, 'https://tiles.openfreemap.org/styles/dark');
  assert.equal((await api('search', { query: 'Starbucks' })).places.length, 2);
  await assert.rejects(api('wat'), /Unknown/);
});

test('the phone waits between requests instead of hammering the free services, and repeats are answered from memory', async () => {
  const { DirectNavigation } = await load();
  let now = 0, waits = [], fetched = 0;
  const nav = new DirectNavigation({ fetchImpl: async () => { fetched++; return response(photon); }, now: () => now, wait: async (ms) => { waits.push(ms); now += ms; } });
  await nav.search('one'); await nav.search('two'); await nav.search('one');
  assert.equal(fetched, 2, 'the repeat came from memory');
  assert.ok(waits.length >= 1 && waits.every((w) => w > 0 && w <= 1100), 'the second request waited its turn');
  const ac = new AbortController(); ac.abort();
  await assert.rejects(nav.search('three', undefined, ac.signal), (e) => e.name === 'AbortError');
});
