const test = require('node:test');
const assert = require('node:assert/strict');
const load = () => import('../src/remote/navmath.js');

// Behaviour under test: src/remote/navmath.js, the turn-by-turn engine of the phone map page. No earlier test covers it.
// A route near Miami in metres, then in longitude and latitude: east 2000 m, left (north) 1200 m, right (east) 600 m. A point every 20 m.
const LAT = 26.01, LON = -80.2, KX = 111320 * Math.cos((LAT * Math.PI) / 180), KY = 110540;
const at = (x, y) => [LON + x / KX, LAT + y / KY];
function path(legs) { const pts = [at(0, 0)]; let x = 0, y = 0; for (const [dx, dy, len] of legs) { for (let d = 20; d <= len + 0.01; d += 20) pts.push(at(x + dx * d, y + dy * d)); x += dx * len; y += dy * len; } return pts; }
const coords = path([[1, 0, 2000], [0, 1, 1200], [1, 0, 600]]);
const STEPS = [
  { index: 0, type: 2, text: 'Drive east on Alpha Road.', pre: 'Drive east on Alpha Road.' },
  { index: 100, type: 15, text: 'Turn left onto Beta Street.', pre: 'Turn left onto Beta Street.', alert: 'Turn left.' },
  { index: 160, type: 10, text: 'Turn right onto Gamma Avenue.', pre: 'Turn right onto Gamma Avenue.', alert: 'Turn right.' },
  { index: coords.length - 1, type: 4, text: 'Your destination is on the right.', pre: 'Your destination is on the right.', alert: 'Your destination is on the right.' }
];
const make = (M, opts) => { const log = []; const session = new M.NavSession({ ...opts, speak: (text, urgent) => log.push({ text, urgent }) }); session.log = log; return session; };
const fix = (p, t, extra = {}) => ({ lon: p[0], lat: p[1], accuracy: 5, speed: 12, t, ...extra });
// Drives the route at a speed, one fix a second, returning what was spoken and the last info.
function drive(M, session, route, { speed = 14, from = 0 } = {}) {
  const log = session.log; let last = null;
  for (let d = from, t = 1000; d <= route.total + speed; d += speed, t += 1000) {
    const idx = route.cum.findIndex((c) => c >= d), i = idx <= 0 ? 0 : idx; const a = route.coords[Math.max(0, i - 1)], b = route.coords[i], span = route.cum[i] - route.cum[Math.max(0, i - 1)] || 1, f = (d - route.cum[Math.max(0, i - 1)]) / span;
    last = session.onFix(fix([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f], t));
    if (last.arrived) break;
  }
  return { log, last };
}

test('the route is measured, and a position is placed on it (along it, and how far off it)', async () => {
  const M = await load(); const route = M.buildRoute(coords);
  assert.ok(Math.abs(route.total - 3800) < 6, `total ${route.total}`);
  const on = M.snap(route, at(1000, 0)); assert.ok(on.dist < 1 && Math.abs(on.along - 1000) < 2);
  const off = M.snap(route, at(1000, -20)); assert.ok(Math.abs(off.dist - 20) < 1.5 && Math.abs(off.along - 1000) < 3, 'twenty metres beside the road');
  const corner = M.snap(route, at(2000, 600)); assert.ok(Math.abs(corner.along - 2600) < 3);
  assert.ok(Math.abs(M.haversine(at(0, 0), at(1000, 0)) - 1000) < 2); assert.ok(Math.abs(M.bearing(at(0, 0), at(1000, 0)) - 90) < 0.5); assert.ok(Math.abs(M.bearing(at(0, 0), at(0, 1000))) < 0.5 || Math.abs(M.bearing(at(0, 0), at(0, 1000)) - 360) < 0.5);
});

test('a road that doubles back is not mistaken for itself: the position is placed on the leg you are actually driving', async () => {
  const M = await load(); const back = [...path([[1, 0, 500]]), ...path([[0, 1, 15]]).slice(1).map(([lo, la]) => [lo + 500 / KX, la]), ...path([[-1, 0, 500]]).slice(1).map(([lo, la]) => [lo + 500 / KX, la + 15 / KY])];
  const route = M.buildRoute(back);
  const returning = at(250, 15);
  assert.ok(M.snap(route, returning, 0).along > 500, 'even from the start it finds the return leg when you are on it');
  assert.ok(M.snap(route, at(250, 7.5), 5).along < 500, 'halfway between the two, near where you were: the outbound leg (the closer to your last place)');
});

test('which step you are on and how far to the next turn', async () => {
  const M = await load(); const route = M.buildRoute(coords);
  const a = M.stepAt(STEPS, route, 500); assert.equal(a.stepIndex, 0); assert.ok(Math.abs(a.distToNext - 1500) < 6);
  const b = M.stepAt(STEPS, route, 2100); assert.equal(b.stepIndex, 1); assert.ok(Math.abs(b.distToNext - 1100) < 8, `to the second turn: ${b.distToNext}`);
  const c = M.stepAt(STEPS, route, route.total - 10); assert.equal(c.stepIndex, 2, 'the destination step begins at the very end'); assert.equal(c.last, false); assert.ok(Math.abs(c.distToNext - 10) < 1);
  const d = M.stepAt(STEPS, route, route.total); assert.equal(d.stepIndex, 3); assert.equal(d.last, true);
});

test('driving: each turn is announced early, closer, and as you reach it, exactly once; and you are told you have arrived', async () => {
  const M = await load(); const route = M.buildRoute(coords);
  const session = make(M, { route, steps: STEPS, mode: 'driving', units: 'metric', destination: 'Starbucks, 3255 Hollywood Blvd', seconds: 420 });
  session.start();
  const { log, last } = drive(M, session, route, { speed: 14 });
  const said = log.map((l) => l.text);
  assert.match(said[0], /^Starting navigation to Starbucks\. Drive east on Alpha Road\.$/);
  const beta = said.filter((t) => /Beta Street|^Turn left\.$/.test(t)); assert.equal(beta.length, 3, beta.join(' | '));
  assert.match(beta[0], /^In (850|900|950) meters, turn left onto Beta Street\.$/); assert.match(beta[1], /^In (200|250|300) meters, turn left onto Beta Street\.$/); assert.equal(beta[2], 'Turn left.');
  const gamma = said.filter((t) => /Gamma Avenue|^Turn right\.$/.test(t)); assert.equal(gamma.length, 3); assert.equal(gamma[2], 'Turn right.');
  assert.ok(said.some((t) => /^In \d+ meters, your destination is on the right\.$/.test(t)), 'the destination is announced ahead too');
  assert.equal(said.at(-1), 'You have arrived at Starbucks, Sir.'); assert.equal(said.filter((t) => /arrived/.test(t)).length, 1);
  assert.equal(last.arrived, true); assert.equal(log.find((l) => l.text === 'Turn left.').urgent, true, 'the "now" alert interrupts what was being said');
  assert.equal(log.find((l) => /^In \d+ meters, turn left/.test(l.text)).urgent, false);
});

test('walking uses short distances, and a short block skips the early announcement instead of saying three at once', async () => {
  const M = await load();
  const walk = M.buildRoute(coords), s1 = make(M, { route: walk, steps: STEPS, mode: 'walking', units: 'metric' });
  const w = drive(M, s1, walk, { speed: 1.4 }); const beta = w.log.map((l) => l.text).filter((t) => /Beta Street|^Turn left\.$/.test(t));
  assert.equal(beta.length, 3); assert.match(beta[0], /^In (150|200|100|150) meters, turn left onto Beta Street\.$/); assert.equal(beta[2], 'Turn left.');
  // a block of only 100 metres between two turns
  const short = M.buildRoute(path([[1, 0, 1000], [0, 1, 100], [1, 0, 400]])), steps = [{ index: 0, text: 'Go east.', pre: 'Go east.' }, { index: 50, text: 'Turn left onto Short Street.', pre: 'Turn left onto Short Street.', alert: 'Turn left.' }, { index: 55, text: 'Turn right onto Long Street.', pre: 'Turn right onto Long Street.', alert: 'Turn right.' }, { index: short.coords.length - 1, text: 'Your destination is on the right.', pre: 'Your destination is on the right.' }];
  const s2 = make(M, { route: short, steps, mode: 'driving' }); const d = drive(M, s2, short, { speed: 12 });
  const right = d.log.map((l) => l.text).filter((t) => /Long Street|^Turn right\.$/.test(t));
  assert.ok(right.length <= 2, `a 100 metre block gets at most two reminders, not three: ${right.join(' | ')}`); assert.equal(right.at(-1), 'Turn right.');
});

test('a wrong turn is noticed after a few fixes over several seconds, not from one noisy fix, and not when the GPS is poor', async () => {
  const M = await load(); const route = M.buildRoute(coords);
  const mk = () => new M.NavSession({ route, steps: STEPS, mode: 'driving', speak: () => {} });
  const s = mk(); s.onFix(fix(at(500, 0), 1000));
  assert.equal(s.onFix(fix(at(520, -90), 2000)).offRoute, false, 'one stray fix');
  assert.equal(s.onFix(fix(at(540, 0), 3000)).offRoute, false); assert.equal(s.watch.count, 0, 'back on the road resets it');
  const t = mk(); t.onFix(fix(at(500, 0), 1000)); const res = [];
  for (let i = 0; i < 6; i++) res.push(t.onFix(fix(at(520 + i * 12, -80), 2000 + i * 1000)).offRoute);
  assert.deepEqual(res, [false, false, false, false, true, true], 'needs three fixes spread over at least four seconds: the fifth');
  const poor = mk(); poor.onFix(fix(at(500, 0), 1000)); for (let i = 0; i < 8; i++) assert.equal(poor.onFix(fix(at(520 + i * 12, -70), 2000 + i * 1000, { accuracy: 90 })).offRoute, false, 'a 70 metre miss with 90 metre GPS error is not a wrong turn');
  const quiet = mk(); const said = []; quiet.speak = (x) => said.push(x); quiet.onFix(fix(at(1900, 0), 1000)); const before = said.length; for (let i = 0; i < 2; i++) quiet.onFix(fix(at(1950 + i * 10, -120), 2000 + i * 1000));
  assert.equal(said.length, before, 'nothing new is announced while you are off the route');
});

test('a new route after a wrong turn starts the announcements afresh, and the state of the old one is dropped', async () => {
  const M = await load(); const route = M.buildRoute(coords); const said = [];
  const s = new M.NavSession({ route, steps: STEPS, mode: 'driving', speak: (x) => said.push(x) }); s.onFix(fix(at(1200, 0), 1000)); s.onFix(fix(at(1300, 0), 2000));
  const before = said.length; assert.ok(before >= 1);
  s.setRoute(route, STEPS, 400); assert.equal(s.latest, null); assert.equal(s.hint, 0); s.onFix(fix(at(1300, 0), 3000)); assert.ok(said.length > before, 'the same turn is announced again on the new route');
});

test('arrival is announced once, at the end of the route', async () => {
  const M = await load(); const route = M.buildRoute(coords); const said = [];
  const s = new M.NavSession({ route, steps: STEPS, mode: 'driving', destination: 'Starbucks', speak: (x) => said.push(x) });
  const end = coords.at(-1); assert.equal(s.onFix(fix(at(2400, 1200), 1000)).arrived, false); const i1 = s.onFix(fix(end, 2000)); assert.equal(i1.arrived, true); s.onFix(fix(end, 3000));
  assert.equal(said.filter((x) => /arrived/.test(x)).length, 1);
});

test('which way you face: the phone\'s heading when it is valid and you are moving, else the direction of travel', async () => {
  const M = await load(); const route = M.buildRoute(coords);
  const a = new M.NavSession({ route, steps: STEPS, speak: () => {} }); a.onFix(fix(at(100, 0), 1000)); const moved = a.onFix(fix(at(130, 0), 2000, { speed: 12 })); assert.ok(Math.abs(moved.heading - 90) < 1, 'from where you were a second ago');
  const b = new M.NavSession({ route, steps: STEPS, speak: () => {} }); assert.equal(b.onFix(fix(at(100, 0), 1000, { heading: 77, speed: 12 })).heading, 77);
  assert.equal(b.onFix(fix(at(100, 1), 2000, { heading: 10, speed: 0.2 })).heading, 77, 'a heading while standing still is noise: the last good one is kept');
});

test('distances are said the way people say them, in metric or imperial, and shown short on the screen', async () => {
  const M = await load();
  assert.equal(M.speakDistance(400), '400 meters'); assert.equal(M.speakDistance(430), '450 meters'); assert.equal(M.speakDistance(20), '50 meters'); assert.equal(M.speakDistance(1000), 'one kilometer'); assert.equal(M.speakDistance(1250), '1.3 kilometers'); assert.equal(M.speakDistance(3000), '3 kilometers');
  assert.equal(M.speakDistance(150, 'imperial'), '500 feet'); assert.equal(M.speakDistance(300, 'imperial'), '1000 feet'); assert.equal(M.speakDistance(400, 'imperial'), 'a quarter mile'); assert.equal(M.speakDistance(805, 'imperial'), 'half a mile'); assert.equal(M.speakDistance(1609, 'imperial'), 'one mile'); assert.equal(M.speakDistance(4000, 'imperial'), '2.5 miles');
  assert.equal(M.showDistance(450), '450 m'); assert.equal(M.showDistance(1234), '1.2 km'); assert.equal(M.showDistance(30, 'imperial'), '100 ft'); assert.equal(M.showDistance(805, 'imperial'), '0.5 mi');
});

test('what Jarvis says: the distance first for early reminders, the short alert at the turn, and the destination by name', async () => {
  const M = await load(); const step = { pre: 'Turn left onto Beta Street.', alert: 'Turn left.' };
  assert.equal(M.phrase('far', step, 880), 'In 900 meters, turn left onto Beta Street.'); assert.equal(M.phrase('near', step, 240, { units: 'imperial' }), 'In 800 feet, turn left onto Beta Street.');
  assert.equal(M.phrase('now', step, 30), 'Turn left.'); assert.equal(M.phrase('now', { pre: 'Keep right.' }, 30), 'Keep right.');
  assert.equal(M.phrase('arrive', null, 0, { destination: 'Starbucks, 3255 Hollywood Blvd, Hollywood' }), 'You have arrived at Starbucks, Sir.'); assert.equal(M.phrase('arrive', null, 0), 'You have arrived, Sir.');
  assert.equal(M.phrase('far', null, 100), ''); assert.equal(M.phrase('far', { text: 'Bear right.' }, 100), 'In 100 meters, bear right.');
});

test('"what\'s next" and "repeat" use the latest position and the last thing said', async () => {
  const M = await load(); const route = M.buildRoute(coords); const said = [];
  const s = new M.NavSession({ route, steps: STEPS, mode: 'driving', speak: (x, u) => said.push([x, u]) });
  assert.match(s.describeNext(), /do not have your position yet/);
  s.onFix(fix(at(1000, 0), 1000)); assert.match(s.describeNext(), /^In (one|\d+(\.\d)?) kilometers?, turn left onto Beta Street\.$/);
  s.start(); s.repeat(); assert.equal(said.at(-1)[0], said.at(-2)[0]); assert.equal(said.at(-1)[1], true, 'a repeat is spoken straight away');
  s.onFix(fix(at(2550, 1200), 2000)); assert.match(s.describeNext(), /^In 50 meters, your destination is on the right\.$/, 'near the end, the next thing is the destination');
});

// ---- what you can say ----
test('voice commands: a destination with its travel mode, and each control', async () => {
  const { parseCommand: p } = await import('../src/remote/navvoice.js');
  assert.deepEqual(p('Take me to NSU University School'), { type: 'go', place: 'NSU University School', mode: 'driving', then: [] });
  assert.deepEqual(p('Jarvis, walk me to Starbucks.'), { type: 'go', place: 'Starbucks', mode: 'walking', then: [] });
  assert.deepEqual(p('drive to Miami Airport'), { type: 'go', place: 'Miami Airport', mode: 'driving', then: [] });
  assert.deepEqual(p('directions to 3255 Hollywood Blvd'), { type: 'go', place: '3255 Hollywood Blvd', mode: 'driving', then: [] });
  assert.deepEqual(p('how do I get to the beach'), { type: 'go', place: 'the beach', mode: 'driving', then: [] });
  assert.deepEqual(p('walking'), { type: 'mode', mode: 'walking' }); assert.deepEqual(p('switch to driving'), { type: 'mode', mode: 'driving' });
  const cases = { start: ['start', "let's go", 'begin navigation', 'start the route', 'lead the way'], stop: ['stop', 'end navigation', 'cancel', 'exit'], mute: ['mute', 'be quiet', 'voice off'], unmute: ['unmute', 'voice on'], repeat: ['repeat that', 'say that again', 'what did you say'], next: ["what's next", 'next turn', 'where do I turn'], eta: ['how far', 'how long', 'when will I arrive', 'eta'], 'zoom-in': ['zoom in'], 'zoom-out': ['zoom out'], overview: ['overview', 'show the whole route'], recenter: ['recenter', 'where am I', 'follow me'], apple: ['open apple maps', 'use apple maps'] };
  for (const [type, phrases] of Object.entries(cases)) for (const phrase of phrases) assert.equal(p(phrase)?.type, type, phrase);
});

test('ordinary speech is not taken for a map command, and an empty or odd input is nothing', async () => {
  const { parseCommand: p, REPLIES } = await import('../src/remote/navvoice.js');
  for (const t of ['what time is it', 'play some music', 'I went to the store', 'to the left', 'turn the lights off', '', '   ', null, undefined, 'take me']) assert.equal(p(t), null, String(t));
  assert.equal(p('take me to ' + 'x'.repeat(300)), null, 'a place name is bounded');
  assert.equal(REPLIES.mode('walking'), 'Walking directions.'); assert.match(REPLIES.none, /take me to/);
});

test('stops: "X and then Y", "Y with a stop at X", add a stop, continue, and saved home/work are all understood', async () => {
  const { parseCommand } = await import('../src/remote/navvoice.js');
  assert.deepEqual(parseCommand('take me to Starbucks and then home'), { type: 'go', place: 'Starbucks', mode: 'driving', then: ['home'] });
  assert.deepEqual(parseCommand('walk to the beach then the office then home'), { type: 'go', place: 'the beach', mode: 'walking', then: ['work', 'home'] });
  assert.deepEqual(parseCommand('take me home with a stop at Starbucks'), { type: 'go', place: 'Starbucks', mode: 'driving', then: ['home'] });
  assert.deepEqual(parseCommand('take me home'), { type: 'go', place: 'home', mode: 'driving', then: [] });
  assert.deepEqual(parseCommand('take me to the Home Depot'), { type: 'go', place: 'the Home Depot', mode: 'driving', then: [] });
  assert.deepEqual(parseCommand('add a stop at Starbucks'), { type: 'addstop', place: 'Starbucks' });
  assert.deepEqual(parseCommand('stop at the bank first'), { type: 'addstop', place: 'the bank' });
  assert.deepEqual(parseCommand('continue'), { type: 'continue' });
  assert.deepEqual(parseCommand('next stop'), { type: 'continue' });
  assert.deepEqual(parseCommand('this is home'), { type: 'sethome', name: 'home' });
  assert.deepEqual(parseCommand('save my location as work'), { type: 'sethome', name: 'work' });
  // the existing words keep their meaning
  assert.deepEqual(parseCommand('stop'), { type: 'stop' });
  assert.deepEqual(parseCommand('end navigation'), { type: 'stop' });
  assert.deepEqual(parseCommand('start'), { type: 'start' });
});
